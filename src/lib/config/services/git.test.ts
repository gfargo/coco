import * as fs from 'fs'
import { getDefaultServiceConfigFromAlias } from '../../langchain/utils'
import { Config } from '../types'
import { OllamaLLMService, OpenAILLMService } from '../../langchain/types'
import { loadGitConfig, appendToGitConfig } from './git'
import { CONFIG_ALREADY_EXISTS } from '../../ui/helpers'
import { updateFileSection } from '../../utils/updateFileSection'

jest.mock('fs')
jest.mock('../../utils/updateFileSection')

const mockFs = fs as jest.Mocked<typeof fs>
const mockedUpdateFileSection = updateFileSection as jest.MockedFunction<typeof updateFileSection>

const defaultConfig: Partial<Config> = {
  service: getDefaultServiceConfigFromAlias('ollama'),
  mode: 'stdout',
  defaultBranch: 'test',
}

const MOCK_GIT_CONFIG = `
[coco]
  serviceProvider = openai
  serviceModel = gpt-4o
  serviceApiKey = test-api-key
  serviceTokenLimit = 4096
  serviceTemperature = 0.32
  serviceMaxConcurrent = 12
  serviceMinTokensForSummary = 800
  serviceMaxFileTokens = 2000
  serviceMaxParsingAttempts = 3
  serviceRequestOptionsTimeout = 10000
  serviceRequestOptionsMaxRetries = 5
  serviceFields = {"temperature":0.5,"maxTokens":4000}
  mode = interactive
  defaultBranch = main
`

const MOCK_GIT_CONFIG_OLLAMA = `
[coco]
  serviceProvider = ollama
  serviceModel = llama3
  serviceEndpoint = http://localhost:11434
`

const MOCK_GIT_CONFIG_OPENROUTER = `
[coco]
  serviceProvider = openai
  serviceModel = gpt-4o
  serviceApiKey = test-api-key
  serviceBaseURL = https://openrouter.ai/api/v1
`

const MOCK_GIT_CONFIG_KEYLESS_COMPAT = `
[coco]
  serviceProvider = openai
  serviceModel = local-model
  serviceBaseURL = http://localhost:1234/v1
  serviceAuthType = None
`

const MOCK_GIT_CONFIG_WITHOUT_COCO_SECTION = `
[core]
  editor=nano
  autocrlf=input
  excludesfile=/home/username/.gitignore_global
[user]
  name=John Doe
`

