import { getApiKeyForModel } from '../../lib/langchain/utils'
import { loadConfig } from '../../lib/config/utils/loadConfig'
import { buildModelRoutingProfile } from '../../lib/langchain/utils/modelRoutingProfile'
import { runCapabilities } from './generate'

jest.mock('../../lib/config/utils/loadConfig')
jest.mock('../../lib/langchain/utils')

const mockLoadConfig = loadConfig as jest.MockedFunction<typeof loadConfig>
const mockGetApiKeyForModel = getApiKeyForModel as jest.MockedFunction<typeof getApiKeyForModel>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeConfig(serviceOverrides: Record<string, unknown> = {}): any {
  return {
    service: {
      provider: 'openai',
      model: 'gpt-4o',
      tokenLimit: 8192,
      authentication: { type: 'APIKey', credentials: { apiKey: 'sk-test' } },
      streaming: { enabled: true },
      ...serviceOverrides,
    },
  }
}

describe('runCapabilities (OSS-1206)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('succeeds with no repository and reports authenticationReady: false when no usable key is configured', async () => {
    mockLoadConfig.mockReturnValue(makeConfig())
    mockGetApiKeyForModel.mockImplementation(() => {
      throw new Error('API key is required for openai provider but not provided')
    })

    const result = await runCapabilities()

    expect(result.providers.authenticationReady).toBe(false)
    expect(result.providers.configured).toBe('openai')
    // No repository was supplied -- capabilities must not require one, and
    // repository-only fields must be omitted rather than guessed at.
    expect(result.features).not.toHaveProperty('hasCommitlintConfig')
  })

  it('reports authenticationReady: true when a usable key is present', async () => {
    mockLoadConfig.mockReturnValue(makeConfig())
    mockGetApiKeyForModel.mockReturnValue('sk-test')

    const result = await runCapabilities()

    expect(result.providers.authenticationReady).toBe(true)
  })

  it('reports authenticationReady: true for a "None" auth provider without calling getApiKeyForModel', async () => {
    mockLoadConfig.mockReturnValue(makeConfig({ authentication: { type: 'None' } }))

    const result = await runCapabilities()

    expect(result.providers.authenticationReady).toBe(true)
    expect(mockGetApiKeyForModel).not.toHaveBeenCalled()
  })

  it('produces routing identical to buildModelRoutingProfile for the same config -- matches `coco doctor --cost`', async () => {
    const config = makeConfig()
    mockLoadConfig.mockReturnValue(config)
    mockGetApiKeyForModel.mockReturnValue('sk-test')

    const result = await runCapabilities()

    expect(result.routing).toEqual(buildModelRoutingProfile(config))
  })

  it('reports limits and the curated generation operations list, no pricing anywhere', async () => {
    mockLoadConfig.mockReturnValue(makeConfig())
    mockGetApiKeyForModel.mockReturnValue('sk-test')

    const result = await runCapabilities()

    expect(result.limits).toEqual({ maxContextBytes: 2 * 1024 * 1024, defaultTokenLimit: 8192 })
    expect(result.operations).toEqual(['commit-draft', 'review', 'changelog', 'recap'])
    expect(result.features.streaming).toBe(true)

    // AC: "No pricing or currency figures anywhere in the response."
    const serialized = JSON.stringify(result).toLowerCase()
    expect(serialized).not.toMatch(/price|cost|usd|currency|\$\d/)
  })

  it('reports hasCommitlintConfig only when a repository root is supplied', async () => {
    mockLoadConfig.mockReturnValue(makeConfig())
    mockGetApiKeyForModel.mockReturnValue('sk-test')

    const withoutRepo = await runCapabilities()
    expect(withoutRepo.features).not.toHaveProperty('hasCommitlintConfig')

    const withRepo = await runCapabilities(process.cwd())
    expect(withRepo.features).toHaveProperty('hasCommitlintConfig')
    expect(typeof withRepo.features.hasCommitlintConfig).toBe('boolean')
  })

  it('defaults defaultTokenLimit to 4096 when the config has no tokenLimit', async () => {
    mockLoadConfig.mockReturnValue(makeConfig({ tokenLimit: undefined }))
    mockGetApiKeyForModel.mockReturnValue('sk-test')

    const result = await runCapabilities()

    expect(result.limits.defaultTokenLimit).toBe(4096)
  })
})
