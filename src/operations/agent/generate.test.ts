import { LangChainCancelledError } from '../../lib/langchain/errors'
import { executeChain } from '../../lib/langchain/utils/executeChain'
import { executeChainStreaming } from '../../lib/langchain/utils/executeChainStreaming'
import { getApiKeyForModel, getModelAndProviderFromConfig } from '../../lib/langchain/utils'
import { resolveDynamicService } from '../../lib/langchain/utils/dynamicModels'
import { getLlm } from '../../lib/langchain/utils/getLlm'
import { getTokenCounterForProvider } from '../../lib/utils/tokenizer'
import { loadConfig } from '../../lib/config/utils/loadConfig'
import { generateCommitDraft } from '../../commands/commit/generateCommitDraft'
import { AgentOperationContext, resolveChangeSource } from './context'
import {
  generateAgentChangelog,
  generateAgentCommitDraft,
  generateAgentRecap,
  generateAgentReview,
} from './generate'
import { AgentOptionsSchema, AgentTaskInput } from './schemas'

jest.mock('./context', () => ({
  resolveChangeSource: jest.fn(),
}))
jest.mock('../../lib/config/utils/loadConfig')
jest.mock('../../lib/langchain/utils')
jest.mock('../../lib/langchain/utils/dynamicModels')
jest.mock('../../lib/langchain/utils/getLlm')
jest.mock('../../lib/utils/tokenizer')
jest.mock('../../lib/langchain/utils/executeChain')
jest.mock('../../lib/langchain/utils/executeChainStreaming')
jest.mock('../../lib/langchain/utils/createSchemaParser', () => ({
  createSchemaParser: jest.fn().mockReturnValue({}),
}))
jest.mock('../../commands/commit/generateCommitDraft')

const mockResolveChangeSource = resolveChangeSource as jest.MockedFunction<typeof resolveChangeSource>
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
const mockExecuteChainStreaming = executeChainStreaming as jest.MockedFunction<typeof executeChainStreaming>
const mockGenerateCommitDraft = generateCommitDraft as jest.MockedFunction<typeof generateCommitDraft>

const baseInput: AgentTaskInput = {
  version: 1,
  source: { kind: 'summary', summary: 'Implemented the thing.' },
  options: AgentOptionsSchema.parse({}),
}

function makeContext(onProgress?: AgentOperationContext['onProgress']): AgentOperationContext {
  return {
    repoRoot: '/repo',
    // Only the fields generate.ts actually reads are exercised here.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    git: {} as any,
    logger: { setConfig: jest.fn(), verbose: jest.fn() } as unknown as AgentOperationContext['logger'],
    surface: 'mcp',
    onProgress,
  }
}

