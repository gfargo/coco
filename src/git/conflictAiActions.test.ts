import {
  conflictAiTestInternals,
  runConflictExplanationWorkflow,
  runConflictResolutionWorkflow,
} from './conflictAiActions'
import type { ConflictRegion } from './conflictRegionActions'
import { Config } from '../commands/types'
import { LangChainCancelledError } from '../lib/langchain/errors'
import { loadConfig } from '../lib/config/utils/loadConfig'
import { getApiKeyForModel, getModelAndProviderFromConfig } from '../lib/langchain/utils'
import { resolveDynamicService } from '../lib/langchain/utils/dynamicModels'
import { executeChain } from '../lib/langchain/utils/executeChain'
import { getLlm } from '../lib/langchain/utils/getLlm'

jest.mock('../lib/config/utils/loadConfig')
jest.mock('../lib/langchain/utils')
jest.mock('../lib/langchain/utils/dynamicModels')
jest.mock('../lib/langchain/utils/getLlm')
jest.mock('../lib/langchain/utils/executeChain')
jest.mock('../lib/langchain/utils/createSchemaParser', () => ({
  createSchemaParser: jest.fn().mockReturnValue({
    getFormatInstructions: () => 'format instructions',
  }),
}))

const mockLoadConfig = loadConfig as jest.MockedFunction<typeof loadConfig>
const mockGetApiKeyForModel = getApiKeyForModel as jest.MockedFunction<typeof getApiKeyForModel>
const mockGetModelAndProviderFromConfig = getModelAndProviderFromConfig as jest.MockedFunction<
  typeof getModelAndProviderFromConfig
>
const mockResolveDynamicService = resolveDynamicService as jest.MockedFunction<
  typeof resolveDynamicService
>
const mockGetLlm = getLlm as jest.MockedFunction<typeof getLlm>
const mockExecuteChain = executeChain as jest.MockedFunction<typeof executeChain>

function buildRegion(overrides: Partial<ConflictRegion> = {}): ConflictRegion {
  return {
    index: 0,
    startLine: 1,
    endLine: 5,
    oursLabel: 'HEAD',
    theirsLabel: 'feature',
    ours: ['ours line'],
    theirs: ['theirs line'],
    ...overrides,
  }
}

describe('runConflictResolutionWorkflow (OSS-2262)', () => {
  beforeEach(() => {
    jest.clearAllMocks()

    mockLoadConfig.mockReturnValue({
      service: {
        authentication: { type: 'APIKey', credentials: { apiKey: 'mock-api-key' } },
        provider: 'openai',
        model: 'gpt-4o',
        tokenLimit: 4096,
      },
    } as unknown as Config)
    mockGetApiKeyForModel.mockReturnValue('mock-api-key')
    mockGetModelAndProviderFromConfig.mockReturnValue({ provider: 'openai', model: 'gpt-4o' })
    mockResolveDynamicService.mockReturnValue({
      model: 'gpt-4o',
    } as unknown as ReturnType<typeof resolveDynamicService>)
    mockGetLlm.mockResolvedValue({} as Awaited<ReturnType<typeof getLlm>>)
  })

  it('resolves the model via the dedicated conflictResolve dynamic-model task', async () => {
    mockExecuteChain.mockResolvedValue({
      proposals: [
        { region: 0, resolution: 'merged result', rationale: 'trivial merge', confidence: 'high' },
      ],
    })

    await runConflictResolutionWorkflow({
      path: 'src/index.ts',
      regions: [buildRegion()],
      operation: 'merge',
    })

    expect(mockResolveDynamicService).toHaveBeenCalledWith(expect.anything(), 'conflictResolve')
  })

  it('parses and passes a proposal confidence through to the returned result', async () => {
    mockExecuteChain.mockResolvedValue({
      proposals: [
        {
          region: 0,
          resolution: 'merged result',
          rationale: 'ambiguous intent',
          confidence: 'low',
        },
      ],
    })

    const result = await runConflictResolutionWorkflow({
      path: 'src/index.ts',
      regions: [buildRegion()],
      operation: 'merge',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.proposals).toHaveLength(1)
      expect(result.proposals[0].confidence).toBe('low')
    }
  })
})