describe('loadGitConfig', () => {
  afterEach(() => {
    jest.resetAllMocks()
  })

  it('should parse basic .gitconfig file', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(MOCK_GIT_CONFIG)
    const config = loadGitConfig(defaultConfig as Config)
    const service = config.service as OpenAILLMService
    expect(service.provider).toBe('openai')
    expect(service.model).toBe('gpt-4o')
    if (service.authentication.type === 'APIKey') {
      expect(service.authentication.credentials.apiKey).toBe('test-api-key')
    }
    expect(service.tokenLimit).toBe(4096)
    expect(service.temperature).toBe(0.32)
    expect(service.maxConcurrent).toBe(12)
    expect(service.minTokensForSummary).toBe(800)
    expect(service.maxFileTokens).toBe(2000)
    expect(service.maxParsingAttempts).toBe(3)
    expect(service.requestOptions?.timeout).toBe(10000)
    expect(service.requestOptions?.maxRetries).toBe(5)
    expect(service.fields).toEqual({ temperature: 0.5, maxTokens: 4000 })
    expect(config.mode).toBe('interactive')
    expect(config.defaultBranch).toBe('main')
  })

  it('should parse .gitconfig file for ollama', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(MOCK_GIT_CONFIG_OLLAMA)
    const config = loadGitConfig(defaultConfig as Config)
    const service = config.service as OllamaLLMService
    expect(service.provider).toBe('ollama')
    expect(service.model).toBe('llama3')
    expect(service.endpoint).toBe('http://localhost:11434')
  })

  it('should parse .gitconfig file with custom OpenAI baseURL (OpenRouter)', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(MOCK_GIT_CONFIG_OPENROUTER)
    const config = loadGitConfig(defaultConfig as Config)
    const service = config.service as OpenAILLMService
    expect(service.provider).toBe('openai')
    expect(service.model).toBe('gpt-4o')
    expect(service.baseURL).toBe('https://openrouter.ai/api/v1')
    if (service.authentication.type === 'APIKey') {
      expect(service.authentication.credentials.apiKey).toBe('test-api-key')
    }
  })

  it('should parse .gitconfig file without coco section', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(MOCK_GIT_CONFIG_WITHOUT_COCO_SECTION)
    const config = loadGitConfig(defaultConfig as Config)
    expect(config.service).toEqual(defaultConfig.service)
    expect(config.mode).toBe('stdout')
    expect(config.defaultBranch).toBe('test')
  })

  it('preserves default service fields when gitconfig only sets a few keys', () => {
    // Regression: previously the loader REPLACED the service object
    // entirely, so a gitconfig that only specified serviceProvider +
    // serviceApiKey would wipe the default tokenLimit, temperature,
    // maxConcurrent, etc. — leaving a hollow service shape that
    // failed downstream because all the LLM-call defaults were gone.
    const sparseGitConfig = `
[coco]
  serviceProvider = openai
  serviceModel = gpt-4o
  serviceApiKey = test-api-key
`
    const defaultsOpenai: Partial<Config> = {
      service: getDefaultServiceConfigFromAlias('openai'),
      mode: 'stdout',
      defaultBranch: 'test',
    }
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(sparseGitConfig)

    const config = loadGitConfig(defaultsOpenai as Config)
    const service = config.service as OpenAILLMService

    // gitconfig override applied
    expect(service.model).toBe('gpt-4o')
    if (service.authentication.type === 'APIKey') {
      expect(service.authentication.credentials.apiKey).toBe('test-api-key')
    }
    // Defaults preserved — the previous bug wiped these
    expect(service.tokenLimit).toBeDefined()
    expect(service.temperature).toBeDefined()
    expect(service.maxConcurrent).toBeDefined()
  })

  it('does not attach requestOptions when neither sub-field is set', () => {
    // Regression: previously the loader built `requestOptions: {
    // timeout: Number(undefined), maxRetries: Number(undefined) }` →
    // `{ timeout: NaN, maxRetries: NaN }` → JSON-serializes to
    // `{ timeout: null, maxRetries: null }` → schema validation
    // rejected since timeout/maxRetries must be number.
    const noRequestOptions = `
[coco]
  serviceProvider = openai
  serviceModel = gpt-4.1-nano
  serviceApiKey = sk-test
`
    const defaultsOpenai: Partial<Config> = {
      service: getDefaultServiceConfigFromAlias('openai'),
      mode: 'stdout',
      defaultBranch: 'test',
    }
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(noRequestOptions)

    const config = loadGitConfig(defaultsOpenai as Config)
    const service = config.service as OpenAILLMService

    // No spurious requestOptions object created from undefined keys.
    expect(service.requestOptions).toBeUndefined()
  })

  it('attaches only the requestOptions sub-fields that gitconfig actually sets', () => {
    // Partial set: only timeout, no maxRetries. Result should have
    // timeout populated and maxRetries unset (not NaN).
    const partialRequestOptions = `
[coco]
  serviceProvider = openai
  serviceModel = gpt-4o
  serviceApiKey = sk-test
  serviceRequestOptionsTimeout = 15000
`
    const defaultsOpenai: Partial<Config> = {
      service: getDefaultServiceConfigFromAlias('openai'),
      mode: 'stdout',
      defaultBranch: 'test',
    }
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(partialRequestOptions)

    const config = loadGitConfig(defaultsOpenai as Config)
    const service = config.service as OpenAILLMService

    expect(service.requestOptions?.timeout).toBe(15000)
    expect(service.requestOptions?.maxRetries).toBeUndefined()
  })

  it('reconstructs authentication.type "None" for a keyless OpenAI-compatible endpoint (OSS-1003)', () => {
    // Regression: previously authentication was only reconstructed when
    // serviceApiKey was present, so a keyless compat config (LM Studio /
    // vLLM / custom) reverted to the incoming default service's APIKey
    // auth on reload — breaking the very presets #1610/#1665 introduced.
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(MOCK_GIT_CONFIG_KEYLESS_COMPAT)

    const defaultsOpenai: Partial<Config> = {
      service: getDefaultServiceConfigFromAlias('openai'),
      mode: 'stdout',
      defaultBranch: 'test',
    }
    const config = loadGitConfig(defaultsOpenai as Config)
    const service = config.service as OpenAILLMService

    expect(service.authentication.type).toBe('None')
    expect(service.baseURL).toBe('http://localhost:1234/v1')
  })

  it('does not attach provider-irrelevant fields (endpoint on openai, baseURL on ollama)', () => {
    // Regression: the loader unconditionally attached both endpoint
    // AND baseURL regardless of provider. Each provider's schema
    // variant has additionalProperties:false, so the irrelevant one
    // (endpoint for openai, baseURL for ollama) would fail
    // validation in its non-applicable anyOf branch.
    const openaiGitConfig = `
[coco]
  serviceProvider = openai
  serviceModel = gpt-4o
  serviceApiKey = sk-test
`
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(openaiGitConfig)

    const defaultsOpenai: Partial<Config> = {
      service: getDefaultServiceConfigFromAlias('openai'),
      mode: 'stdout',
      defaultBranch: 'test',
    }
    const config = loadGitConfig(defaultsOpenai as Config)
    const service = config.service as OpenAILLMService

    // 'endpoint' belongs to OllamaLLMService — must not appear on an
    // openai service.
    expect((service as unknown as { endpoint?: string }).endpoint).toBeUndefined()
  })
})

