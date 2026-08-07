import { loadConfig } from '../lib/config/utils/loadConfig'
import { getApiKeyForModel, getModelAndProviderFromConfig } from '../lib/langchain/utils'
import { LangChainCancelledError } from '../lib/langchain/errors'
import { resolveDynamicService } from '../lib/langchain/utils/dynamicModels'
import { executeChain } from '../lib/langchain/utils/executeChain'
import { getLlm } from '../lib/langchain/utils/getLlm'
import { Config } from '../commands/types'
import { runConflictResolutionWorkflow } from './conflictAiActions'
import type { ConflictRegion } from './conflictRegionActions'

jest.mock('../lib/config/utils/loadConfig')
jest.mock('../lib/langchain/utils')
jest.mock('../lib/langchain/utils/dynamicModels')
jest.mock('../lib/langchain/utils/getLlm')
jest.mock('../lib/langchain/utils/executeChain')

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

function buildConfig(overrides: Record<string, unknown> = {}): Config {
  return {
    service: {
      authentication: { type: 'None' },
      provider: 'openai',
      model: 'gpt-4o',
      tokenLimit: 4096,
    },
    hideCocoBanner: false,
    ...overrides,
  } as unknown as Config
}

function buildRegion(overrides: Partial<ConflictRegion> = {}): ConflictRegion {
  return {
    index: 0,
    startLine: 1,
    endLine: 5,
    oursLabel: 'HEAD',
    theirsLabel: 'feature/x',
    ours: ['ours line'],
    theirs: ['theirs line'],
    ...overrides,
  }
}

describe('runConflictResolutionWorkflow', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockLoadConfig.mockReturnValue(buildConfig())
    mockGetApiKeyForModel.mockReturnValue('test-key')
    mockGetModelAndProviderFromConfig.mockReturnValue({ provider: 'openai', model: 'gpt-4o' })
    mockResolveDynamicService.mockImplementation(
      (config) => ({ ...(config.service as Record<string, unknown>) }) as ReturnType<typeof resolveDynamicService>
    )
    mockGetLlm.mockResolvedValue({} as Awaited<ReturnType<typeof getLlm>>)
  })

  it('resolves the model via the conflictResolve dynamic-model task', async () => {
    mockExecuteChain.mockResolvedValue({
      proposals: [
        { region: 0, resolution: 'merged', rationale: 'trivially compatible', confidence: 'high' },
      ],
    })

    await runConflictResolutionWorkflow({
      path: 'src/index.ts',
      regions: [buildRegion()],
      operation: 'merge',
    })

    expect(mockResolveDynamicService).toHaveBeenCalledWith(expect.anything(), 'conflictResolve')
  })

  it('returns one proposal per region with confidence, first wins on duplicates', async () => {
    mockExecuteChain.mockResolvedValue({
      proposals: [
        { region: 0, resolution: 'first', rationale: 'r1', confidence: 'high' },
        { region: 0, resolution: 'duplicate', rationale: 'r1b', confidence: 'low' },
        { region: 1, resolution: 'second', rationale: 'r2', confidence: 'medium' },
      ],
    })

    const result = await runConflictResolutionWorkflow({
      path: 'src/index.ts',
      regions: [buildRegion({ index: 0 }), buildRegion({ index: 1 })],
      operation: 'merge',
    })

    expect(result).toEqual({
      ok: true,
      proposals: [
        { regionIndex: 0, resolution: 'first', rationale: 'r1', confidence: 'high' },
        { regionIndex: 1, resolution: 'second', rationale: 'r2', confidence: 'medium' },
      ],
      message: '2 of 2 regions have proposals',
    })
  })

  it('drops proposals that target a region that does not exist', async () => {
    mockExecuteChain.mockResolvedValue({
      proposals: [{ region: 9, resolution: 'orphan', rationale: 'r', confidence: 'low' }],
    })

    const result = await runConflictResolutionWorkflow({
      path: 'src/index.ts',
      regions: [buildRegion({ index: 0 })],
      operation: 'merge',
    })

    expect(result).toEqual({ ok: false, message: 'The model returned no usable proposals — try again.' })
  })

  it('returns a neutral cancelled result on abort, not an error', async () => {
    mockExecuteChain.mockRejectedValue(new LangChainCancelledError('aborted'))

    const result = await runConflictResolutionWorkflow({
      path: 'src/index.ts',
      regions: [buildRegion()],
      operation: 'merge',
    })

    expect(result).toEqual({ ok: false, cancelled: true, message: 'Conflict resolution cancelled.' })
  })

  it('surfaces LLM errors as a structured failure message', async () => {
    mockExecuteChain.mockRejectedValue(new Error('rate limited\nretry in 30s\nextra detail'))

    const result = await runConflictResolutionWorkflow({
      path: 'src/index.ts',
      regions: [buildRegion()],
      operation: 'merge',
    })

    expect(result).toEqual({
      ok: false,
      message: 'rate limited',
      details: ['retry in 30s', 'extra detail'],
    })
  })

  it('short-circuits with no API key configured', async () => {
    mockLoadConfig.mockReturnValue(
      buildConfig({ service: { authentication: { type: 'APIKey' }, provider: 'openai', model: 'gpt-4o' } })
    )
    mockGetApiKeyForModel.mockReturnValue('')

    const result = await runConflictResolutionWorkflow({
      path: 'src/index.ts',
      regions: [buildRegion()],
      operation: 'merge',
    })

    expect(result).toEqual({
      ok: false,
      message: 'No API key configured. Set one via env or .coco.config.json first.',
    })
    expect(mockExecuteChain).not.toHaveBeenCalled()
  })

  it('returns early with no regions to resolve', async () => {
    const result = await runConflictResolutionWorkflow({
      path: 'src/index.ts',
      regions: [],
      operation: 'merge',
    })

    expect(result).toEqual({ ok: false, message: 'No conflict regions to resolve.' })
    expect(mockExecuteChain).not.toHaveBeenCalled()
  })
})
