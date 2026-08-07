import { runConflictResolutionWorkflow } from './conflictAiActions'
import type { ConflictRegion } from './conflictRegionActions'
import { Config } from '../commands/types'
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
