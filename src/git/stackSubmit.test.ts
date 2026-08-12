import { SimpleGit } from 'simple-git'
import { submitStack } from './stackSubmit'
import { buildStack, getAllStackParents, StackEntry } from './stackData'
import { getProviderOverview } from './providerData'
import { getForgeActions } from './forgeActions'
import { runPullRequestBodyWorkflow } from './aiActions'

jest.mock('./stackData')
jest.mock('./providerData')
jest.mock('./forgeActions')
jest.mock('./aiActions')

const mockBuildStack = buildStack as jest.MockedFunction<typeof buildStack>
const mockGetAllStackParents = getAllStackParents as jest.MockedFunction<typeof getAllStackParents>
const mockGetProviderOverview = getProviderOverview as jest.MockedFunction<typeof getProviderOverview>
const mockGetForgeActions = getForgeActions as jest.MockedFunction<typeof getForgeActions>
const mockRunPullRequestBodyWorkflow = runPullRequestBodyWorkflow as jest.MockedFunction<typeof runPullRequestBodyWorkflow>

function overview(over: Record<string, unknown> = {}) {
  return {
    repository: { provider: 'github', remote: 'origin', defaultBranch: 'main' },
    currentBranch: 'b',
    authenticated: true,
    ...over,
  } as unknown as Awaited<ReturnType<typeof getProviderOverview>>
}

function makeGit(): { git: SimpleGit; checkout: jest.Mock } {
  const checkout = jest.fn().mockResolvedValue(undefined)
  const git = {
    checkout,
    status: jest.fn().mockResolvedValue({ isClean: () => true }),
  } as unknown as SimpleGit
  return { git, checkout }
}

const threeStack: StackEntry[] = [
  { branch: 'main', parent: undefined, ahead: 0, behind: 0 },
  { branch: 'a', parent: 'main', ahead: 2, behind: 0 },
  { branch: 'b', parent: 'a', ahead: 1, behind: 0 },
]