describe('agent generate progress reporting', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockResolveChangeSource.mockResolvedValue({
      text: 'diff content',
      meta: { kind: 'summary', digest: 'sha256:test', verification: 'provided-unverified' },
    })
    mockLoadConfig.mockReturnValue({
      service: {
        tokenLimit: 100000,
        authentication: { type: 'None' },
        streaming: { enabled: false },
        provider: 'test-provider',
      },
      prompt: undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    mockGetApiKeyForModel.mockReturnValue('test-key')
    mockGetModelAndProviderFromConfig.mockReturnValue({ provider: 'test-provider' } as never)
    mockResolveDynamicService.mockReturnValue({ model: 'test-model' } as never)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockGetLlm.mockResolvedValue({} as any)
    mockGetTokenCounterForProvider.mockResolvedValue(((text: string) => text.length) as never)
    mockExecuteChain.mockResolvedValue([{
      title: 'finding',
      summary: 'summary',
      severity: 5,
      category: 'bug',
      filePath: 'a.ts',
    }] as never)
  })

  describe('generateAgentReview (uses executeStructured)', () => {
    it('does not stream and reports only coarse stage boundaries when onProgress is absent', async () => {
      const context = makeContext(undefined)

      await generateAgentReview(baseInput, context)

      expect(mockExecuteChainStreaming).not.toHaveBeenCalled()
      expect(mockExecuteChain).toHaveBeenCalledTimes(1)
    })

    it('streams via executeChainStreaming and reports stage + chunk progress when onProgress is set', async () => {
      const onProgress = jest.fn()
      const context = makeContext(onProgress)
      mockExecuteChainStreaming.mockImplementation(async ({ onChunk }) => {
        onChunk({ text: 'a', accumulated: 'a' })
        onChunk({ text: 'b', accumulated: 'ab' })
        return [{
          title: 'finding',
          summary: 'summary',
          severity: 5,
          category: 'bug',
          filePath: 'a.ts',
        }] as never
      })

      await generateAgentReview(baseInput, context)

      expect(mockExecuteChainStreaming).toHaveBeenCalledTimes(1)
      expect(mockExecuteChain).not.toHaveBeenCalled()

      const messages = onProgress.mock.calls.map((call) => call[0].message)
      expect(messages).toEqual([
        'Resolved changes',
        'Generating review…',
        'Generating review…',
        'Generating review…',
        'Completed',
      ])
    })

    it('falls back to executeChain when streaming fails for a non-cancellation reason', async () => {
      const onProgress = jest.fn()
      const context = makeContext(onProgress)
      mockExecuteChainStreaming.mockRejectedValueOnce(new Error('provider does not support streaming'))

      const result = await generateAgentReview(baseInput, context)

      expect(mockExecuteChainStreaming).toHaveBeenCalledTimes(1)
      expect(mockExecuteChain).toHaveBeenCalledTimes(1)
      expect(result.data.findings).toHaveLength(1)
    })

    it('propagates a cancellation from the streaming attempt without falling back', async () => {
      const onProgress = jest.fn()
      const context = makeContext(onProgress)
      mockExecuteChainStreaming.mockRejectedValueOnce(new LangChainCancelledError('cancelled', ''))

      await expect(generateAgentReview(baseInput, context)).rejects.toBeInstanceOf(LangChainCancelledError)
      expect(mockExecuteChain).not.toHaveBeenCalled()
    })

    it('returns the identical envelope whether or not onProgress is supplied', async () => {
      mockExecuteChainStreaming.mockResolvedValueOnce([{
        title: 'finding',
        summary: 'summary',
        severity: 5,
        category: 'bug',
        filePath: 'a.ts',
      }] as never)
      const withoutProgress = await generateAgentReview(baseInput, makeContext(undefined))
      const withProgress = await generateAgentReview(baseInput, makeContext(jest.fn()))

      expect(withoutProgress).toEqual(withProgress)
    })
  })

  describe('generateAgentChangelog / generateAgentRecap (share executeStructured)', () => {
    it('reports stage boundaries for changelog', async () => {
      // onProgress is set, so executeStructured takes the streaming path;
      // the mock resolves without invoking onChunk so only the coarse
      // stage-boundary messages appear.
      mockExecuteChainStreaming.mockResolvedValueOnce({ title: 't', content: 'c' } as never)
      const onProgress = jest.fn()
      await generateAgentChangelog(baseInput, makeContext(onProgress))

      expect(onProgress.mock.calls.map((call) => call[0].message)).toEqual([
        'Resolved changes',
        'Generating changelog…',
        'Completed',
      ])
    })

    it('reports stage boundaries for recap', async () => {
      mockExecuteChainStreaming.mockResolvedValueOnce({ title: 't', summary: 's' } as never)
      const onProgress = jest.fn()
      await generateAgentRecap(baseInput, makeContext(onProgress))

      expect(onProgress.mock.calls.map((call) => call[0].message)).toEqual([
        'Resolved changes',
        'Generating recap…',
        'Completed',
      ])
    })
  })

  describe('generateAgentCommitDraft', () => {
    beforeEach(() => {
      mockGenerateCommitDraft.mockResolvedValue({
        ok: true,
        draft: 'feat: add thing',
        message: { title: 'feat: add thing', body: '', formatted: 'feat: add thing' },
        warnings: [],
        validationErrors: [],
      })
    })

    it('reports coarse stage boundaries and passes no onStreamChunk when onProgress is absent', async () => {
      const context = makeContext(undefined)
      await generateAgentCommitDraft(baseInput, context)

      expect(mockGenerateCommitDraft).toHaveBeenCalledTimes(1)
      expect(mockGenerateCommitDraft.mock.calls[0][0].onStreamChunk).toBeUndefined()
    })

    it('passes an onStreamChunk that forwards progress when onProgress is set', async () => {
      const onProgress = jest.fn()
      const context = makeContext(onProgress)

      await generateAgentCommitDraft(baseInput, context)

      const onStreamChunk = mockGenerateCommitDraft.mock.calls[0][0].onStreamChunk
      expect(onStreamChunk).toBeInstanceOf(Function)
      onProgress.mockClear()
      onStreamChunk!('x', 'x')

      expect(onProgress).toHaveBeenCalledWith({ message: 'Generating commit-draft…', fraction: undefined })
    })

    it('returns the identical envelope whether or not onProgress is supplied', async () => {
      const withoutProgress = await generateAgentCommitDraft(baseInput, makeContext(undefined))
      const withProgress = await generateAgentCommitDraft(baseInput, makeContext(jest.fn()))

      expect(withoutProgress).toEqual(withProgress)
    })
  })
})
