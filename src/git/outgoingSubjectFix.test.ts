import { SimpleGit } from 'simple-git'
import type { BranchRef } from './branchData'
import { MAX_SUBJECT_FIXES, planOutgoingSubjectFixes } from './outgoingSubjectFix'

const mockRunLint = jest.fn()
const mockShouldLint = jest.fn()
const mockDraft = jest.fn()
const mockPlanRows = jest.fn()

jest.mock('../operations/agent/context', () => ({
  createAgentOperationContext: jest.fn().mockResolvedValue({ repoRoot: '/repo' }),
}))
jest.mock('../operations/agent/generate', () => ({ runLint: (...a: unknown[]) => mockRunLint(...a) }))
jest.mock('./outgoingReview', () => ({
  ...jest.requireActual('./outgoingReview'),
  shouldLintSubjects: (...a: unknown[]) => mockShouldLint(...a),
}))
jest.mock('./commitWorkflowActions', () => ({ suggestCommitMessageForCommit: (...a: unknown[]) => mockDraft(...a) }))
jest.mock('./rebasePlanActions', () => ({ getRebasePlanRows: (...a: unknown[]) => mockPlanRows(...a) }))

const branch = (o: Partial<BranchRef> = {}): BranchRef =>
  ({ type: 'local', shortName: 'feat/x', upstream: 'origin/feat/x', remote: 'origin', ...o }) as BranchRef

const row = (sha: string, subject: string) => ({ sha, shortSha: sha.slice(0, 7), subject, author: 'a', date: 'd', action: 'pick' as const })
const bad = (sha: string, subject: string) => ({ sha, shortSha: sha.slice(0, 7), subject, status: 'fail', errors: ['type may not be empty'], warnings: [] })
const ok = (sha: string, subject: string) => ({ sha, shortSha: sha.slice(0, 7), subject, status: 'pass', errors: [], warnings: [] })

/** A git stub: current branch, outgoing shas, merge count, and per-commit bodies. */
function fakeGit(opts: { current?: string; shas?: string[]; merges?: number } = {}) {
  const { current = 'feat/x', shas = ['a'.repeat(40), 'b'.repeat(40)], merges = 0 } = opts
  return {
    raw: jest.fn(async (args: string[]) => {
      if (args[0] === 'symbolic-ref') return `${current}\n`
      if (args.includes('--merges')) return `${merges}\n`
      if (args[0] === 'rev-list') return `${shas.join('\n')}\n`
      return ''
    }),
    revparse: jest.fn().mockResolvedValue('/repo\n'),
  } as unknown as SimpleGit
}

const A = 'a'.repeat(40)
const B = 'b'.repeat(40)

beforeEach(() => {
  jest.resetAllMocks()
  mockShouldLint.mockResolvedValue(true)
  mockRunLint.mockResolvedValue({ data: { results: [bad(A, 'add config'), ok(B, 'feat: fine')] } })
  mockPlanRows.mockResolvedValue({ ok: true, rows: [row(A, 'add config'), row(B, 'feat: fine')] })
  mockDraft.mockResolvedValue('feat: add config')
})

