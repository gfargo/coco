import * as fs from 'fs'
import { loadProjectJsonConfig } from './project'
import { Config } from '../types'
import { getDefaultServiceConfigFromAlias } from '../../langchain/utils'

jest.mock('fs')
jest.mock('os')
jest.mock('path')
jest.mock('ini')
jest.mock('yargs', () => ({
  argv: {},
}))

const mockFs = fs as jest.Mocked<typeof fs>

const openAIAliasConfig: Config = {
  service: getDefaultServiceConfigFromAlias('openai'),
  defaultBranch: 'main',
  mode: 'stdout',
  ignoredFiles: ['package-lock.json'],
  ignoredExtensions: ['.map', '.lock'],
}

const ollamaAliasConfig: Config = {
  service: getDefaultServiceConfigFromAlias('ollama', 'mistral'),
  defaultBranch: 'main',
  mode: 'stdout',
  ignoredFiles: ['package-lock.json'],
  ignoredExtensions: ['.map', '.lock'],
}

describe('loadProjectConfig', () => {
  afterEach(() => {
    jest.resetAllMocks()
  })

  it('should load project config', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({ service: getDefaultServiceConfigFromAlias('openai', 'gpt-3.5-turbo') })
    )
    const config = loadProjectJsonConfig(openAIAliasConfig)
    expect(config.service.provider).toBe('openai')
  })

  it('should load project config with service alias', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({ service: getDefaultServiceConfigFromAlias('ollama', 'mistral') })
    )
    const config = loadProjectJsonConfig(ollamaAliasConfig)
    expect(config.service.provider).toBe('ollama')
    expect(config.service.model).toBe('mistral')

    if (config.service.provider === 'ollama') {
      expect(config.service.endpoint).toBe('http://localhost:11434')
    }
  })
})
