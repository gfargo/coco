import { getDefaultServiceConfigFromAlias } from '../../langchain/utils'
import { Config } from '../types'
import { OllamaLLMService } from '../../langchain/types'
import { loadEnvConfig } from './env'

const defaultConfig: Config = {
  service: getDefaultServiceConfigFromAlias('openai'),
  defaultBranch: 'main',
  mode: 'stdout',
  ignoredFiles: ['package-lock.json'],
  ignoredExtensions: ['.map', '.lock'],
}

describe('loadEnvConfig', () => {
  it('should load environment variables', () => {
    process.env.COCO_SERVICE_PROVIDER = 'openai'
    process.env.COCO_DEFAULT_BRANCH = 'coco'
    const config = loadEnvConfig(defaultConfig)
    expect(config.service.provider).toBe('openai')
    expect(config.defaultBranch).toBe('coco')
    delete process.env.COCO_SERVICE_PROVIDER
    delete process.env.COCO_DEFAULT_BRANCH
  })

  it('should load environment variables with mode', () => {
    process.env.COCO_MODE = 'interactive'
    const config = loadEnvConfig(defaultConfig)
    expect(config.mode).toBe('interactive')
    delete process.env.COCO_MODE
  })

  it('should load environment variables with verbose', () => {
    process.env.COCO_VERBOSE = 'true'
    const config = loadEnvConfig(defaultConfig)
    expect(config.verbose).toBe(true)
    delete process.env.COCO_VERBOSE
  })

  it('should load environment variables with ignoredFiles', () => {
    process.env.COCO_IGNORED_FILES = 'package-lock.json,node_modules'
    const config = loadEnvConfig(defaultConfig)
    expect(config.ignoredFiles).toEqual(['package-lock.json', 'node_modules'])
    delete process.env.COCO_IGNORED_FILES
  })

  it('should load environment variables with ignoredExtensions', () => {
    process.env.COCO_IGNORED_EXTENSIONS = '.map,.lock'
    const config = loadEnvConfig(defaultConfig)
    expect(config.ignoredExtensions).toEqual(['.map', '.lock'])
    delete process.env.COCO_IGNORED_EXTENSIONS
  })

  it('should load environment variables with prompt', () => {
    process.env.COCO_PROMPT = 'prompt'
    const config = loadEnvConfig(defaultConfig)
    expect(config.prompt).toEqual('prompt')
    delete process.env.COCO_PROMPT
  })

  it('should load environment variables with service fields', () => {
    process.env.COCO_SERVICE_FIELDS = '{"temperature": 0.5, "maxTokens": 4000}'
    const config = loadEnvConfig(defaultConfig)
    expect(config.service.fields).toEqual({ temperature: 0.5, maxTokens: 4000 })
    delete process.env.COCO_SERVICE_FIELDS
  })

  it('should load environment variables with request options', () => {
    process.env.COCO_SERVICE_REQUEST_OPTIONS_TIMEOUT = '10000'
    process.env.COCO_SERVICE_REQUEST_OPTIONS_MAX_RETRIES = '5'
    const config = loadEnvConfig(defaultConfig)
    expect(config.service.requestOptions?.timeout).toBe(10000)
    expect(config.service.requestOptions?.maxRetries).toBe(5)
    delete process.env.COCO_SERVICE_REQUEST_OPTIONS_TIMEOUT
    delete process.env.COCO_SERVICE_REQUEST_OPTIONS_MAX_RETRIES
  })

  it('should load environment variables with ollama endpoint', () => {
    process.env.COCO_SERVICE_PROVIDER = 'ollama'
    process.env.COCO_SERVICE_ENDPOINT = 'http://localhost:11434'
    const config = loadEnvConfig(defaultConfig)
    expect((config.service as OllamaLLMService).endpoint).toBe('http://localhost:11434')
    delete process.env.COCO_SERVICE_PROVIDER
    delete process.env.COCO_SERVICE_ENDPOINT
  })

  it('should load environment variables with openai baseURL', () => {
    process.env.COCO_SERVICE_PROVIDER = 'openai'
    process.env.COCO_SERVICE_BASE_URL = 'https://openrouter.ai/api/v1'
    const config = loadEnvConfig(defaultConfig)
    expect(config.service.provider).toBe('openai')
    if (config.service.provider === 'openai') {
      expect(config.service.baseURL).toBe('https://openrouter.ai/api/v1')
    }
    delete process.env.COCO_SERVICE_PROVIDER
    delete process.env.COCO_SERVICE_BASE_URL
  })

  describe('provider API keys from the environment', () => {
    // Regression for the toEnvVarName mangling bug: these env-var-form names
    // (OPEN_AI_KEY, GEMINI_API_KEY, ...) must be read verbatim, not rewritten
    // to COCO__O_P_E_N__A_I__K_E_Y. Each key only applies to its provider.
    const cases: Array<{ provider: 'openai' | 'gemini' | 'mistral' | 'azure'; envVar: string }> = [
      { provider: 'openai', envVar: 'OPEN_AI_KEY' },
      { provider: 'gemini', envVar: 'GEMINI_API_KEY' },
      { provider: 'gemini', envVar: 'GOOGLE_API_KEY' },
      { provider: 'mistral', envVar: 'MISTRAL_API_KEY' },
      { provider: 'azure', envVar: 'AZURE_OPENAI_API_KEY' },
    ]

    it.each(cases)('reads $envVar into the $provider service auth', ({ provider, envVar }) => {
      process.env[envVar] = 'env-provided-key'
      try {
        const config = loadEnvConfig({
          ...defaultConfig,
          service: getDefaultServiceConfigFromAlias(provider),
        })
        expect(config.service.provider).toBe(provider)
        expect(config.service.authentication.type).toBe('APIKey')
        if (config.service.authentication.type === 'APIKey') {
          expect(config.service.authentication.credentials?.apiKey).toBe('env-provided-key')
        }
      } finally {
        delete process.env[envVar]
      }
    })

    it('ignores a provider key when the configured provider differs', () => {
      process.env.GEMINI_API_KEY = 'gemini-key'
      try {
        const config = loadEnvConfig({
          ...defaultConfig,
          service: getDefaultServiceConfigFromAlias('openai'),
        })
        // openai service shouldn't pick up the gemini key
        if (config.service.authentication.type === 'APIKey') {
          expect(config.service.authentication.credentials?.apiKey).not.toBe('gemini-key')
        }
      } finally {
        delete process.env.GEMINI_API_KEY
      }
    })
  })

  describe('parseEnvValue robustness (#1468)', () => {
    it('does not coerce a numeric-looking model name to a number', () => {
      process.env.COCO_SERVICE_MODEL = '123'
      try {
        const config = loadEnvConfig(defaultConfig)
        expect(config.service.model).toBe('123')
        expect(typeof config.service.model).toBe('string')
      } finally {
        delete process.env.COCO_SERVICE_MODEL
      }
    })

    it('still coerces genuinely numeric keys (timeout, maxRetries)', () => {
      process.env.COCO_SERVICE_REQUEST_OPTIONS_TIMEOUT = '5000'
      process.env.COCO_SERVICE_REQUEST_OPTIONS_MAX_RETRIES = '3'
      try {
        const config = loadEnvConfig(defaultConfig)
        expect(config.service.requestOptions?.timeout).toBe(5000)
        expect(config.service.requestOptions?.maxRetries).toBe(3)
      } finally {
        delete process.env.COCO_SERVICE_REQUEST_OPTIONS_TIMEOUT
        delete process.env.COCO_SERVICE_REQUEST_OPTIONS_MAX_RETRIES
      }
    })

    it('degrades gracefully on malformed JSON instead of crashing', () => {
      process.env.COCO_SERVICE_FIELDS = '{bad'
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
      try {
        const config = loadEnvConfig(defaultConfig)
        // Should not crash and the field should be left undefined / untouched
        expect(config.service.fields).toBeUndefined()
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('malformed JSON')
        )
      } finally {
        delete process.env.COCO_SERVICE_FIELDS
        warnSpy.mockRestore()
      }
    })

    it('parses valid JSON fields normally', () => {
      process.env.COCO_SERVICE_FIELDS = '{"temperature": 0.7}'
      try {
        const config = loadEnvConfig(defaultConfig)
        expect(config.service.fields).toEqual({ temperature: 0.7 })
      } finally {
        delete process.env.COCO_SERVICE_FIELDS
      }
    })
  })
})
