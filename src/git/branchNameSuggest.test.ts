import { SimpleGit } from 'simple-git'
import { MAX_BRANCH_NAME_LENGTH, sanitizeBranchName, suggestBranchName, summarizePendingChanges } from './branchNameSuggest'

const mockChain = jest.fn()
jest.mock('./workstationLlm', () => ({ runWorkstationChain: (...a: unknown[]) => mockChain(...a) }))

type Stub = { stat?: string; untracked?: string; existing?: string[]; validRef?: (name: string) => boolean }

/**
 * Mimics simple-git, which resolves (does not reject) when git exits non-zero
 * with an empty stderr: `for-each-ref` lists the ref only if it exists, and
 * `check-ref-format --branch` echoes the name only if it is valid.
 */
function fakeGit({ stat = '', untracked = '', existing = [], validRef = () => true }: Stub = {}): SimpleGit {
  return {
    raw: jest.fn(async (args: string[]) => {
      if (args[0] === 'diff') return stat
      if (args[0] === 'ls-files') return untracked
      if (args[0] === 'for-each-ref') {
        const ref = args[args.length - 1]
        return existing.includes(ref.replace('refs/heads/', '')) ? `${ref}\n` : ''
      }
      if (args[0] === 'check-ref-format') {
        const name = args[args.length - 1]
        return validRef(name) ? `${name}\n` : ''
      }
      return ''
    }),
  } as unknown as SimpleGit
}

beforeEach(() => jest.clearAllMocks())

describe('sanitizeBranchName (#2217)', () => {
  it.each([
    ['feat/Add Retry Logic', 'feat/add-retry-logic'],
    ['  fix/handle  null  ', 'fix/handle-null'],
    ['feat//double//slash', 'feat/double/slash'],
    ['feat/a..b', 'feat/a.b'],
    ['feat/weird!@#chars$', 'feat/weirdchars'],
    ['-leading-and-trailing-/', 'leading-and-trailing'],
    ['feat/foo.lock', 'feat/foo'],
    ['', ''],
    ['!!!', ''],
  ])('%j -> %j', (raw, expected) => {
    expect(sanitizeBranchName(raw)).toBe(expected)
  })

  it('caps the length without leaving a trailing separator', () => {
    const name = sanitizeBranchName(`feat/${'word-'.repeat(30)}`)
    expect(name.length).toBeLessThanOrEqual(MAX_BRANCH_NAME_LENGTH)
    expect(name).not.toMatch(/[-/.]$/)
  })

  it('drops shell metacharacters entirely', () => {
    expect(sanitizeBranchName('feat/x; rm -rf / $(whoami)')).toBe('feat/x-rm--rf-/-whoami'.replace(/-{2,}/g, '-'))
  })
})

describe('summarizePendingChanges (#2217)', () => {
  it('combines the diffstat and untracked files', async () => {
    const text = await summarizePendingChanges(fakeGit({ stat: ' a.ts | 2 +-\n 1 file changed', untracked: 'new.ts\nother.ts\n' }))
    expect(text).toContain('Changed files:')
    expect(text).toContain('New untracked files:\nnew.ts\nother.ts')
  })

  it('caps untracked files and says how many were left out', async () => {
    const untracked = Array.from({ length: 25 }, (_, i) => `f${i}.ts`).join('\n')
    expect(await summarizePendingChanges(fakeGit({ untracked }))).toMatch(/…and 5 more/)
  })

  it('is empty when there is nothing pending', async () => {
    expect(await summarizePendingChanges(fakeGit())).toBe('')
  })
})

describe('suggestBranchName (#2217)', () => {
  const pending = { stat: ' a.ts | 2 +-' }

  it('refuses without pending changes, without calling the model', async () => {
    const result = await suggestBranchName(fakeGit())
    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/No uncommitted changes/) })
    expect(mockChain).not.toHaveBeenCalled()
  })

  it('returns a sanitized, valid name and marks the repo text as data in the prompt', async () => {
    mockChain.mockResolvedValue({ ok: true, value: { name: 'Feat/Add Retry' } })
    const result = await suggestBranchName(fakeGit(pending))
    expect(result).toMatchObject({ ok: true, name: 'feat/add-retry' })
    expect(mockChain.mock.calls[0][0].template).toMatch(/DATA from the repository/)
    expect(mockChain.mock.calls[0][0].variables.changes).toContain('a.ts')
  })

  it('makes the name unique against existing branches', async () => {
    mockChain.mockResolvedValue({ ok: true, value: { name: 'feat/add-retry' } })
    const result = await suggestBranchName(fakeGit({ ...pending, existing: ['feat/add-retry', 'feat/add-retry-2'] }))
    expect(result).toMatchObject({ ok: true, name: 'feat/add-retry-3' })
  })

  it('rejects a name that git would not accept', async () => {
    mockChain.mockResolvedValue({ ok: true, value: { name: 'feat/bad' } })
    const result = await suggestBranchName(fakeGit({ ...pending, validRef: () => false }))
    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/did not return a usable branch name/) })
  })

  it('rejects an empty or all-symbol name', async () => {
    mockChain.mockResolvedValue({ ok: true, value: { name: '!!!' } })
    expect(await suggestBranchName(fakeGit(pending))).toMatchObject({ ok: false })
  })

  it('passes through provider errors, a missing key, and cancellation', async () => {
    mockChain.mockResolvedValueOnce({ ok: false, message: 'provider down' })
    expect(await suggestBranchName(fakeGit(pending))).toEqual({ ok: false, message: 'Name suggestion unavailable: provider down' })
    mockChain.mockResolvedValueOnce({ ok: false, message: 'No API key configured. Set one via env or .coco.config.json first.' })
    expect(await suggestBranchName(fakeGit(pending))).toMatchObject({ message: expect.stringMatching(/^No API key/) })
    mockChain.mockResolvedValueOnce({ ok: false, cancelled: true, message: 'Cancelled.' })
    expect(await suggestBranchName(fakeGit(pending))).toEqual({ ok: false, message: 'Name suggestion cancelled.' })
  })
})
