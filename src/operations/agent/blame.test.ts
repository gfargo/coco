import { BlameLine } from '../../git/blameData'
import { getBlame } from '../../git/blameData'
import { GitCommitDetail, getCommitDetail } from '../../git/logData'
import { loadConfig } from '../../lib/config/utils/loadConfig'
import { getApiKeyForModel, getModelAndProviderFromConfig } from '../../lib/langchain/utils'
import { resolveDynamicService } from '../../lib/langchain/utils/dynamicModels'
import { executeChain } from '../../lib/langchain/utils/executeChain'
import { getLlm } from '../../lib/langchain/utils/getLlm'
import { getTokenCounterForProvider } from '../../lib/utils/tokenizer'
import { AgentOperationContext } from './context'
import { AgentOperationError } from './errors'
import { runBlame } from './generate'
import { BlameRequestSchema } from './schemas'

jest.mock('../../git/blameData')
jest.mock('../../git/logData')
jest.mock('../../lib/config/utils/loadConfig')
jest.mock('../../lib/langchain/utils')
jest.mock('../../lib/langchain/utils/dynamicModels')
jest.mock('../../lib/langchain/utils/getLlm')
jest.mock('../../lib/utils/tokenizer')
jest.mock('../../lib/langchain/utils/executeChain')
jest.mock('../../lib/langchain/utils/createSchemaParser', () => ({
  createSchemaParser: jest.fn().mockReturnValue({}),
}))

const mockGetBlame = getBlame as jest.MockedFunction<typeof getBlame>
const mockGetCommitDetail = getCommitDetail as jest.MockedFunction<typeof getCommitDetail>
const mockLoadConfig = loadConfig as jest.MockedFunction<typeof loadConfig>
const mockGetApiKeyForModel = getApiKeyForModel as jest.MockedFunction<typeof getApiKeyForModel>
const mockGetModelAndProviderFromConfig = getModelAndProviderFromConfig as jest.MockedFunction<
  typeof getModelAndProviderFromConfig
>
const mockResolveDynamicService = resolveDynamicService as jest.MockedFunction<typeof resolveDynamicService>
const mockGetLlm = getLlm as jest.MockedFunction<typeof getLlm>
const mockGetTokenCounterForProvider = getTokenCounterForProvider as jest.MockedFunction<
  typeof getTokenCounterForProvider
>
const mockExecuteChain = executeChain as jest.MockedFunction<typeof executeChain>

function makeLines(count: number): BlameLine[] {
  return Array.from({ length: count }, (_, index) => ({
    hash: `commit${index}`.padEnd(40, '0'),
    shortHash: `commit${index}`.slice(0, 8),
    author: 'Someone',
    authorTime: 0,
    lineNumber: index + 1,
    content: `line ${index + 1}`,
  }))
}

// `git: null` (as opposed to omitting the argument) simulates a context with
// no git binding — a plain `undefined` default can't be distinguished from
// an explicitly-passed `undefined`, so callers that want "no git" pass `null`.
function makeContext(git: object | null = {}): AgentOperationContext {
  return {
    repoRoot: '/repo',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    git: (git === null ? undefined : git) as any,
    logger: { setConfig: jest.fn(), verbose: jest.fn() } as unknown as AgentOperationContext['logger'],
    surface: 'mcp',
  }
}

function makeDetail(overrides: Partial<GitCommitDetail> = {}): GitCommitDetail {
  return {
    shortHash: 'abc1234',
    hash: 'a'.repeat(40),
    parents: [],
    date: '2026-01-01',
    author: 'Someone',
    refs: [],
    message: 'fix: something',
    body: '',
    files: [],
    stats: { filesChanged: 0, insertions: 0, deletions: 0 },
    ...overrides,
  }
}

