import * as fs from 'fs'
import { loadProjectJsonConfig } from './project'
import { Config } from '../types'
jest.mock('fs')
jest.mock('os')
jest.mock('path')
jest.mock('ini')
jest.mock('yargs', () => ({
  argv: {},
}))

const mockFs = fs as jest.Mocked<typeof fs>

const defaultConfig: Config = {
  service: 'openai/gpt2',
  openAIApiKey: 'sk_default-api-key',
  temperature: 0.4,
  ignoredFiles: ['package-lock.json'],
  ignoredExtensions: ['.map', '.lock'],
}

describe('loadProjectConfig', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });


  it('should load project config', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(JSON.stringify({ openAIApiKey: 'sk_project-json-api-key' }))
    const config = loadProjectJsonConfig(defaultConfig)
    expect(config.openAIApiKey).toBe('sk_project-json-api-key')
  })
})
