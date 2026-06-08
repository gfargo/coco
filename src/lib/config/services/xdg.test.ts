import * as fs from 'fs'
import { getDefaultServiceConfigFromAlias } from '../../langchain/utils'
import { Config } from '../types'
import { loadXDGConfig } from './xdg'

jest.mock('fs')

const mockFs = fs as jest.Mocked<typeof fs>

const openAIConfig: Partial<Config> = {
  service: getDefaultServiceConfigFromAlias('openai'),
  mode: 'stdout',
  ignoredFiles: ['package-lock.json'],
  ignoredExtensions: ['.map', '.lock'],
}

const ollamaConfig: Partial<Config> = {
  service: getDefaultServiceConfigFromAlias('ollama'),
  mode: 'stdout',
  ignoredFiles: ['package-lock.json'],
  ignoredExtensions: ['.map', '.lock'],
}

describe('loadXDGConfig', () => {
  afterEach(() => {
    jest.resetAllMocks()
  })

  it('should load XDG config', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({ service: getDefaultServiceConfigFromAlias('openai') })
    )
    const config = loadXDGConfig(openAIConfig)

    expect(config.service.provider).toBe('openai')
    expect(config.service.authentication.type).toBe('APIKey')
  })

  it('should load XDG config with service alias', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({ service: getDefaultServiceConfigFromAlias('openai') })
    )
    const config = loadXDGConfig(openAIConfig)
    expect(config.service.provider).toBe('openai')
  })

  it('should load XDG config with ollama alias and endpoint', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({ service: getDefaultServiceConfigFromAlias('ollama') })
    )
    const config = loadXDGConfig(ollamaConfig)
    expect(config.service.provider).toBe('ollama')
    if (config.service.provider === 'ollama') {
      expect(config.service.endpoint).toBe('http://localhost:11434')
    }
  })

  it('should load XDG config with openai baseURL', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({
        service: {
          provider: 'openai',
          model: 'gpt-4o',
          baseURL: 'https://openrouter.ai/api/v1',
          apiKey: 'test-key'
        }
      })
    )
    const config = loadXDGConfig(openAIConfig)
    expect(config.service.provider).toBe('openai')
    if (config.service.provider === 'openai') {
      expect(config.service.baseURL).toBe('https://openrouter.ai/api/v1')
    }
  })

  it('parses a gemini service with an API key', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({
        service: { provider: 'gemini', model: 'gemini-2.5-flash', apiKey: 'g-key' },
      })
    )
    const config = loadXDGConfig({ service: getDefaultServiceConfigFromAlias('gemini') })
    expect(config.service.provider).toBe('gemini')
    expect(config.service.authentication.type).toBe('APIKey')
  })

  it('parses a mistral service with an API key', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({
        service: { provider: 'mistral', model: 'mistral-small-latest', apiKey: 'm-key' },
      })
    )
    const config = loadXDGConfig({ service: getDefaultServiceConfigFromAlias('mistral') })
    expect(config.service.provider).toBe('mistral')
    expect(config.service.authentication.type).toBe('APIKey')
  })

  it('parses an azure service with instance/deployment/apiVersion', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({
        service: {
          provider: 'azure',
          model: 'gpt-4o',
          apiKey: 'a-key',
          instanceName: 'my-instance',
          deploymentName: 'gpt-4o-deploy',
          apiVersion: '2024-10-21',
        },
      })
    )
    const config = loadXDGConfig({ service: getDefaultServiceConfigFromAlias('azure') })
    expect(config.service.provider).toBe('azure')
    if (config.service.provider === 'azure') {
      expect(config.service.instanceName).toBe('my-instance')
      expect(config.service.deploymentName).toBe('gpt-4o-deploy')
      expect(config.service.apiVersion).toBe('2024-10-21')
    }
  })

  it('parses a bedrock service with region and no-auth credential chain', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({
        service: {
          provider: 'bedrock',
          model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
          region: 'us-east-1',
        },
      })
    )
    const config = loadXDGConfig({ service: getDefaultServiceConfigFromAlias('bedrock') })
    expect(config.service.provider).toBe('bedrock')
    expect(config.service.authentication.type).toBe('None')
    if (config.service.provider === 'bedrock') {
      expect(config.service.region).toBe('us-east-1')
    }
  })
})
