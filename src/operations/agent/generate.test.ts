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
import { AgentOperationError } from './errors'
import {
  generateAgentChangelog,
  generateAgentCommitDraft,
  generateAgentRecap,
  generateAgentPrDraft,
  generateAgentSplitPlan,
  runAgentBatch,
  applySeverityThreshold,
  generateAgentReview,
} from './generate'
import { AGENT_PROTOCOL_VERSION, AgentOptionsSchema, AgentTaskInput } from './schemas'

jest.mock('./context', () => ({
  resolveChangeSource: jest.fn(),
  readStagedFileChanges: jest.fn(),
  readStagedFileDiff: jest.fn(),
  readPullRequestBranches: jest.fn(),
  getConventionsContext: jest.fn().mockReturnValue({ text: '', provenance: null }),
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
jest.mock('../../commands/commit/splitPlanGenerator', () => ({
  ...jest.requireActual('../../commands/commit/splitPlanGenerator'),
  generateValidatedCommitSplitPlan: jest.fn(),
}))

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
      warnings: [],
      meta: { kind: 'summary', digest: 'sha256:test', verification: 'provided-unverified' },
    })
    mockLoadConfig.mockReturnValue({
      service: {
        tokenLimit: 100000,
        authentication: { type: 'None' },
        streaming: { enabled: true },
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

    it('loads config against the resolved repo root, not process.cwd() (OSS-1220)', async () => {
      // createRuntime's loadConfig call must be given the context's
      // resolved repoRoot explicitly — deferred-binding MCP mode never
      // chdirs, so falling back to process.cwd() would silently skip the
      // target repository's .coco.json.
      const context = makeContext(undefined)

      await generateAgentReview(baseInput, context)

      expect(mockLoadConfig).toHaveBeenCalledWith(
        expect.anything(),
        { cwd: context.repoRoot },
      )
    })

    it('streams via executeChainStreaming and reports stage + chunk progress when onProgress is set', async () => {
      const onProgress = jest.fn()
      const context = makeContext(onProgress)
      mockExecuteChainStreaming.mockImplementation(async ({ onChunk }) => {
        onChunk({ text: 'a', accumulated: 'a' })
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
        'Completed',
      ])
    })

    it('throttles rapid chunk ticks to at most one notification per interval', async () => {
      const onProgress = jest.fn()
      const context = makeContext(onProgress)
      const realNow = Date.now
      let now = 1_000_000
      jest.spyOn(Date, 'now').mockImplementation(() => now)
      try {
        mockExecuteChainStreaming.mockImplementation(async ({ onChunk }) => {
          onChunk({ text: 'a', accumulated: 'a' })
          onChunk({ text: 'b', accumulated: 'ab' }) // within the throttle window: suppressed
          now += 300 // advance past the throttle window
          onChunk({ text: 'c', accumulated: 'abc' })
          return [{
            title: 'finding',
            summary: 'summary',
            severity: 5,
            category: 'bug',
            filePath: 'a.ts',
          }] as never
        })

        await generateAgentReview(baseInput, context)

        const messages = onProgress.mock.calls.map((call) => call[0].message)
        expect(messages).toEqual([
          'Resolved changes',
          'Generating review…',
          'Generating review…',
          'Generating review…',
          'Completed',
        ])
      } finally {
        jest.spyOn(Date, 'now').mockImplementation(realNow)
      }
    })

    it('does not stream when the streaming master switch is disabled, even with onProgress set', async () => {
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
      const onProgress = jest.fn()
      const context = makeContext(onProgress)

      await generateAgentReview(baseInput, context)

      expect(mockExecuteChainStreaming).not.toHaveBeenCalled()
      expect(mockExecuteChain).toHaveBeenCalledTimes(1)
    })

    it('falls back to executeChain when streaming fails for a non-cancellation reason', async () => {
      const onProgress = jest.fn()
      const context = makeContext(onProgress)
      mockExecuteChainStreaming.mockRejectedValueOnce(new Error('provider does not support streaming'))

      const result = await generateAgentReview(baseInput, context)

      expect(mockExecuteChainStreaming).toHaveBeenCalledTimes(1)
      expect(mockExecuteChain).toHaveBeenCalledTimes(1)
      if (result.status !== 'completed') throw new Error('expected a completed envelope')
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

    it('swallows a throwing onProgress callback and still completes generation', async () => {
      const onProgress = jest.fn(() => {
        throw new Error('client-side handler exploded')
      })
      const context = makeContext(onProgress)
      mockExecuteChainStreaming.mockImplementation(async ({ onChunk }) => {
        onChunk({ text: 'a', accumulated: 'a' })
        return [{
          title: 'finding',
          summary: 'summary',
          severity: 5,
          category: 'bug',
          filePath: 'a.ts',
        }] as never
      })

      const result = await generateAgentReview(baseInput, context)

      if (result.status !== 'completed') throw new Error('expected a completed envelope')
      expect(result.data.findings).toHaveLength(1)
      // Called once per stage boundary/chunk tick despite always throwing.
      expect(onProgress).toHaveBeenCalledTimes(4)
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

  describe('truncation warnings surface in the envelope (#1843)', () => {
    // The core bug: executeStructured computed budgeted.truncated and threw
    // it away, so a review/changelog/recap that silently analyzed only a
    // fraction of the diff reported ok: true with no warning at all — an
    // agent or CI --severity gate had no signal to distinguish "clean" from
    // "only saw half the diff".
    //
    // 2500 is comfortably above every prompt template's fixed overhead
    // (~1100-1600 chars observed) so budgeting never throws before even
    // adding the change text, and a 5000-char mocked diff is comfortably
    // larger than that budget so truncation reliably engages for all three
    // operations regardless of their differing template overhead.
    const TRUNCATING_TOKEN_LIMIT = 2500

    function mockTruncatingBudget() {
      mockLoadConfig.mockReturnValue({
        service: {
          tokenLimit: TRUNCATING_TOKEN_LIMIT,
          authentication: { type: 'None' },
          streaming: { enabled: false },
          provider: 'test-provider',
        },
        prompt: undefined,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
      mockResolveChangeSource.mockResolvedValue({
        text: 'x'.repeat(5000),
        warnings: [],
        meta: { kind: 'summary', digest: 'sha256:test', verification: 'provided-unverified' },
      })
    }

    it('adds a truncation warning to the review envelope when the budget is exceeded', async () => {
      mockTruncatingBudget()
      const result = await generateAgentReview(baseInput, makeContext(undefined))

      if (result.status !== 'completed') throw new Error('expected a completed envelope')
      expect(result.warnings.some((w) => w.includes('truncated'))).toBe(true)
    })

    it('adds a truncation warning to the changelog envelope when the budget is exceeded', async () => {
      mockTruncatingBudget()
      mockExecuteChain.mockResolvedValueOnce({ title: 't', content: 'c' } as never)
      const result = await generateAgentChangelog(baseInput, makeContext(undefined))

      if (result.status !== 'completed') throw new Error('expected a completed envelope')
      expect(result.warnings.some((w) => w.includes('truncated'))).toBe(true)
    })

    it('adds a truncation warning to the recap envelope when the budget is exceeded', async () => {
      mockTruncatingBudget()
      mockExecuteChain.mockResolvedValueOnce({ title: 't', summary: 's' } as never)
      const result = await generateAgentRecap(baseInput, makeContext(undefined))

      if (result.status !== 'completed') throw new Error('expected a completed envelope')
      expect(result.warnings.some((w) => w.includes('truncated'))).toBe(true)
    })

    it('does not add a truncation warning when the budget is not exceeded', async () => {
      const result = await generateAgentReview(baseInput, makeContext(undefined))

      if (result.status !== 'completed') throw new Error('expected a completed envelope')
      expect(result.warnings.some((w) => w.includes('truncated'))).toBe(false)
    })

    it('preserves resolveChangeSource warnings alongside the truncation warning', async () => {
      // mockTruncatingBudget() sets up the long diff text needed to force
      // truncation — set the extra warning after it, not before, or this
      // override wipes that text back to the short default.
      mockTruncatingBudget()
      mockResolveChangeSource.mockResolvedValue({
        text: 'x'.repeat(5000),
        warnings: ['some other warning'],
        meta: { kind: 'summary', digest: 'sha256:test', verification: 'provided-unverified' },
      })

      const result = await generateAgentReview(baseInput, makeContext(undefined))

      if (result.status !== 'completed') throw new Error('expected a completed envelope')
      expect(result.warnings).toContain('some other warning')
      expect(result.warnings.some((w) => w.includes('truncated'))).toBe(true)
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

    it('passes the resolved repo root as cwd so config loading is not silently dropped (OSS-1220)', async () => {
      // In MCP deferred-binding mode the server never chdirs, so any config
      // load that only ever checked process.cwd() would silently ignore
      // the target repository's .coco.json. Both loadConfig (via
      // createRuntime, exercised by generateAgentReview above) and
      // generateCommitDraft must receive the context's resolved repoRoot
      // explicitly instead of relying on cwd.
      const context = makeContext(undefined)
      await generateAgentCommitDraft(baseInput, context)

      expect(mockGenerateCommitDraft.mock.calls[0][0].cwd).toBe(context.repoRoot)
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

// Unit tests for generateAgentCommitDraft's retryable flag (OSS-1326 / #1854):
// validation failures must be marked retryable: true because they are
// self-inflicted and a fresh sampling attempt would likely succeed.
describe('generateAgentCommitDraft — retryable flag (OSS-1326 / #1854)', () => {
  function makeRetryableTestInput(): AgentTaskInput {
    return {
      version: AGENT_PROTOCOL_VERSION,
      source: { kind: 'repository', scope: { type: 'staged' } },
      options: AgentOptionsSchema.parse({
        conventional: true,
        trustRepositoryConfig: false,
      }),
    }
  }

  beforeEach(() => {
    jest.clearAllMocks()

    mockResolveChangeSource.mockResolvedValue({
      text: 'some diff context',
      warnings: [],
      meta: {
        kind: 'repository',
        digest: 'abc123',
        verification: 'repository-derived',
      },
    })
  })

  it('throws AgentOperationError with retryable:true when validation errors are present', async () => {
    mockGenerateCommitDraft.mockResolvedValue({
      ok: false,
      draft: 'chore: Update deps\n\nsome body',
      message: { title: 'chore: Update deps', body: 'some body', formatted: 'chore: Update deps\n\nsome body' },
      warnings: [],
      validationErrors: ["body's lines must not be longer than 100 characters"],
    })

    let caughtErr: unknown
    try {
      await generateAgentCommitDraft(makeRetryableTestInput(), makeContext())
    } catch (err) {
      caughtErr = err
    }
    expect(caughtErr).toBeInstanceOf(AgentOperationError)
    const agentErr = caughtErr as AgentOperationError
    expect(agentErr.code).toBe('GENERATION_FAILED')
    expect(agentErr.retryable).toBe(true)
  })

  it('throws AgentOperationError with retryable:false when failure has no validation errors', async () => {
    mockGenerateCommitDraft.mockResolvedValue({
      ok: false,
      draft: '',
      warnings: ['No staged changes detected.'],
      validationErrors: [],
    })

    let caughtErr: unknown
    try {
      await generateAgentCommitDraft(makeRetryableTestInput(), makeContext())
    } catch (err) {
      caughtErr = err
    }
    expect(caughtErr).toBeInstanceOf(AgentOperationError)
    const agentErr = caughtErr as AgentOperationError
    expect(agentErr.code).toBe('GENERATION_FAILED')
    expect(agentErr.retryable).toBe(false)
  })

  it('returns a success envelope when generation succeeds', async () => {
    mockGenerateCommitDraft.mockResolvedValue({
      ok: true,
      draft: 'fix: handle edge case\n\nDetails here.',
      message: {
        title: 'fix: handle edge case',
        body: 'Details here.',
        formatted: 'fix: handle edge case\n\nDetails here.',
      },
      warnings: [],
      validationErrors: [],
    })

    const result = await generateAgentCommitDraft(makeRetryableTestInput(), makeContext())
    expect(result.ok).toBe(true)
    expect(result.operation).toBe('commit-draft')
    expect(result.data.title).toBe('fix: handle edge case')
  })
})

// dryRun planning (OSS-1206): review/changelog/recap accept `options.dryRun`
// and must return a `status: 'planned'` envelope without ever invoking the
// model (executeChain/executeChainStreaming/getLlm).
describe('agent generate dryRun planning (OSS-1206)', () => {
  const dryRunInput: AgentTaskInput = {
    ...baseInput,
    options: AgentOptionsSchema.parse({ dryRun: true }),
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockResolveChangeSource.mockResolvedValue({
      text: 'diff content',
      warnings: [],
      meta: { kind: 'summary', digest: 'sha256:test', verification: 'provided-unverified' },
    })
    mockLoadConfig.mockReturnValue({
      service: {
        tokenLimit: 100000,
        authentication: { type: 'None' },
        streaming: { enabled: true },
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
  })

  it('returns a planned envelope and never calls getLlm/executeChain/executeChainStreaming', async () => {
    const context = makeContext(undefined)

    const reviewResult = await generateAgentReview(dryRunInput, context)
    const changelogResult = await generateAgentChangelog(dryRunInput, context)
    const recapResult = await generateAgentRecap(dryRunInput, context)

    expect(reviewResult.status).toBe('planned')
    expect(changelogResult.status).toBe('planned')
    expect(recapResult.status).toBe('planned')
    expect(mockGetLlm).not.toHaveBeenCalled()
    expect(mockExecuteChain).not.toHaveBeenCalled()
    expect(mockExecuteChainStreaming).not.toHaveBeenCalled()
  })

  it('reports the resolved provider/model/task and an unsaturated budget as willTruncate: false', async () => {
    const context = makeContext(undefined)

    const result = await generateAgentReview(dryRunInput, context)

    if (result.status !== 'planned') throw new Error('expected a planned envelope')
    expect(result.plan.provider).toBe('test-provider')
    expect(result.plan.model).toBe('test-model')
    expect(result.plan.task).toBe('review')
    expect(result.plan.promptTokens).toBeGreaterThan(0)
    expect(result.plan.budgetTokens).toBe(100000)
    expect(result.plan.willTruncate).toBe(false)
    expect(result.plan.estimatedAnalyzedRatio).toBe(1)
    expect(result.plan.authenticationReady).toBe(true)
  })

  it('reports the exact promptTokens a real run of the same request would send', async () => {
    // Both the dryRun and real paths share prepareStructuredCall, so the
    // rendered-prompt token count for identical request variables must be
    // byte-for-byte identical between a plan and a real run.
    mockExecuteChain.mockResolvedValueOnce([{
      title: 'finding',
      summary: 'summary',
      severity: 5,
      category: 'bug',
      filePath: 'a.ts',
    }] as never)

    const planned = await generateAgentReview(dryRunInput, makeContext(undefined))
    const real = await generateAgentReview(
      { ...baseInput, options: AgentOptionsSchema.parse({}) },
      makeContext(undefined),
    )

    if (planned.status !== 'planned') throw new Error('expected a planned envelope')
    if (real.status !== 'completed') throw new Error('expected a completed envelope')
    expect(mockExecuteChain).toHaveBeenCalledTimes(1)
    // Both the real call and the plan go through getPrompt's real
    // PromptTemplate (only executeChain/executeChainStreaming/getLlm are
    // mocked in this suite) -- format() reproduces exactly what
    // enforcePromptBudget's tokenizer counted for the real run.
    const sentPrompt = mockExecuteChain.mock.calls[0][0].prompt
    const sentVariables = mockExecuteChain.mock.calls[0][0].variables as Record<string, string>
    const rendered = await sentPrompt.format(sentVariables)
    expect(planned.plan.promptTokens).toBe(rendered.length)
  })

  it('sets willTruncate: true and estimatedAnalyzedRatio < 1 when the rendered prompt exceeds the budget', async () => {
    mockLoadConfig.mockReturnValue({
      service: {
        // Between this request's overhead (~1169 chars) and full rendered
        // size (~1340 chars) so truncation engages without exceeding budget
        // even with an empty summary (which would throw instead).
        tokenLimit: 1800,
        authentication: { type: 'None' },
        streaming: { enabled: true },
        provider: 'test-provider',
      },
      prompt: undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    const context = makeContext(undefined)

    const result = await generateAgentReview(dryRunInput, context)

    if (result.status !== 'planned') throw new Error('expected a planned envelope')
    expect(result.plan.willTruncate).toBe(true)
    expect(result.plan.budgetTokens).toBe(1800)
  })

  it('reports authenticationReady: false when the configured provider has no usable key, without throwing', async () => {
    mockLoadConfig.mockReturnValue({
      service: {
        tokenLimit: 100000,
        authentication: { type: 'APIKey', credentials: {} },
        streaming: { enabled: true },
        provider: 'test-provider',
      },
      prompt: undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    mockGetApiKeyForModel.mockImplementation(() => {
      throw new Error('no api key configured')
    })
    const context = makeContext(undefined)

    const result = await generateAgentReview(dryRunInput, context)

    if (result.status !== 'planned') throw new Error('expected a planned envelope')
    expect(result.plan.authenticationReady).toBe(false)
  })

  it('rejects commit-draft dryRun with UNSUPPORTED_OPERATION instead of running a real generation', async () => {
    const context = makeContext(undefined)

    await expect(generateAgentCommitDraft(dryRunInput, context)).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
    })
    expect(mockGenerateCommitDraft).not.toHaveBeenCalled()
  })
})

// #1823 — PR drafts for agents, without any forge call.
describe('generateAgentPrDraft (#1823)', () => {
  const contextModule = jest.requireMock('./context') as {
    readPullRequestBranches: jest.Mock
    resolveChangeSource: jest.Mock
  }
  const repoInput = (options: Record<string, unknown> = {}, source: unknown = { kind: 'repository', scope: { type: 'staged' } }) => ({
    ...baseInput,
    source,
    options: AgentOptionsSchema.parse(options),
  }) as AgentTaskInput

  beforeEach(() => {
    contextModule.readPullRequestBranches.mockResolvedValue({ head: 'feat/x', defaultBase: 'main' })
  })

  it('drafts title and body from the branch against the default base', async () => {
    mockExecuteChain.mockResolvedValueOnce({ title: ' Add x ', content: ' Body text. ' } as never)
    const result = await generateAgentPrDraft(repoInput({ draft: true }), makeContext(undefined))

    if (result.status !== 'completed') throw new Error('expected a completed envelope')
    expect(result.operation).toBe('pr-draft')
    expect(result.data).toEqual({ base: 'main', head: 'feat/x', title: 'Add x', body: 'Body text.', draft: true })
    expect(contextModule.resolveChangeSource.mock.calls.at(-1)?.[0]).toEqual({
      kind: 'repository', scope: { type: 'branch', base: 'main' },
    })
  })

  it('uses options.base over the default', async () => {
    mockExecuteChain.mockResolvedValueOnce({ title: 't', content: 'c' } as never)
    const result = await generateAgentPrDraft(repoInput({ base: 'release/2.0' }), makeContext(undefined))
    if (result.status !== 'completed') throw new Error('expected a completed envelope')
    expect(result.data).toMatchObject({ base: 'release/2.0', draft: false })
  })

  it('refuses a detached HEAD and the base branch itself', async () => {
    contextModule.readPullRequestBranches.mockResolvedValueOnce({ head: undefined, defaultBase: 'main' })
    await expect(generateAgentPrDraft(repoInput(), makeContext(undefined))).rejects.toMatchObject({ code: 'INVALID_REVISION' })

    contextModule.readPullRequestBranches.mockResolvedValueOnce({ head: 'main', defaultBase: 'main' })
    await expect(generateAgentPrDraft(repoInput(), makeContext(undefined))).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('generates from a supplied summary as given, still reporting base and head', async () => {
    mockExecuteChain.mockResolvedValueOnce({ title: 't', content: 'c' } as never)
    const summary = { kind: 'summary', summary: 'Adds x.' }
    const result = await generateAgentPrDraft(repoInput({}, summary), makeContext(undefined))
    if (result.status !== 'completed') throw new Error('expected a completed envelope')
    expect(contextModule.resolveChangeSource.mock.calls.at(-1)?.[0]).toEqual(summary)
    expect(result.data).toMatchObject({ base: 'main', head: 'feat/x' })
  })
})

// #1828 — the agent counterpart of `coco review --severity`, as a filter.
describe('review severity threshold (#1828)', () => {
  const finding = (severity: number) => ({
    title: `s${severity}`, summary: 'x', severity, category: 'bug', filePath: 'a.ts',
  }) as never

  it('keeps findings at or above the threshold and says how many were left out', () => {
    expect(applySeverityThreshold([finding(9), finding(5), finding(4), finding(1)], 5)).toEqual({
      kept: [finding(9), finding(5)],
      omittedWarning: '2 findings below severity 5 were omitted.',
    })
    expect(applySeverityThreshold([finding(9), finding(2)], 5).omittedWarning).toBe('1 finding below severity 5 was omitted.')
  })

  it('returns every finding, with no warning, when there is no threshold or nothing is dropped', () => {
    expect(applySeverityThreshold([finding(1), finding(9)], undefined)).toEqual({ kept: [finding(1), finding(9)] })
    expect(applySeverityThreshold([finding(7)], 5)).toEqual({ kept: [finding(7)] })
  })

  it('filters the review envelope and adds the warning', async () => {
    mockExecuteChain.mockResolvedValueOnce([finding(3), finding(8)] as never)
    const input = { ...baseInput, options: AgentOptionsSchema.parse({ severity: 5 }) }
    const result = await generateAgentReview(input, makeContext(undefined))

    if (result.status !== 'completed') throw new Error('expected a completed envelope')
    expect(result.data.findings.map((f) => f.severity)).toEqual([8])
    expect(result.warnings).toContain('1 finding below severity 5 was omitted.')
  })

  it.each([0, 11, 2.5, Number.NaN])('rejects severity %p', (severity) => {
    expect(AgentOptionsSchema.safeParse({ severity }).success).toBe(false)
  })
})

// #1824 — agent-safe split planning.
describe('generateAgentSplitPlan (#1824)', () => {
  const contextModule = jest.requireMock('./context') as {
    resolveChangeSource: jest.Mock
    readStagedFileChanges: jest.Mock
    readStagedFileDiff: jest.Mock
    readPullRequestBranches: jest.Mock
  }
  const planner = jest.requireMock('../../commands/commit/splitPlanGenerator').generateValidatedCommitSplitPlan as jest.Mock
  const stagedInput = (options: Record<string, unknown> = {}, source: unknown = { kind: 'repository', scope: { type: 'staged' } }) => ({
    ...baseInput, source, options: AgentOptionsSchema.parse(options),
  }) as AgentTaskInput

  beforeEach(() => {
    planner.mockReset()
    contextModule.resolveChangeSource.mockResolvedValue({
      text: 'diff --git a/a.ts b/a.ts', warnings: [],
      meta: { kind: 'repository', digest: 'sha256:d', verification: 'repository-derived' },
    })
    contextModule.readStagedFileChanges.mockResolvedValue([
      { filePath: 'a.ts', status: 'added', summary: '' },
      { filePath: 'b.ts', status: 'added', summary: '' },
    ])
    contextModule.readStagedFileDiff.mockResolvedValue('')
    planner.mockResolvedValue({
      plan: { groups: [
        { title: 'feat: add a', files: ['a.ts'] },
        { title: 'chore: misc', body: 'left over', files: ['b.ts'], unclaimed: true },
      ] },
      attempts: 1,
    })
  })

  it('returns the plan groups', async () => {
    const result = await generateAgentSplitPlan(stagedInput(), makeContext(undefined))
    expect(result.operation).toBe('split-plan')
    expect(result.data.groups).toEqual([
      { title: 'feat: add a', body: '', files: ['a.ts'], hunks: [], unclaimed: false },
      { title: 'chore: misc', body: 'left over', files: ['b.ts'], hunks: [], unclaimed: true },
    ])
    expect(result.meta.digest).toBe('sha256:d')
  })

  it('validates group titles against the built-in rules only when conventional is set', async () => {
    await generateAgentSplitPlan(stagedInput(), makeContext(undefined))
    expect(planner.mock.calls[0][0].validateGroupMessage).toBeUndefined()

    await generateAgentSplitPlan(stagedInput({ conventional: true }), makeContext(undefined))
    expect(typeof planner.mock.calls[1][0].validateGroupMessage).toBe('function')
    expect(planner.mock.calls[1][0].variables.commitlint_rules_context).toContain('Header')
  })

  it('uses the built-in split prompt and frames the diff as untrusted', async () => {
    await generateAgentSplitPlan(stagedInput(), makeContext(undefined))
    const { variables } = planner.mock.calls[0][0]
    expect(variables.summary).not.toBe('diff --git a/a.ts b/a.ts')
    expect(variables.summary).toContain('diff --git a/a.ts b/a.ts')
    expect(variables.file_inventory).toBe('- a.ts: added\n- b.ts: added')
  })

  it('reports a fallback plan as a warning and in data', async () => {
    planner.mockResolvedValueOnce({
      plan: { groups: [{ title: 'chore: changes', files: ['a.ts', 'b.ts'] }] },
      attempts: 3,
      fallback: { reason: 'validation kept failing', lastIssues: {} },
    })
    const result = await generateAgentSplitPlan(stagedInput(), makeContext(undefined))
    expect(result.data.fallback).toBe('validation kept failing')
    expect(result.warnings.some((w) => w.includes('validation kept failing'))).toBe(true)
  })

  it('refuses non-staged sources, dryRun, and an empty index', async () => {
    await expect(generateAgentSplitPlan(stagedInput({}, { kind: 'summary', summary: 'x' }), makeContext(undefined)))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_SOURCE' })
    await expect(generateAgentSplitPlan(stagedInput({ dryRun: true }), makeContext(undefined)))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })
    contextModule.readStagedFileChanges.mockResolvedValueOnce([])
    await expect(generateAgentSplitPlan(stagedInput(), makeContext(undefined)))
      .rejects.toMatchObject({ code: 'NO_CHANGES' })
  })
})

// #2045 — several operations over one resolution of the source.
describe('runAgentBatch (#2045)', () => {
  const contextModule = jest.requireMock('./context') as { resolveChangeSource: jest.Mock }
  const resolved = {
    text: 'diff --git a/x b/x',
    warnings: [],
    meta: { kind: 'repository', digest: 'sha256:shared', verification: 'repository-derived' },
  }
  const batchInput = (operations: string[]) => ({
    ...baseInput,
    source: { kind: 'repository', scope: { type: 'staged' } },
    operations,
  }) as never

  beforeEach(() => {
    contextModule.resolveChangeSource.mockReset()
    contextModule.resolveChangeSource.mockResolvedValue(resolved)
  })

  it('resolves the source once and returns an envelope per operation with the shared digest', async () => {
    mockExecuteChain
      .mockResolvedValueOnce({ title: 'Recap', summary: 's' } as never)
      .mockResolvedValueOnce({ title: 'Changes', content: 'c' } as never)
    const result = await runAgentBatch(batchInput(['recap', 'changelog']), makeContext(undefined))

    expect(contextModule.resolveChangeSource).toHaveBeenCalledTimes(1)
    expect(result.operation).toBe('batch')
    expect(result.data.results.map((r) => [r.operation, r.ok])).toEqual([['recap', true], ['changelog', true]])
    expect(result.data.results.map((r) => (r as { meta?: { digest: string } }).meta?.digest)).toEqual(['sha256:shared', 'sha256:shared'])
    expect(result.meta.digest).toBe('sha256:shared')
  })

  it('keeps going when one operation fails, returning its failure envelope', async () => {
    mockExecuteChain
      .mockRejectedValueOnce(new Error('model broke'))
      .mockResolvedValueOnce({ title: 'Changes', content: 'c' } as never)
    const result = await runAgentBatch(batchInput(['recap', 'changelog']), makeContext(undefined))

    expect(result.data.results[0]).toMatchObject({ ok: false, operation: 'recap', error: { code: 'OPERATION_FAILED' } })
    expect(result.data.results[1]).toMatchObject({ ok: true, operation: 'changelog' })
  })

  it('stops the whole batch on cancellation', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' })
    mockExecuteChain.mockRejectedValueOnce(abort)
    await expect(runAgentBatch(batchInput(['recap', 'changelog']), makeContext(undefined))).rejects.toMatchObject({ code: 'CANCELLED' })
  })
})

describe('batch request schema (#2045)', () => {
  const { AgentBatchRequestSchema } = jest.requireActual('./schemas') as typeof import('./schemas')

  it('accepts a set of generation operations', () => {
    expect(AgentBatchRequestSchema.safeParse({ source: 'staged', operations: ['review', 'commit-draft'] }).success).toBe(true)
  })

  it.each([
    [[]],
    [['review', 'review']],
    [['review', 'lint']],
    [['pr-draft']],
  ])('rejects operations %j', (operations) => {
    expect(AgentBatchRequestSchema.safeParse({ operations }).success).toBe(false)
  })
})

