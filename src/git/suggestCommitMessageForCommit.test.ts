import { SimpleGit } from 'simple-git'
import { suggestCommitMessageForCommit } from './commitWorkflowActions'

const mockDraft = jest.fn()
const mockChanges = jest.fn()

jest.mock('../commands/commit/generateCommitDraft', () => ({ generateCommitDraft: (...a: unknown[]) => mockDraft(...a) }))
jest.mock('../lib/simple-git/getChangesByCommit', () => ({ getChangesByCommit: (...a: unknown[]) => mockChanges(...a) }))

const SHA = 'c'.repeat(40)
const git = (body = '') => ({ raw: jest.fn().mockResolvedValue(`${body}\n`) }) as unknown as SimpleGit
const drafted = (title: string) => ({ ok: true, draft: title, message: { title, body: '', formatted: title }, warnings: [], validationErrors: [] })

beforeEach(() => {
  jest.resetAllMocks()
  mockChanges.mockResolvedValue([{ filePath: 'a.ts', status: 'modified', summary: 'a.ts' }])
  mockDraft.mockResolvedValue(drafted('feat: add thing'))
})

describe('suggestCommitMessageForCommit (#2216)', () => {
  it("drafts conventional from the commit's own diff range, never a bare sha", async () => {
    await suggestCommitMessageForCommit(git(), SHA)
    const call = mockDraft.mock.calls[0][0]
    expect(call.changeSource.commitRef).toBe(`${SHA}^..${SHA}`)
    expect(call.argv.conventional).toBe(true)
    expect(mockChanges).toHaveBeenCalledWith({ commit: SHA, options: { git: expect.anything() } })
  })

  it('returns just the title when the commit had no body', async () => {
    expect(await suggestCommitMessageForCommit(git(), SHA)).toBe('feat: add thing')
  })

  it('keeps the original body under the drafted title', async () => {
    expect(await suggestCommitMessageForCommit(git('Why: because.'), SHA)).toBe('feat: add thing\n\nWhy: because.')
  })

  it('returns undefined for an empty commit or a failed draft', async () => {
    mockChanges.mockResolvedValue([])
    expect(await suggestCommitMessageForCommit(git(), SHA)).toBeUndefined()
    mockChanges.mockResolvedValue([{ filePath: 'a.ts', status: 'modified', summary: 'a.ts' }])
    mockDraft.mockResolvedValue({ ok: false, draft: '', warnings: [], validationErrors: ['x'] })
    expect(await suggestCommitMessageForCommit(git(), SHA)).toBeUndefined()
  })
})
