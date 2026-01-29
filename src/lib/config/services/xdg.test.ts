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
})
