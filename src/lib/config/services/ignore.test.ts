import * as fs from 'fs'
import { Config } from '../types'
import { loadGitignore, loadIgnore } from './ignore'
jest.mock('fs')
jest.mock('os')
jest.mock('path')
jest.mock('ini')
jest.mock('yargs', () => ({
  argv: {},
}))

const mockFs = fs as jest.Mocked<typeof fs>

const defaultConfig: Config = {
  model: 'openai/gpt-3.5-turbo',
  openAIApiKey: 'sk_default-api-key',
}

describe('loadGitignore', () => {
  it('should load .gitignore', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue('file.txt\n#comment\n')
    const config = loadGitignore(defaultConfig)
    expect(config.ignoredFiles).toContain('file.txt')
    expect(config.ignoredFiles).not.toContain('#comment')
  })
})

describe('loadIgnore', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });
  
  it('should load .ignore', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue('ignore.txt\n#comment\n')
    const config = loadIgnore(defaultConfig)
    expect(config.ignoredFiles).toContain('ignore.txt')
    expect(config.ignoredFiles).not.toContain('#comment')
  })
})