describe('planOutgoingSubjectFixes (#2216 step 3)', () => {
  it('refuses a branch that is not checked out, since the rebase rewrites HEAD', async () => {
    const result = await planOutgoingSubjectFixes(fakeGit({ current: 'main' }), branch())
    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/Check out feat\/x first \(you're on main\)/) })
  })

  it('refuses without an upstream and for remote branches', async () => {
    expect(await planOutgoingSubjectFixes(fakeGit(), branch({ upstream: undefined }))).toMatchObject({ ok: false })
    expect(await planOutgoingSubjectFixes(fakeGit(), branch({ type: 'remote' }))).toMatchObject({ ok: false })
  })

  it('refuses a range with merge commits, which a rebase would flatten', async () => {
    const result = await planOutgoingSubjectFixes(fakeGit({ merges: 1 }), branch())
    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/1 merge commit.*flatten/) })
    expect(mockRunLint).not.toHaveBeenCalled()
  })

  it('refuses a repo that does not use Conventional Commits', async () => {
    mockShouldLint.mockResolvedValue(false)
    const result = await planOutgoingSubjectFixes(fakeGit(), branch())
    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/does not use that format/) })
    expect(mockDraft).not.toHaveBeenCalled()
  })

  it('reports nothing to do when no outgoing commits or all subjects conform', async () => {
    expect(await planOutgoingSubjectFixes(fakeGit({ shas: [] }), branch())).toMatchObject({ ok: true, rows: [] })
    mockRunLint.mockResolvedValue({ data: { results: [ok(A, 'feat: a'), ok(B, 'feat: b')] } })
    const clean = await planOutgoingSubjectFixes(fakeGit(), branch())
    expect(clean).toMatchObject({ ok: true, rows: [], message: expect.stringMatching(/already follow/) })
    expect(mockDraft).not.toHaveBeenCalled()
  })

  it('sets only the bad commits to reword, drafting from that commit\'s own diff', async () => {
    const result = await planOutgoingSubjectFixes(fakeGit(), branch())

    expect(mockPlanRows).toHaveBeenCalledWith(expect.anything(), A)
    expect(mockDraft).toHaveBeenCalledTimes(1)
    expect(mockDraft).toHaveBeenCalledWith(expect.anything(), A, undefined)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.rows[0]).toMatchObject({ action: 'reword', newMessage: 'feat: add config' })
    expect(result.rows[1]).toMatchObject({ action: 'pick' })
    expect(result.message).toMatch(/1 of 1 bad subject set to reword.*enter to run/)
  })

  it('uses the drafted message, body included, as the reword text', async () => {
    mockDraft.mockResolvedValue('feat: add config\n\nWhy: because.')
    const result = await planOutgoingSubjectFixes(fakeGit(), branch())
    if (!result.ok) throw new Error('expected ok')
    expect(result.rows[0].newMessage).toBe('feat: add config\n\nWhy: because.')
  })

  it('leaves a commit as pick when its draft fails, and says so', async () => {
    mockRunLint.mockResolvedValue({ data: { results: [bad(A, 'add config'), bad(B, 'fix it')] } })
    mockDraft.mockResolvedValueOnce('feat: add config').mockRejectedValueOnce(new Error('provider down'))
    const result = await planOutgoingSubjectFixes(fakeGit(), branch())
    if (!result.ok) throw new Error('expected ok')
    expect(result.rows.map((r) => r.action)).toEqual(['reword', 'pick'])
    expect(result.message).toMatch(/1 of 2 bad subjects.*1 could not be drafted and stay as pick/)
  })

  it('fails with guidance when no suggestion could be drafted', async () => {
    mockDraft.mockRejectedValue(new Error('No API key'))
    const result = await planOutgoingSubjectFixes(fakeGit(), branch())
    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/No subject suggestions could be drafted/) })
  })

  it(`drafts at most ${MAX_SUBJECT_FIXES} subjects and reports the rest`, async () => {
    const shas = Array.from({ length: 10 }, (_, i) => String(i).repeat(40))
    mockRunLint.mockResolvedValue({ data: { results: shas.map((s) => bad(s, 'bad subject')) } })
    mockPlanRows.mockResolvedValue({ ok: true, rows: shas.map((s) => row(s, 'bad subject')) })
    const result = await planOutgoingSubjectFixes(fakeGit({ shas }), branch())
    expect(mockDraft).toHaveBeenCalledTimes(MAX_SUBJECT_FIXES)
    if (!result.ok) throw new Error('expected ok')
    expect(result.message).toMatch(new RegExp(`${MAX_SUBJECT_FIXES} of 10.*2 more not drafted \\(limit ${MAX_SUBJECT_FIXES}\\)`))
  })
})