describe('runBlame', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockLoadConfig.mockReturnValue({
      service: {
        tokenLimit: 2048,
        authentication: { type: 'APIKey', credentials: { apiKey: 'test-key' } },
        provider: 'openai',
      },
      prompt: undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    mockGetApiKeyForModel.mockReturnValue('test-key')
    mockGetModelAndProviderFromConfig.mockReturnValue({ provider: 'openai' } as never)
    mockResolveDynamicService.mockReturnValue({ model: 'test-model' } as never)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockGetLlm.mockResolvedValue({} as any)
    mockGetTokenCounterForProvider.mockResolvedValue(((text: string) => text.length) as never)
  })

  it('throws INVALID_REPOSITORY when the context has no git binding', async () => {
    const input = BlameRequestSchema.parse({ file: 'a.ts' })
    await expect(runBlame(input, makeContext(null))).rejects.toMatchObject({
      code: 'INVALID_REPOSITORY',
    })
  })

  it('throws INVALID_INPUT for a malformed lines range', async () => {
    const input = BlameRequestSchema.parse({ file: 'a.ts', lines: 'nonsense' })
    await expect(runBlame(input, makeContext())).rejects.toBeInstanceOf(AgentOperationError)
    await expect(runBlame(input, makeContext())).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('throws BLAME_FAILED when git blame fails', async () => {
    mockGetBlame.mockResolvedValue({ ok: false, path: 'a.ts', message: 'fatal: no such path' })
    const input = BlameRequestSchema.parse({ file: 'a.ts' })
    await expect(runBlame(input, makeContext())).rejects.toMatchObject({ code: 'BLAME_FAILED' })
  })

  it('returns an empty-lines envelope with a warning when nothing matches', async () => {
    mockGetBlame.mockResolvedValue({ ok: true, path: 'a.ts', lines: [] })
    const input = BlameRequestSchema.parse({ file: 'a.ts' })
    const result = await runBlame(input, makeContext())

    expect(result.data).toEqual({ path: 'a.ts', lines: [] })
    expect(result.warnings[0]).toContain('No blame lines found')
    expect(mockLoadConfig).not.toHaveBeenCalled()
  })

  it('returns raw blame lines and never touches config when explain is false', async () => {
    mockGetBlame.mockResolvedValue({ ok: true, path: 'a.ts', lines: makeLines(3) })
    const input = BlameRequestSchema.parse({ file: 'a.ts' })
    const result = await runBlame(input, makeContext())

    expect(result.data.lines).toHaveLength(3)
    expect(result.data.explanations).toBeUndefined()
    expect(mockLoadConfig).not.toHaveBeenCalled()
  })

  it('respects the lines range filter', async () => {
    mockGetBlame.mockResolvedValue({ ok: true, path: 'a.ts', lines: makeLines(10) })
    const input = BlameRequestSchema.parse({ file: 'a.ts', lines: '3:5' })
    const result = await runBlame(input, makeContext())

    expect(result.data.lines!.map((l) => l.lineNumber)).toEqual([3, 4, 5])
  })

  it('throws AUTHENTICATION_REQUIRED when explain is requested without an API key', async () => {
    mockGetBlame.mockResolvedValue({ ok: true, path: 'a.ts', lines: makeLines(3) })
    mockGetApiKeyForModel.mockReturnValue('')
    const input = BlameRequestSchema.parse({ file: 'a.ts', explain: true })

    await expect(runBlame(input, makeContext())).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED' })
  })

  it('throws EXPLAIN_RANGE_TOO_LARGE beyond the 400-line cap', async () => {
    mockGetBlame.mockResolvedValue({ ok: true, path: 'a.ts', lines: makeLines(401) })
    const input = BlameRequestSchema.parse({ file: 'a.ts', explain: true })

    await expect(runBlame(input, makeContext())).rejects.toMatchObject({ code: 'EXPLAIN_RANGE_TOO_LARGE' })
    expect(mockGetLlm).not.toHaveBeenCalled()
  })

  it('excludes uncommitted lines and reports nothing to explain', async () => {
    const uncommitted = makeLines(2).map((line) => ({ ...line, hash: '0'.repeat(40), shortHash: 'staged  ' }))
    mockGetBlame.mockResolvedValue({ ok: true, path: 'a.ts', lines: uncommitted })
    const input = BlameRequestSchema.parse({ file: 'a.ts', explain: true })

    const result = await runBlame(input, makeContext())

    expect(result.data).toEqual({ path: 'a.ts', explanations: [] })
    expect(result.warnings[0]).toContain('uncommitted')
    expect(mockGetLlm).not.toHaveBeenCalled()
  })

  it('resolves explanations for each introducing commit', async () => {
    const lines = makeLines(2)
    mockGetBlame.mockResolvedValue({ ok: true, path: 'a.ts', lines })
    mockGetCommitDetail.mockImplementation(async (_git, hash) => makeDetail({ hash, message: `commit ${hash}` }))
    mockExecuteChain.mockResolvedValue([
      { hash: lines[0].hash, explanation: 'Explanation one.' },
      { hash: lines[1].hash, explanation: 'Explanation two.' },
    ] as never)

    const input = BlameRequestSchema.parse({ file: 'a.ts', explain: true })
    const result = await runBlame(input, makeContext())

    expect(result.data.lines).toBeUndefined()
    expect(result.data.explanations).toHaveLength(2)
    expect(result.data.explanations![0]).toMatchObject({
      hash: lines[0].hash,
      explanation: 'Explanation one.',
    })
    expect(result.data.truncated).toBeUndefined()
  })

  it('falls back to a default message when the model omits an explanation', async () => {
    const lines = makeLines(1)
    mockGetBlame.mockResolvedValue({ ok: true, path: 'a.ts', lines })
    mockGetCommitDetail.mockResolvedValue(makeDetail({ hash: lines[0].hash }))
    mockExecuteChain.mockResolvedValue([] as never)

    const input = BlameRequestSchema.parse({ file: 'a.ts', explain: true })
    const result = await runBlame(input, makeContext())

    expect(result.data.explanations![0].explanation).toBe('No explanation returned by the model.')
  })

  it('marks truncated and warns when more than 25 distinct commits touch the range', async () => {
    const lines = Array.from({ length: 30 }, (_, index) => ({
      hash: `commit${index}`.padEnd(40, '0'),
      shortHash: `commit${index}`.slice(0, 8),
      author: 'Someone',
      authorTime: 0,
      lineNumber: index + 1,
      content: `line ${index + 1}`,
    }))
    mockGetBlame.mockResolvedValue({ ok: true, path: 'a.ts', lines })
    mockGetCommitDetail.mockImplementation(async (_git, hash) => makeDetail({ hash }))
    mockExecuteChain.mockResolvedValue(
      lines.slice(0, 25).map((line) => ({ hash: line.hash, explanation: 'why' })) as never
    )

    const input = BlameRequestSchema.parse({ file: 'a.ts', explain: true })
    const result = await runBlame(input, makeContext())

    expect(result.data.explanations).toHaveLength(25)
    expect(result.data.truncated).toBe(true)
    expect(result.warnings[0]).toContain('only the first 25 were explained')
  })

  it('throws a retryable GENERATION_FAILED error when the LLM call fails', async () => {
    const lines = makeLines(1)
    mockGetBlame.mockResolvedValue({ ok: true, path: 'a.ts', lines })
    mockGetCommitDetail.mockResolvedValue(makeDetail({ hash: lines[0].hash }))
    mockExecuteChain.mockRejectedValue(new Error('rate limited'))

    const input = BlameRequestSchema.parse({ file: 'a.ts', explain: true })
    await expect(runBlame(input, makeContext())).rejects.toMatchObject({
      code: 'GENERATION_FAILED',
      retryable: true,
    })
  })
})