describe('chunkRegions / estimateRegionTokens (OSS-2269)', () => {
  const { chunkRegions, estimateRegionTokens } = conflictAiTestInternals

  function wordsRegion(index: number, wordCount: number): ConflictRegion {
    const words = Array.from({ length: wordCount }, () => 'w').join(' ')
    return buildRegion({ index, ours: [words], theirs: [words] })
  }

  it('estimates tokens as ~1.3x the combined word count of ours/base/theirs', () => {
    const region = buildRegion({ ours: ['a a a'], theirs: ['b b'], base: ['c'] })
    // 3 + 2 + 1 = 6 words * 1.3 = 7.8, rounded up
    expect(estimateRegionTokens(region)).toBe(8)
  })

  it('passes everything through as a single batch when no tokenBudget is given', () => {
    const regions = [wordsRegion(0, 10), wordsRegion(1, 10)]
    const { batches, oversized } = chunkRegions(regions)
    expect(oversized).toHaveLength(0)
    expect(batches).toHaveLength(1)
    expect(batches[0].regions).toEqual(regions)
    expect(batches[0]).toMatchObject({ first: 0, last: 1, total: 2 })
  })

  it('greedily splits regions into multiple batches once the budget is exceeded', () => {
    // Each region is ~26 tokens (10 words on each of ours/theirs * 1.3,
    // rounded up); a budget of 30 fits one region per batch but not two.
    const regions = [wordsRegion(0, 10), wordsRegion(1, 10), wordsRegion(2, 10)]
    const { batches, oversized } = chunkRegions(regions, 30)
    expect(oversized).toHaveLength(0)
    expect(batches).toHaveLength(3)
    expect(batches.map((batch) => batch.regions[0].index)).toEqual([0, 1, 2])
    expect(batches.every((batch) => batch.total === 3)).toBe(true)
  })

  it('reports a region that alone exceeds the budget as oversized instead of batching it', () => {
    const regions = [wordsRegion(0, 100)]
    const { batches, oversized } = chunkRegions(regions, 50)
    expect(batches).toHaveLength(0)
    expect(oversized).toEqual(regions)
  })
})

describe('runConflictResolutionWorkflow chunking (OSS-2269)', () => {
  beforeEach(() => {
    jest.clearAllMocks()

    mockLoadConfig.mockReturnValue({
      service: {
        authentication: { type: 'APIKey', credentials: { apiKey: 'mock-api-key' } },
        provider: 'openai',
        model: 'gpt-4o',
        tokenLimit: 4096,
      },
    } as unknown as Config)
    mockGetApiKeyForModel.mockReturnValue('mock-api-key')
    mockGetModelAndProviderFromConfig.mockReturnValue({ provider: 'openai', model: 'gpt-4o' })
    mockResolveDynamicService.mockReturnValue({
      model: 'gpt-4o',
    } as unknown as ReturnType<typeof resolveDynamicService>)
    mockGetLlm.mockResolvedValue({} as Awaited<ReturnType<typeof getLlm>>)
  })

  function wordsRegion(index: number, wordCount: number): ConflictRegion {
    const words = Array.from({ length: wordCount }, () => 'w').join(' ')
    return buildRegion({ index, ours: [words], theirs: [words] })
  }

  it('sub-budget input makes exactly one chain call (single-batch passthrough)', async () => {
    mockExecuteChain.mockResolvedValue({
      proposals: [
        { region: 0, resolution: 'a', rationale: 'trivial', confidence: 'high' },
        { region: 1, resolution: 'b', rationale: 'trivial', confidence: 'high' },
      ],
    })

    const result = await runConflictResolutionWorkflow({
      path: 'src/index.ts',
      regions: [wordsRegion(0, 10), wordsRegion(1, 10)],
      operation: 'merge',
      tokenBudget: 200,
    })

    expect(mockExecuteChain).toHaveBeenCalledTimes(1)
    expect(mockExecuteChain.mock.calls[0][0].variables.batch_note).toBe('')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.proposals.map((p) => p.regionIndex)).toEqual([0, 1])
    }
  })

  it('reassembles proposals from multiple batches in region-index order', async () => {
    mockExecuteChain
      .mockResolvedValueOnce({
        proposals: [{ region: 0, resolution: 'a', rationale: 'r0', confidence: 'high' }],
      })
      .mockResolvedValueOnce({
        proposals: [{ region: 1, resolution: 'b', rationale: 'r1', confidence: 'medium' }],
      })
      .mockResolvedValueOnce({
        proposals: [{ region: 2, resolution: 'c', rationale: 'r2', confidence: 'low' }],
      })

    const result = await runConflictResolutionWorkflow({
      path: 'src/index.ts',
      regions: [wordsRegion(0, 10), wordsRegion(1, 10), wordsRegion(2, 10)],
      operation: 'merge',
      tokenBudget: 30,
    })

    expect(mockExecuteChain).toHaveBeenCalledTimes(3)
    expect(mockExecuteChain.mock.calls[0][0].variables.batch_note).toContain('Regions 0-0 of 3')
    expect(mockExecuteChain.mock.calls[1][0].variables.batch_note).toContain('Regions 1-1 of 3')
    expect(mockExecuteChain.mock.calls[2][0].variables.batch_note).toContain('Regions 2-2 of 3')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.proposals.map((p) => p.regionIndex)).toEqual([0, 1, 2])
      expect(result.proposals.map((p) => p.resolution)).toEqual(['a', 'b', 'c'])
    }
  })

  it('yields a synthetic low-confidence proposal for a single oversized region without calling the model', async () => {
    const result = await runConflictResolutionWorkflow({
      path: 'src/index.ts',
      regions: [wordsRegion(0, 100)],
      operation: 'merge',
      tokenBudget: 50,
    })

    expect(mockExecuteChain).not.toHaveBeenCalled()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.proposals).toEqual([
        {
          regionIndex: 0,
          resolution: '',
          rationale: 'Region too large for model context',
          confidence: 'low',
        },
      ])
    }
  })
})