describe('submitStack', () => {
  let createPullRequest: jest.Mock

  beforeEach(() => {
    mockGetAllStackParents.mockResolvedValue({})
    mockBuildStack.mockResolvedValue(threeStack)
    createPullRequest = jest.fn().mockResolvedValue({ ok: true, message: 'Created pull request', url: 'https://gh/pr/0' })
    mockGetForgeActions.mockReturnValue({
      createPullRequest,
    } as unknown as ReturnType<typeof getForgeActions>)
    mockRunPullRequestBodyWorkflow.mockResolvedValue({ ok: true, message: 'drafted', title: 'feat: x', body: 'body' })
  })

  afterEach(() => jest.clearAllMocks())

  it('creates PRs bottom-up with the correct base for each branch', async () => {
    const { git, checkout } = makeGit()
    mockGetProviderOverview
      .mockResolvedValueOnce(overview({ currentBranch: 'b' }))
      .mockResolvedValueOnce(overview({ currentBranch: 'a' }))
      .mockResolvedValueOnce(overview({ currentBranch: 'b' }))
    createPullRequest
      .mockResolvedValueOnce({ ok: true, message: 'Created pull request: https://gh/pr/1', url: 'https://gh/pr/1' })
      .mockResolvedValueOnce({ ok: true, message: 'Created pull request: https://gh/pr/2', url: 'https://gh/pr/2' })

    const result = await submitStack(git)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok result')
    expect(result.summary.created).toBe(2)
    expect(result.summary.skipped).toBe(0)
    expect(result.summary.failed).toBe(0)

    expect(createPullRequest.mock.calls[0][0]).toMatchObject({ base: 'main', head: 'a' })
    expect(createPullRequest.mock.calls[1][0]).toMatchObject({ base: 'a', head: 'b' })

    // Checks out each non-root branch in order, then restores the original branch.
    expect(checkout.mock.calls.map((call) => call[0])).toEqual(['a', 'b', 'b'])
  })

  it('skips a branch that already has an open PR instead of recreating it', async () => {
    const { git } = makeGit()
    mockGetProviderOverview
      .mockResolvedValueOnce(overview({ currentBranch: 'b' }))
      .mockResolvedValueOnce(overview({ currentBranch: 'a', currentPullRequest: { number: 5, state: 'OPEN' } }))
      .mockResolvedValueOnce(overview({ currentBranch: 'b' }))
    createPullRequest.mockResolvedValueOnce({ ok: true, message: 'Created pull request: https://gh/pr/2', url: 'https://gh/pr/2' })

    const result = await submitStack(git)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok result')
    expect(result.summary.created).toBe(1)
    expect(result.summary.skipped).toBe(1)
    expect(result.summary.failed).toBe(0)
    expect(createPullRequest).toHaveBeenCalledTimes(1)
    expect(createPullRequest.mock.calls[0][0]).toMatchObject({ base: 'a', head: 'b' })

    const aEntry = result.summary.entries.find((entry) => entry.branch === 'a')
    expect(aEntry).toMatchObject({ status: 'already-exists', number: 5 })
  })

  it('records a mid-stack failure without dropping earlier or later successes', async () => {
    const { git } = makeGit()
    mockGetProviderOverview
      .mockResolvedValueOnce(overview({ currentBranch: 'b' }))
      .mockResolvedValueOnce(overview({ currentBranch: 'a' }))
      .mockResolvedValueOnce(overview({ currentBranch: 'b' }))
    createPullRequest
      .mockRejectedValueOnce(new Error('forge unavailable'))
      .mockResolvedValueOnce({ ok: true, message: 'Created pull request: https://gh/pr/2', url: 'https://gh/pr/2' })

    const result = await submitStack(git)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok result')
    expect(result.summary.created).toBe(1)
    expect(result.summary.failed).toBe(1)
    expect(result.summary.entries).toEqual([
      expect.objectContaining({ branch: 'a', status: 'failed', message: 'forge unavailable' }),
      expect.objectContaining({ branch: 'b', status: 'created' }),
    ])
  })

  it('restores the original branch even when a checkout mid-stack fails', async () => {
    const { git, checkout } = makeGit()
    mockGetProviderOverview
      .mockResolvedValueOnce(overview({ currentBranch: 'b' }))
      .mockResolvedValueOnce(overview({ currentBranch: 'b' }))
    checkout.mockRejectedValueOnce(new Error('checkout failed')).mockResolvedValue(undefined)

    const result = await submitStack(git)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok result')
    expect(result.summary.failed).toBe(1)
    expect(checkout).toHaveBeenLastCalledWith('b')
  })

  it('refuses to run against a dirty working tree', async () => {
    const { git } = makeGit()
    ;(git.status as jest.Mock).mockResolvedValue({ isClean: () => false })
    mockGetProviderOverview.mockResolvedValueOnce(overview({ currentBranch: 'b' }))

    const result = await submitStack(git)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure result')
    expect(result.message).toMatch(/uncommitted changes/i)
    expect(mockBuildStack).not.toHaveBeenCalled()
  })

  it('reports a friendly no-op when the branch is not part of a stack', async () => {
    const { git } = makeGit()
    mockGetProviderOverview.mockResolvedValueOnce(overview({ currentBranch: 'b' }))
    mockBuildStack.mockResolvedValue([{ branch: 'b', parent: undefined, ahead: 0, behind: 0 }])

    const result = await submitStack(git)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok result')
    expect(result.summary.entries).toEqual([])
    expect(createPullRequest).not.toHaveBeenCalled()
  })

  it('fails gracefully when the provider is unsupported', async () => {
    const { git } = makeGit()
    mockGetProviderOverview.mockResolvedValueOnce(
      overview({ repository: { provider: 'unsupported', remote: 'origin', message: 'No Git remote detected.' } })
    )

    const result = await submitStack(git)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure result')
    expect(result.message).toBe('No Git remote detected.')
  })
})
