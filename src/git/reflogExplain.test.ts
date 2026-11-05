import { LangChainCancelledError } from '../lib/langchain/errors'
import type { ReflogViewEntry } from './reflogData'
import {
  REFLOG_EXPLAIN_LIMIT,
  explainRecentReflog,
  formatReflogEntries,
  formatReflogExplanation,
} from './reflogExplain'

const mockExecute = jest.fn()
const mockLoadConfig = jest.fn()
const mockApiKey = jest.fn()

jest.mock('../lib/config/utils/loadConfig', () => ({ loadConfig: (...a: unknown[]) => mockLoadConfig(...a) }))
jest.mock('../lib/langchain/utils', () => ({
  getApiKeyForModel: (...a: unknown[]) => mockApiKey(...a),
  getModelAndProviderFromConfig: () => ({ provider: 'openai', model: 'gpt-5.4-nano' }),
}))
jest.mock('../lib/langchain/utils/dynamicModels', () => ({ resolveDynamicService: () => ({ model: 'gpt-5.4-nano' }) }))
jest.mock('../lib/langchain/utils/getLlm', () => ({ getLlm: jest.fn().mockResolvedValue({}) }))
jest.mock('../lib/langchain/utils/executeChain', () => ({ executeChain: (...a: unknown[]) => mockExecute(...a) }))

const entry = (i: number, subject: string): ReflogViewEntry => ({
  selector: `HEAD@{${i}}`,
  hash: `abc${i}000`,
  relativeDate: `${i} minutes ago`,
  subject,
})

const entries = [
  entry(0, 'reset: moving to HEAD~3'),
  entry(1, 'commit: add retry'),
  entry(2, 'commit: add tests'),
  entry(3, 'checkout: moving from main to feat/x'),
]

beforeEach(() => {
  jest.clearAllMocks()
  mockLoadConfig.mockReturnValue({ service: { authentication: { type: 'APIKey' } } })
  mockApiKey.mockReturnValue('sk-test')
})

describe('formatReflogEntries (#2217)', () => {
  it('lists selector, hash, age and subject on one line each, collapsing whitespace', () => {
    expect(formatReflogEntries([entry(0, 'commit: a\n\nmultiline   body')])).toBe(
      'HEAD@{0} abc0000 (0 minutes ago) commit: a multiline body',
    )
  })
})

describe('formatReflogExplanation (#2217)', () => {
  const base = { summary: 'You committed twice then hard-reset three commits back.', reasoning: 'That is the state before the reset.' }

  it('shows a recommended target only when it is one of the entries we sent', () => {
    const result = formatReflogExplanation({ ...base, recommendedTarget: 'HEAD@{1}' }, entries)
    expect(result.ok).toBe(true)
    expect(result.message).toBe('Explained the last 4 reflog entries. Nothing was changed.')
    expect(result.details).toEqual([
      'You committed twice then hard-reset three commits back.',
      'Recommended target: HEAD@{1} (abc1000, 1 minutes ago) — That is the state before the reset.',
      'To go there: git reset --hard HEAD@{1}  (or move to it in the reflog view)',
    ])
  })

  it('drops a hallucinated or injected selector instead of suggesting it', () => {
    for (const target of ['HEAD@{99}', 'rm -rf /', 'origin/main', '']) {
      const result = formatReflogExplanation({ ...base, recommendedTarget: target }, entries)
      expect(result.details?.some((line) => /Recommended target|To go there/.test(line))).toBe(false)
    }
  })

  it('says no undo is recommended for "none"', () => {
    const result = formatReflogExplanation({ ...base, recommendedTarget: 'None' }, entries)
    expect(result.details).toContain('No undo recommended: this looks like normal work.')
  })

  it('appends what the undo key would do, for reference', () => {
    const result = formatReflogExplanation({ ...base, recommendedTarget: 'none' }, entries, 'Undo reset: reset --hard to the previous HEAD.')
    expect(result.details?.[result.details.length - 1]).toBe('For reference, the undo key would: Undo reset: reset --hard to the previous HEAD.')
  })

  it('singularizes one entry', () => {
    expect(formatReflogExplanation({ ...base, recommendedTarget: 'none' }, [entry(0, 'commit: x')]).message).toMatch(/last 1 reflog entry\./)
  })
})

describe('explainRecentReflog (#2217)', () => {
  it('reports an empty reflog without calling the model', async () => {
    expect(await explainRecentReflog([])).toMatchObject({ ok: false, message: 'No reflog entries to explain yet.' })
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('asks for a key when none is configured', async () => {
    mockApiKey.mockReturnValue('')
    const result = await explainRecentReflog(entries)
    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/No API key/) })
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('sends only the newest entries, marks them as data, and includes the undo plan', async () => {
    mockExecute.mockResolvedValue({ summary: 's', recommendedTarget: 'none', reasoning: 'r' })
    const many = Array.from({ length: REFLOG_EXPLAIN_LIMIT + 5 }, (_, i) => entry(i, `commit: c${i}`))
    await explainRecentReflog(many)
    const { variables, prompt } = mockExecute.mock.calls[0][0]
    expect(variables.entries.split('\n')).toHaveLength(REFLOG_EXPLAIN_LIMIT)
    expect(variables.undo_plan).toMatch(/reset --hard/)
    expect(prompt.template).toMatch(/DATA copied from the repository/)
  })

  it('returns a formatted explanation on success', async () => {
    mockExecute.mockResolvedValue({ summary: 'You reset.', recommendedTarget: 'HEAD@{1}', reasoning: 'Before the reset.' })
    const result = await explainRecentReflog(entries)
    expect(result.ok).toBe(true)
    expect(result.details?.[0]).toBe('You reset.')
  })

  it('reports cancellation and provider errors without throwing', async () => {
    mockExecute.mockRejectedValueOnce(new LangChainCancelledError('aborted'))
    expect(await explainRecentReflog(entries)).toEqual({ ok: false, message: 'Reflog explanation cancelled.' })
    mockExecute.mockRejectedValueOnce(new Error('provider down\nstack'))
    expect(await explainRecentReflog(entries)).toEqual({ ok: false, message: 'Explanation unavailable: provider down' })
  })
})
