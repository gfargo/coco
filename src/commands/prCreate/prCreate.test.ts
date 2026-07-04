import { Arguments } from 'yargs'
import { SimpleGit } from 'simple-git'
import { handler } from './handler'
import { PrCreateOptions } from './config'
import { Config } from '../../commands/types'
import { applyRepoFlag } from '../utils/applyRepoFlag'
import { loadConfig } from '../../lib/config/utils/loadConfig'
import { getProviderOverview } from '../../git/providerData'
import { runPullRequestBodyWorkflow } from '../../git/aiActions'
import { createPullRequest, openPullRequest } from '../../git/pullRequestActions'
import { Logger } from '../../lib/utils/logger'

jest.mock('../utils/applyRepoFlag')
jest.mock('../../lib/config/utils/loadConfig')
jest.mock('../../git/providerData')
jest.mock('../../git/aiActions')
jest.mock('../../git/pullRequestActions')

const mockApplyRepoFlag = applyRepoFlag as jest.MockedFunction<typeof applyRepoFlag>
const mockLoadConfig = loadConfig as jest.MockedFunction<typeof loadConfig>
const mockOverview = getProviderOverview as jest.MockedFunction<typeof getProviderOverview>
const mockBodyWorkflow = runPullRequestBodyWorkflow as jest.MockedFunction<typeof runPullRequestBodyWorkflow>
const mockCreatePr = createPullRequest as jest.MockedFunction<typeof createPullRequest>
const mockOpenPr = openPullRequest as jest.MockedFunction<typeof openPullRequest>

function okOverview(over: Record<string, unknown> = {}) {
  return {
    repository: { provider: 'github', remote: 'origin', defaultBranch: 'main' },
    currentBranch: 'feature/x',
    authenticated: true,
    ...over,
  } as unknown as Awaited<ReturnType<typeof getProviderOverview>>
}

describe('pr create command', () => {
  let argv: Arguments<PrCreateOptions>
  let logger: Logger

  beforeEach(() => {
    argv = {
      $0: 'coco',
      _: ['pr', 'create'],
      interactive: false,
      verbose: false,
      version: false,
      help: false,
    } as Arguments<PrCreateOptions>
    logger = { log: jest.fn(), verbose: jest.fn(), setConfig: jest.fn(), error: jest.fn() } as unknown as Logger

    mockApplyRepoFlag.mockReturnValue({} as SimpleGit)
    mockLoadConfig.mockReturnValue({ service: { provider: 'openai' } } as unknown as Config)
    mockOverview.mockResolvedValue(okOverview())
    mockBodyWorkflow.mockResolvedValue({
      ok: true,
      message: 'drafted',
      title: 'feat: add x',
      body: 'This PR adds x.',
    })
    mockCreatePr.mockResolvedValue({ ok: true, message: 'Created pull request: https://gh/pr/1', url: 'https://gh/pr/1' })
    mockOpenPr.mockResolvedValue({ ok: true, message: 'opened' })
  })

  afterEach(() => jest.clearAllMocks())

  it('generates title/body and creates the PR by default', async () => {
    await handler(argv, logger)
    expect(mockBodyWorkflow).toHaveBeenCalledWith({ baseBranch: 'main' })
    expect(mockCreatePr).toHaveBeenCalledWith(
      expect.objectContaining({ base: 'main', head: 'feature/x', title: 'feat: add x', body: 'This PR adds x.', draft: false })
    )
  })

  it('honors --base', async () => {
    argv.base = 'develop'
    await handler(argv, logger)
    expect(mockBodyWorkflow).toHaveBeenCalledWith({ baseBranch: 'develop' })
    expect(mockCreatePr).toHaveBeenCalledWith(expect.objectContaining({ base: 'develop' }))
  })

  it('skips generation when both --title and --body are provided', async () => {
    argv.title = 'fix: thing'
    argv.body = 'manual body'
    await handler(argv, logger)
    expect(mockBodyWorkflow).not.toHaveBeenCalled()
    expect(mockCreatePr).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'fix: thing', body: 'manual body' })
    )
  })

  it('does not create on --dry-run', async () => {
    argv.dryRun = true
    await handler(argv, logger)
    expect(mockCreatePr).not.toHaveBeenCalled()
  })

  it('emits JSON and does not create on --json', async () => {
    argv.json = true
    const writes: string[] = []
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation(((c: string) => {
      writes.push(String(c))
      return true
    }) as never)
    try {
      await handler(argv, logger)
    } finally {
      spy.mockRestore()
    }
    expect(mockCreatePr).not.toHaveBeenCalled()
    const json = writes.find((w) => {
      try {
        JSON.parse(w)
        return true
      } catch {
        return false
      }
    })
    const parsed = JSON.parse(json as string)
    expect(parsed).toMatchObject({ base: 'main', head: 'feature/x', title: 'feat: add x' })
  })

  it('opens the PR in the browser with --web', async () => {
    argv.web = true
    await handler(argv, logger)
    expect(mockOpenPr).toHaveBeenCalledWith('https://gh/pr/1')
  })

  it('exits non-zero when gh is not authenticated', async () => {
    mockOverview.mockResolvedValue(okOverview({ authenticated: false, message: 'run gh auth login' }))
    await expect(handler(argv, logger)).rejects.toMatchObject({ code: 1 })
    expect(mockCreatePr).not.toHaveBeenCalled()
  })

  it('refuses to create a PR from the base branch', async () => {
    mockOverview.mockResolvedValue(okOverview({ currentBranch: 'main' }))
    await expect(handler(argv, logger)).rejects.toMatchObject({ code: 1 })
    expect(mockBodyWorkflow).not.toHaveBeenCalled()
  })

  it('exits 0 when a PR already exists for the branch', async () => {
    mockOverview.mockResolvedValue(
      okOverview({ currentPullRequest: { number: 7, state: 'OPEN' } })
    )
    await expect(handler(argv, logger)).rejects.toMatchObject({ code: 0 })
    expect(mockCreatePr).not.toHaveBeenCalled()
  })

  it('exits non-zero when body generation fails', async () => {
    mockBodyWorkflow.mockResolvedValue({ ok: false, message: 'no commits ahead of base' })
    await expect(handler(argv, logger)).rejects.toMatchObject({ code: 1 })
    expect(mockCreatePr).not.toHaveBeenCalled()
  })
})
