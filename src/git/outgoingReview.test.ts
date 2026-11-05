import { SimpleGit } from 'simple-git'
import type { BranchRef } from './branchData'
import { formatOutgoingReview, reviewOutgoingRange, sortFindings } from './outgoingReview'

const mockGenerate = jest.fn()
const mockCreateContext = jest.fn()

jest.mock('../operations/agent/generate', () => ({
  generateAgentReview: (...args: unknown[]) => mockGenerate(...args),
}))
jest.mock('../operations/agent/context', () => ({
  createAgentOperationContext: (...args: unknown[]) => mockCreateContext(...args),
}))

const branch = (overrides: Partial<BranchRef> = {}): BranchRef =>
  ({ type: 'local', shortName: 'feat/x', upstream: 'origin/feat/x', remote: 'origin', ...overrides }) as BranchRef

const finding = (title: string, severity: number, filePath?: string) =>
  ({ title, summary: `${title} summary`, severity, category: 'bug', filePath }) as never

function fakeGit(raw: jest.Mock): SimpleGit {
  return { raw, revparse: jest.fn().mockResolvedValue('/repo\n') } as unknown as SimpleGit
}

beforeEach(() => {
  jest.clearAllMocks()
  mockCreateContext.mockResolvedValue({ repoRoot: '/repo' })
})

describe('sortFindings / formatOutgoingReview (#2216)', () => {
  it('orders most severe first, then by title', () => {
    const sorted = sortFindings([finding('b', 3), finding('a', 3), finding('z', 9)])
    expect(sorted.map((f) => f.title)).toEqual(['z', 'a', 'b'])
  })

  it('reports no findings with a hint to push', () => {
    const result = formatOutgoingReview('feat/x', 'origin/feat/x', 2, [])
    expect(result.ok).toBe(true)
    expect(result.message).toMatch(/2 outgoing commits.*no findings.*Press P/)
    expect(result.details).toBeUndefined()
  })

  it('summarizes findings, counts high severity, and says nothing was pushed', () => {
    const result = formatOutgoingReview('feat/x', 'origin/feat/x', 1, [
      finding('minor', 2),
      finding('leaks a token', 9, 'src/a.ts'),
    ])
    expect(result.message).toMatch(/1 outgoing commit on feat\/x: 2 findings, 1 high severity \(7\+\)\. Nothing was pushed\./)
    expect(result.details).toEqual([
      '[9] leaks a token (src/a.ts): leaks a token summary',
      '[2] minor: minor summary',
    ])
  })
})

describe('reviewOutgoingRange (#2216)', () => {
  it('refuses non-local branches', async () => {
    const result = await reviewOutgoingRange(fakeGit(jest.fn()), branch({ type: 'remote' }))
    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/Only local branches/) })
  })

  it('explains when there is no upstream', async () => {
    const result = await reviewOutgoingRange(fakeGit(jest.fn()), branch({ upstream: undefined }))
    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/no upstream/) })
    expect(mockGenerate).not.toHaveBeenCalled()
  })

  it('reports an up-to-date branch without calling the model', async () => {
    const result = await reviewOutgoingRange(fakeGit(jest.fn().mockResolvedValue('0\n')), branch())
    expect(result).toMatchObject({ ok: true, message: expect.stringMatching(/Nothing to push/) })
    expect(mockGenerate).not.toHaveBeenCalled()
  })

  it('reviews <upstream>..<branch> and formats the findings', async () => {
    const raw = jest.fn().mockResolvedValue('3\n')
    mockGenerate.mockResolvedValue({ status: 'completed', data: { findings: [finding('bug', 8)] } })

    const result = await reviewOutgoingRange(fakeGit(raw), branch())

    expect(raw).toHaveBeenCalledWith(['rev-list', '--count', 'origin/feat/x..feat/x'])
    expect(mockGenerate.mock.calls[0][0].source).toEqual({
      kind: 'repository',
      scope: { type: 'range', from: 'origin/feat/x', to: 'feat/x' },
    })
    expect(result.ok).toBe(true)
    expect(result.message).toMatch(/3 outgoing commits.*1 finding, 1 high severity/)
  })

  it('returns a non-throwing "unavailable" result when the review fails, and says push still works', async () => {
    mockGenerate.mockRejectedValue(new Error('No API key configured\nstack...'))
    const result = await reviewOutgoingRange(fakeGit(jest.fn().mockResolvedValue('2\n')), branch())
    expect(result.ok).toBe(false)
    expect(result.message).toBe('Review unavailable: No API key configured. You can still push with P.')
  })

  it('reports a planned (not run) review as unavailable', async () => {
    mockGenerate.mockResolvedValue({ status: 'planned' })
    const result = await reviewOutgoingRange(fakeGit(jest.fn().mockResolvedValue('2\n')), branch())
    expect(result.ok).toBe(false)
  })
})
