import * as fs from 'fs'
import { loadProjectJsonConfig } from './project'
import { Config, OllamaAliasConfig, OpenAIAliasConfig } from '../types'
jest.mock('fs')
jest.mock('os')
jest.mock('path')
jest.mock('ini')
jest.mock('yargs', () => ({
  argv: {},
}))

const mockFs = fs as jest.Mocked<typeof fs>

const openAIAliasConfig: Config = {
  service: 'openai',
  model: 'gpt-4',
  defaultBranch: 'main',
  mode: 'stdout',
  openAIApiKey: 'sk_default-api-key',
  temperature: 0.4,
  ignoredFiles: ['package-lock.json'],
  ignoredExtensions: ['.map', '.lock'],
}

const ollamaAliasConfig: Config = {
  service: 'ollama',
  model: 'mistral',
  defaultBranch: 'main',
  mode: 'stdout',
  temperature: 0.4,
  ignoredFiles: ['package-lock.json'],
  ignoredExtensions: ['.map', '.lock'],
  endpoint: 'http://localhost:3000',
}

describe('loadProjectConfig', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });


  it('should load project config', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(JSON.stringify({ openAIApiKey: 'sk_project-json-api-key' }))
    const config = loadProjectJsonConfig(openAIAliasConfig) as OpenAIAliasConfig
    expect(config.openAIApiKey).toBe('sk_project-json-api-key')
  })

  it('should load project config with service alias', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(JSON.stringify({ service: 'ollama', model: 'mistral' } as Partial<OllamaAliasConfig>))
    const config = loadProjectJsonConfig(ollamaAliasConfig) as OllamaAliasConfig
    expect(config.service).toBe('ollama')
    expect(config.model).toBe('mistral')
    expect(config.endpoint).toBe('http://localhost:3000')
  })
})