describe('runConflictExplanationWorkflow (OSS-2268)', () => {
  beforeEach(() => {
    jest.clearAllMocks()

    mockLoadConfig.mockReturnValue({
      service: {
        authentication: { type: 'APIKey', credentials: { apiKey: 'mock-api-key' } },
        provider: 'openai',
        model: 'gpt-4o',
        tokenLimit: 4096,
      },
    } as unknown as Config)
    mockGetApiKeyForModel.mockReturnValue('mock-api-key')
    mockGetModelAndProviderFromConfig.mockReturnValue({ provider: 'openai', model: 'gpt-4o' })
    mockResolveDynamicService.mockReturnValue({
      model: 'gpt-4o',
    } as unknown as ReturnType<typeof resolveDynamicService>)
    mockGetLlm.mockResolvedValue({} as Awaited<ReturnType<typeof getLlm>>)
  })

  it('returns a failure without calling the model when there are no regions', async () => {
    const result = await runConflictExplanationWorkflow({
      path: 'src/index.ts',
      regions: [],
      operation: 'merge',
    })

    expect(mockExecuteChain).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
  })

  it('resolves the model via the dedicated conflictResolve dynamic-model task', async () => {
    mockExecuteChain.mockResolvedValue({
      explanations: [
        {
          region: 0,
          oursIntent: 'renamed the helper',
          theirsIntent: 'added a parameter',
          conflictNature: 'both sides changed the signature',
        },
      ],
    })

    await runConflictExplanationWorkflow({
      path: 'src/index.ts',
      regions: [buildRegion()],
      operation: 'merge',
    })

    expect(mockResolveDynamicService).toHaveBeenCalledWith(expect.anything(), 'conflictResolve')
  })

  it('parses and passes explanation fields through to the returned result', async () => {
    mockExecuteChain.mockResolvedValue({
      explanations: [
        {
          region: 0,
          oursIntent: 'renamed the helper',
          theirsIntent: 'added a parameter',
          conflictNature: 'both sides changed the signature',
        },
      ],
    })

    const result = await runConflictExplanationWorkflow({
      path: 'src/index.ts',
      regions: [buildRegion()],
      operation: 'merge',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.explanations).toEqual([
        {
          regionIndex: 0,
          oursIntent: 'renamed the helper',
          theirsIntent: 'added a parameter',
          conflictNature: 'both sides changed the signature',
        },
      ])
    }
  })

  it('surfaces cancellation from executeChain as a cancelled result', async () => {
    mockExecuteChain.mockRejectedValue(new LangChainCancelledError('cancelled'))

    const result = await runConflictExplanationWorkflow({
      path: 'src/index.ts',
      regions: [buildRegion()],
      operation: 'merge',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.cancelled).toBe(true)
    }
  })
})