describe('appendToGitConfig', () => {
  afterEach(() => {
    jest.resetAllMocks()
  })

  it('should append config to .gitconfig file', async () => {
    const config: Partial<Config> = {
      service: {
        provider: 'openai',
        model: 'gpt-4o',
        authentication: {
          type: 'APIKey',
          credentials: {
            apiKey: 'test-api-key',
          },
        },
        requestOptions: {
          timeout: 10000,
          maxRetries: 5,
        },
        fields: {
          temperature: 0.5,
          maxTokens: 4000,
        },
      } as OpenAILLMService,
      mode: 'interactive',
      defaultBranch: 'main',
    }

    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue('')
    mockedUpdateFileSection.mockResolvedValue(undefined)

    await appendToGitConfig('~/.gitconfig', config)

    expect(mockedUpdateFileSection).toHaveBeenCalledWith({
      filePath: '~/.gitconfig',
      startComment: '# -- start coco config --',
      endComment: '# -- end coco config --',
      getNewContent: expect.any(Function),
      confirmUpdate: true,
      confirmMessage: CONFIG_ALREADY_EXISTS,
    })
  })

  it('emits serviceAuthType = None (and no serviceApiKey) for a keyless OpenAI-compatible service (OSS-1003)', async () => {
    const config: Partial<Config> = {
      service: {
        provider: 'openai',
        model: 'gpt-4o',
        baseURL: 'http://localhost:1234/v1',
        authentication: { type: 'None', credentials: undefined },
      } as OpenAILLMService,
      mode: 'interactive',
      defaultBranch: 'main',
    }

    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue('')
    mockedUpdateFileSection.mockResolvedValue(undefined)

    await appendToGitConfig('~/.gitconfig', config)

    const { getNewContent } = mockedUpdateFileSection.mock.calls[0][0]
    const content = await getNewContent()

    expect(content).toContain('serviceAuthType = None')
    expect(content).not.toContain('serviceApiKey')
    expect(content).toContain('serviceBaseURL = http://localhost:1234/v1')
  })
})