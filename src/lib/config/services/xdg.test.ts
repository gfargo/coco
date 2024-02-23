import * as fs from 'fs'
import { Config, OllamaAliasConfig, OpenAIAliasConfig } from '../types'
import { loadXDGConfig } from './xdg'

jest.mock('fs')

const mockFs = fs as jest.Mocked<typeof fs>

const openAIAliasConfig: Partial<Config> = {
  service: 'openai',
  openAIApiKey: 'sk_default-api-key',
  mode: 'stdout',
  temperature: 0.4,
  ignoredFiles: ['package-lock.json'],
  ignoredExtensions: ['.map', '.lock'],
}

const ollamaAliasConfig: Partial<Config> = {
  service: 'ollama',
  endpoint: 'http://localhost:3000',
  mode: 'stdout',
  temperature: 0.4,
  ignoredFiles: ['package-lock.json'],
  ignoredExtensions: ['.map', '.lock'],
}


describe('loadXDGConfig', () => {
  afterEach(() => {
    jest.resetAllMocks()
  })

  it('should load XDG config', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(JSON.stringify({ openAIApiKey: '1234' }))
    const config = loadXDGConfig(openAIAliasConfig) as OpenAIAliasConfig
    expect(config.openAIApiKey).toBe('1234')
  })

  it('should load XDG config with service alias', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(JSON.stringify({ service: 'ollama' }))
    const config = loadXDGConfig(openAIAliasConfig)
    expect(config.service).toBe('ollama')
  })

  it('should load XDG config with ollama alias and endpoint', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(JSON.stringify({ service: 'ollama' }))
    const config = loadXDGConfig(ollamaAliasConfig) as OllamaAliasConfig
    expect(config.service).toBe('ollama')
    expect(config.endpoint).toBe('http://localhost:3000')
  })
})
