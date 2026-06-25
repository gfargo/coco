import { Config } from '../../lib/config/types'
import { getOllamaStatus } from '../../lib/langchain/utils/ollamaStatus'
import { checkEndpointSupport, checkOllamaLiveness, checkProviderValidity, Diagnostic } from './checks'

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

describe('checkProviderValidity', () => {
  function configWithProvider(provider: string): Config {
    return { service: { provider, model: 'some-model' } } as unknown as Config
  }

  it('produces no diagnostic for a valid provider', () => {
    const diagnostics: Diagnostic[] = []
    checkProviderValidity(configWithProvider('anthropic'), diagnostics)
    expect(diagnostics).toEqual([])
  })

  it('produces no diagnostic when provider is absent', () => {
    const diagnostics: Diagnostic[] = []
    checkProviderValidity({ service: { model: 'gpt-4o' } } as unknown as Config, diagnostics)
    expect(diagnostics).toEqual([])
  })

  it('produces no diagnostic when service block is absent', () => {
    const diagnostics: Diagnostic[] = []
    checkProviderValidity({} as Config, diagnostics)
    expect(diagnostics).toEqual([])
  })

  it('flags an unknown provider with an error diagnostic', () => {
    const diagnostics: Diagnostic[] = []
    checkProviderValidity(configWithProvider('typo-provider'), diagnostics)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0].severity).toBe('error')
    expect(diagnostics[0].message).toContain('"typo-provider"')
    expect(diagnostics[0].autoFix).toBeUndefined()
  })

  it('suggests anthropic and provides autoFix for alias "claude"', () => {
    const raw = { service: { provider: 'claude', model: 'claude-opus-4-8' } }
    const config = raw as unknown as Config
    const diagnostics: Diagnostic[] = []
    checkProviderValidity(config, diagnostics)

    expect(diagnostics).toHaveLength(1)
    const [d] = diagnostics
    expect(d.severity).toBe('error')
    expect(d.message).toContain('"claude"')
    expect(d.message).toContain('"anthropic"')
    expect(d.fix).toContain('"anthropic"')
    expect(typeof d.autoFix).toBe('function')

    d.autoFix!(raw as Record<string, unknown>)
    expect((raw.service as Record<string, unknown>).provider).toBe('anthropic')
  })

  it('suggests openai for alias "gpt"', () => {
    const diagnostics: Diagnostic[] = []
    checkProviderValidity(configWithProvider('gpt'), diagnostics)
    expect(diagnostics[0].message).toContain('"openai"')
  })

  it('suggests openai for alias "chatgpt"', () => {
    const diagnostics: Diagnostic[] = []
    checkProviderValidity(configWithProvider('chatgpt'), diagnostics)
    expect(diagnostics[0].message).toContain('"openai"')
  })

  it('suggests gemini for alias "google"', () => {
    const diagnostics: Diagnostic[] = []
    checkProviderValidity(configWithProvider('google'), diagnostics)
    expect(diagnostics[0].message).toContain('"gemini"')
  })

  it('suggests bedrock for alias "aws"', () => {
    const diagnostics: Diagnostic[] = []
    checkProviderValidity(configWithProvider('aws'), diagnostics)
    expect(diagnostics[0].message).toContain('"bedrock"')
  })
})

describe('checkEndpointSupport', () => {
  function configWith(provider: string, extra: Record<string, unknown> = {}): Config {
    return { service: { provider, model: 'some-model', ...extra } } as unknown as Config
  }

  it('produces no diagnostic when endpoint is not set', () => {
    const diagnostics: Diagnostic[] = []
    checkEndpointSupport(configWith('openai'), diagnostics)
    expect(diagnostics).toEqual([])
  })

  it('produces no diagnostic when provider is ollama and endpoint is set', () => {
    const diagnostics: Diagnostic[] = []
    checkEndpointSupport(configWith('ollama', { endpoint: 'http://localhost:11434' }), diagnostics)
    expect(diagnostics).toEqual([])
  })

  it('warns when endpoint is set for openai (ignores it)', () => {
    const diagnostics: Diagnostic[] = []
    checkEndpointSupport(configWith('openai', { endpoint: 'http://custom-host:8080' }), diagnostics)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0].severity).toBe('warn')
    expect(diagnostics[0].message).toContain('"openai"')
    expect(diagnostics[0].fix).toContain('baseURL')
  })

  it('warns when endpoint is set for anthropic (ignores it)', () => {
    const diagnostics: Diagnostic[] = []
    checkEndpointSupport(configWith('anthropic', { endpoint: 'http://custom-host:8080' }), diagnostics)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0].severity).toBe('warn')
    expect(diagnostics[0].message).toContain('"anthropic"')
    expect(diagnostics[0].fix).toContain('baseURL')
  })

  it('warns when endpoint is set for a provider with no custom-host support', () => {
    const diagnostics: Diagnostic[] = []
    checkEndpointSupport(configWith('gemini', { endpoint: 'http://custom-host:8080' }), diagnostics)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0].severity).toBe('warn')
    expect(diagnostics[0].message).toContain('"gemini"')
    expect(diagnostics[0].fix).not.toContain('baseURL')
  })

  it('autoFix removes the stray endpoint field', () => {
    const raw = { service: { provider: 'openai', model: 'gpt-4o', endpoint: 'http://custom-host' } }
    const config = raw as unknown as Config
    const diagnostics: Diagnostic[] = []
    checkEndpointSupport(config, diagnostics)

    expect(diagnostics).toHaveLength(1)
    expect(typeof diagnostics[0].autoFix).toBe('function')
    diagnostics[0].autoFix!(raw as Record<string, unknown>)
    expect((raw.service as Record<string, unknown>).endpoint).toBeUndefined()
  })

  it('produces no diagnostic when provider is absent', () => {
    const diagnostics: Diagnostic[] = []
    checkEndpointSupport({ service: { model: 'gpt-4o', endpoint: 'http://x' } } as unknown as Config, diagnostics)
    expect(diagnostics).toEqual([])
  })
})

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
