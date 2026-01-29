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
    delete process.env.COCO_SERVICE
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
})
