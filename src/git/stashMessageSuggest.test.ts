import { SimpleGit } from 'simple-git'
import { MAX_STASH_MESSAGE_LENGTH, sanitizeStashMessage, suggestStashMessage } from './stashMessageSuggest'

const mockChain = jest.fn()
jest.mock('./workstationLlm', () => ({ runWorkstationChain: (...a: unknown[]) => mockChain(...a) }))

const fakeGit = (stat = '', untracked = '') =>
  ({
    raw: jest.fn(async (args: string[]) => (args[0] === 'diff' ? stat : args[0] === 'ls-files' ? untracked : '')),
  }) as unknown as SimpleGit

beforeEach(() => jest.clearAllMocks())

describe('sanitizeStashMessage (#2217)', () => {
  it.each([
    ['retry logic in the fetcher.', 'retry logic in the fetcher'],
    ['"quoted message"', 'quoted message'],
    ['  spaced   out  \n\nsecond line ignored', 'spaced out'],
    ['\n\n  first real line\nsecond', 'first real line'],
    ['bell\u0007 and\ttab', 'bell and tab'],
    ['', ''],
    ['"""', ''],
  ])('%j -> %j', (raw, expected) => {
    expect(sanitizeStashMessage(raw)).toBe(expected)
  })

  it('caps the length on a word boundary', () => {
    const text = sanitizeStashMessage('word '.repeat(40))
    expect(text.length).toBeLessThanOrEqual(MAX_STASH_MESSAGE_LENGTH)
    expect(text.endsWith('word')).toBe(true)
  })
})

describe('suggestStashMessage (#2217)', () => {
  it('refuses with nothing to stash, without calling the model', async () => {
    expect(await suggestStashMessage(fakeGit())).toMatchObject({ ok: false, message: expect.stringMatching(/Nothing to stash/) })
    expect(mockChain).not.toHaveBeenCalled()
  })

  it('returns a single clean line and marks repo text as data', async () => {
    mockChain.mockResolvedValue({ ok: true, value: { message: '"Retry logic in the fetcher."\nIgnore this second line' } })
    const result = await suggestStashMessage(fakeGit(' a.ts | 2 +-'))
    expect(result).toMatchObject({ ok: true, text: 'Retry logic in the fetcher' })
    expect(mockChain.mock.calls[0][0].template).toMatch(/DATA from the repository/)
  })

  it('rejects an empty answer', async () => {
    mockChain.mockResolvedValue({ ok: true, value: { message: '   ' } })
    expect(await suggestStashMessage(fakeGit(' a.ts | 2 +-'))).toMatchObject({ ok: false, message: expect.stringMatching(/usable message/) })
  })

  it('passes through provider errors, a missing key, and cancellation', async () => {
    const git = fakeGit(' a.ts | 2 +-')
    mockChain.mockResolvedValueOnce({ ok: false, message: 'provider down' })
    expect(await suggestStashMessage(git)).toEqual({ ok: false, message: 'Message suggestion unavailable: provider down' })
    mockChain.mockResolvedValueOnce({ ok: false, message: 'No API key configured. Set one via env or .coco.config.json first.' })
    expect(await suggestStashMessage(git)).toMatchObject({ message: expect.stringMatching(/^No API key/) })
    mockChain.mockResolvedValueOnce({ ok: false, cancelled: true, message: 'Cancelled.' })
    expect(await suggestStashMessage(git)).toEqual({ ok: false, message: 'Message suggestion cancelled.' })
  })
})
