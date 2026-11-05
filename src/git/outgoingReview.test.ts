import { SimpleGit } from 'simple-git'
import type { BranchRef } from './branchData'
import { formatOutgoingReview, reviewOutgoingRange, sortFindings } from './outgoingReview'

const mockGenerate = jest.fn()
const mockLint = jest.fn()
const mockCreateContext = jest.fn()
const mockLoadConfig = jest.fn()
const mockImpliesConventional = jest.fn()

jest.mock('../operations/agent/generate', () => ({
  generateAgentReview: (...args: unknown[]) => mockGenerate(...args),
  runLint: (...args: unknown[]) => mockLint(...args),
}))
jest.mock('../lib/config/utils/loadConfig', () => ({
  loadConfig: (...args: unknown[]) => mockLoadConfig(...args),
}))
jest.mock('../lib/utils/hasCommitlintConfig', () => ({
  commitlintImpliesConventional: (...args: unknown[]) => mockImpliesConventional(...args),
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

const lintResult = (shortSha: string, subject: string, status: 'pass' | 'fail' | 'warn', errors: string[] = []) =>
  ({ sha: shortSha, shortSha, subject, status, errors, warnings: [] }) as never

beforeEach(() => {
  jest.clearAllMocks()
  mockCreateContext.mockResolvedValue({ repoRoot: '/repo' })
  mockLoadConfig.mockReturnValue({})
  mockImpliesConventional.mockResolvedValue(false)
})

describe('sortFindings / formatOutgoingReview (#2216)', () => {
  it('orders most severe first, then by title', () => {
    const sorted = sortFindings([finding('b', 3), finding('a', 3), finding('z', 9)])
    expect(sorted.map((f) => f.title)).toEqual(['z', 'a', 'b'])
  })

  it('reports no findings with a hint to push', () => {
    const result = formatOutgoingReview('feat/x', 'origin/feat/x', 2, { findings: [] })
    expect(result.ok).toBe(true)
    expect(result.message).toMatch(/2 outgoing commits.*no review findings.*Press P to push/)
    expect(result.details).toBeUndefined()
  })

  it('summarizes findings, counts high severity, and says nothing was pushed', () => {
    const result = formatOutgoingReview('feat/x', 'origin/feat/x', 1, {
      findings: [finding('minor', 2), finding('leaks a token', 9, 'src/a.ts')],
    })
    expect(result.message).toMatch(/1 outgoing commit on feat\/x.*2 findings, 1 high severity \(7\+\)\. Nothing was pushed\./)
    expect(result.details).toEqual([
      '[9] leaks a token (src/a.ts): leaks a token summary',
      '[2] minor: minor summary',
    ])
  })

  it('lists only the subjects that break the rules, after the findings', () => {
    const result = formatOutgoingReview('feat/x', 'origin/feat/x', 3, { findings: [finding('bug', 5)] }, {
      results: [
        lintResult('aaa1111', 'feat: ok', 'pass'),
        lintResult('bbb2222', 'fixed stuff', 'fail', ['type may not be empty']),
        lintResult('ccc3333', 'Add thing', 'fail', ['type may not be empty', 'subject must not be sentence-case']),
      ],
    })
    expect(result.message).toMatch(/1 finding; 2 of 3 subjects break Conventional Commits\. Nothing was pushed\./)
    expect(result.details).toEqual([
      '[5] bug: bug summary',
      'Subject bbb2222 fixed stuff: type may not be empty',
      'Subject ccc3333 Add thing: type may not be empty; subject must not be sentence-case',
    ])
  })

  it('says everything is clean only when both halves pass', () => {
    const result = formatOutgoingReview('feat/x', 'origin/feat/x', 1, { findings: [] }, {
      results: [lintResult('aaa1111', 'feat: ok', 'pass')],
    })
    expect(result.message).toMatch(/no review findings; all subjects follow Conventional Commits\. Press P to push\./)
  })

  it('keeps the lint result when the review is unavailable', () => {
    const result = formatOutgoingReview('feat/x', 'origin/feat/x', 1, { error: 'No API key' }, {
      results: [lintResult('bbb2222', 'fixed stuff', 'fail', ['type may not be empty'])],
    })
    expect(result.ok).toBe(true)
    expect(result.message).toMatch(/review unavailable \(No API key\); 1 of 1 subject break/)
    expect(result.details).toEqual(['Subject bbb2222 fixed stuff: type may not be empty'])
  })

  it('is not ok when nothing could run', () => {
    const result = formatOutgoingReview('feat/x', 'origin/feat/x', 1, { error: 'No API key' })
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/You can still push with P/)
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
    expect(result.message).toMatch(/review unavailable \(No API key configured\).*You can still push with P\./)
  })

  it('reports a planned (not run) review as unavailable', async () => {
    mockGenerate.mockResolvedValue({ status: 'planned' })
    const result = await reviewOutgoingRange(fakeGit(jest.fn().mockResolvedValue('2\n')), branch())
    expect(result.ok).toBe(false)
  })

  describe('subject lint', () => {
    const git = () => fakeGit(jest.fn().mockResolvedValue('2\n'))
    beforeEach(() => {
      mockGenerate.mockResolvedValue({ status: 'completed', data: { findings: [] } })
      mockLint.mockResolvedValue({ data: { results: [lintResult('bbb2222', 'fixed stuff', 'fail', ['type may not be empty'])] } })
    })

    it('does not lint subjects in a repo that does not use Conventional Commits', async () => {
      const result = await reviewOutgoingRange(git(), branch())
      expect(mockLint).not.toHaveBeenCalled()
      expect(result.message).not.toMatch(/Conventional Commits/)
    })

    it('lints <upstream>..<branch> when commitlint requires the conventional format', async () => {
      mockImpliesConventional.mockResolvedValue(true)
      const result = await reviewOutgoingRange(git(), branch())
      expect(mockLint).toHaveBeenCalledWith({ version: 1, range: 'origin/feat/x..feat/x', severity: 'error' }, expect.anything())
      expect(result.details).toEqual(['Subject bbb2222 fixed stuff: type may not be empty'])
    })

    it('lints when conventionalCommits is set explicitly', async () => {
      mockLoadConfig.mockReturnValue({ conventionalCommits: true })
      await reviewOutgoingRange(git(), branch())
      expect(mockLint).toHaveBeenCalled()
    })

    it('honors an explicit conventionalCommits: false even with a conventional commitlint config', async () => {
      mockLoadConfig.mockReturnValue({ conventionalCommits: false })
      mockImpliesConventional.mockResolvedValue(true)
      await reviewOutgoingRange(git(), branch())
      expect(mockLint).not.toHaveBeenCalled()
    })

    it('still shows subject lint when the review fails', async () => {
      mockImpliesConventional.mockResolvedValue(true)
      mockGenerate.mockRejectedValue(new Error('No API key'))
      const result = await reviewOutgoingRange(git(), branch())
      expect(result.ok).toBe(true)
      expect(result.message).toMatch(/review unavailable \(No API key\); 1 of 1 subject break/)
    })
  })
})
