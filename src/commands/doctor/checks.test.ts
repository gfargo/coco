import { Config } from '../../lib/config/types'
import { getOllamaStatus } from '../../lib/langchain/utils/ollamaStatus'
import { checkOllamaLiveness } from './checks'

jest.mock('../../lib/langchain/utils/ollamaStatus', () => ({
  DEFAULT_OLLAMA_ENDPOINT: 'http://localhost:11434',
  getOllamaStatus: jest.fn(),
}))

const mockGetOllamaStatus = getOllamaStatus as jest.MockedFunction<typeof getOllamaStatus>

function ollamaConfig(overrides: Record<string, unknown> = {}): Config {
  return {
    service: {
      provider: 'ollama',
      model: 'llama3.1:8b',
      authentication: { type: 'None' },
      ...overrides,
    },
  } as unknown as Config
}

describe('checkOllamaLiveness', () => {
  afterEach(() => jest.clearAllMocks())

  it('is a no-op for non-Ollama providers (no network call)', async () => {
    const config = { service: { provider: 'openai', model: 'gpt-4o' } } as unknown as Config

    const diagnostics = await checkOllamaLiveness(config)

    expect(diagnostics).toEqual([])
    expect(mockGetOllamaStatus).not.toHaveBeenCalled()
  })

  it('errors with a serve hint when installed but the daemon is unreachable', async () => {
    mockGetOllamaStatus.mockResolvedValue({ reachable: false, installed: true, models: [] })

    const [diagnostic] = await checkOllamaLiveness(ollamaConfig())

    expect(diagnostic.severity).toBe('error')
    expect(diagnostic.message).toContain('not reachable')
    expect(diagnostic.fix).toContain('ollama serve')
  })

  it('errors with an install hint when Ollama is not installed', async () => {
    mockGetOllamaStatus.mockResolvedValue({ reachable: false, installed: false, models: [] })

    const [diagnostic] = await checkOllamaLiveness(ollamaConfig())

    expect(diagnostic.severity).toBe('error')
    expect(diagnostic.fix).toContain('ollama.com/download')
  })

  it('passes silently when the configured model is pulled', async () => {
    mockGetOllamaStatus.mockResolvedValue({
      reachable: true,
      installed: true,
      models: ['llama3.1:8b', 'qwen2.5-coder:7b'],
    })

    const diagnostics = await checkOllamaLiveness(ollamaConfig())

    expect(diagnostics).toEqual([])
  })

  it('tolerates the implicit :latest tag', async () => {
    mockGetOllamaStatus.mockResolvedValue({
      reachable: true,
      installed: true,
      models: ['llama3.1:latest'],
    })

    const diagnostics = await checkOllamaLiveness(ollamaConfig({ model: 'llama3.1' }))

    expect(diagnostics).toEqual([])
  })

  it('warns with a pull hint when the configured model is missing', async () => {
    mockGetOllamaStatus.mockResolvedValue({
      reachable: true,
      installed: true,
      models: ['llama3.2:3b'],
    })

    const [diagnostic] = await checkOllamaLiveness(ollamaConfig({ model: 'llama3.1:8b' }))

    expect(diagnostic.severity).toBe('warn')
    expect(diagnostic.message).toContain("'llama3.1:8b'")
    expect(diagnostic.fix).toBe('Pull it with `ollama pull llama3.1:8b`.')
  })

  it('resolves the commit-tier model for dynamic configs', async () => {
    mockGetOllamaStatus.mockResolvedValue({
      reachable: true,
      installed: true,
      models: ['llama3.2:3b'],
    })

    const [diagnostic] = await checkOllamaLiveness(
      ollamaConfig({ model: 'dynamic', dynamicModelPreference: 'balanced' }),
    )

    expect(diagnostic.severity).toBe('warn')
    // balanced commit tier for ollama is qwen2.5-coder:14b
    expect(diagnostic.message).toContain('qwen2.5-coder:14b')
    expect(diagnostic.message).toContain('dynamic → commit')
  })
})
