import * as fs from 'fs'
import { getDefaultServiceConfigFromAlias } from '../../langchain/utils'
import { Config } from '../types'
import { loadGitConfig } from './git'
jest.mock('fs')

const mockFs = fs as jest.Mocked<typeof fs>

const defaultConfig: Partial<Config> = {
  service: getDefaultServiceConfigFromAlias('ollama'),
  mode: 'stdout',
  defaultBranch: 'test',
}

const MOCK_GIT_CONFIG = `
[coco]
  service = {"provider":"openai","model":"gpt-4o","tokenLimit":2024,"temperature":0.32,"authentication":{"type":"APIKey","credentials":{"apiKey":"test-api-key"}}}
  mode = interactive
  defaultBranch = main
`

const MOCK_GIT_CONFIG_WITHOUT_COCO_SECTION = `
[core]
  editor=nano
  autocrlf=input
  excludesfile=/home/username/.gitignore_global
[user]
  name=John Doe
`

const MOCK_GIT_CONFIG_WITH_COCO_COMMENTS = `
# -- Start coco config --
[coco]
	service = {"provider":"openai","model":"gpt-4o","tokenLimit":2024,"temperature":0.32,"authentication":{"type":"APIKey","credentials":{"apiKey":"test-api-key"}}}
	defaultBranch = main
	mode = interactive
# -- End coco config --
`

const MOCK_GIT_CONFIG_WITH_SERVICE_ALIAS_AND_OPENAI_API_KEY = `
[coco]
  service = {"provider":"openai","model":"gpt-4o","tokenLimit":2024,"temperature":0.32,"authentication":{"type":"APIKey","credentials":{"apiKey":"test-api-key"}}}
`

describe('loadGitConfig', () => {
  afterEach(() => {
    jest.resetAllMocks()
  })

  it('should parse basic .gitconfig file', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(MOCK_GIT_CONFIG)
    const config = loadGitConfig(defaultConfig as Config)
    expect(config.service.provider).toBe('openai')
    expect(config.mode).toBe('interactive')
    expect(config.defaultBranch).toBe('main')
  })

  it('should parse .gitconfig file without coco section', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(MOCK_GIT_CONFIG_WITHOUT_COCO_SECTION)
    const config = loadGitConfig(defaultConfig as Config)
    expect(config.service).toBe(defaultConfig.service)
    expect(config.mode).toBe('stdout')
    expect(config.defaultBranch).toBe('test')
  })

  it('should parse .gitconfig file with coco comments', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(MOCK_GIT_CONFIG_WITH_COCO_COMMENTS)
    const config = loadGitConfig(defaultConfig as Config)
    expect(config.service.provider).toBe('openai')
    expect(config.mode).toBe('interactive')
    expect(config.defaultBranch).toBe('main')
  })

  it('should parse .gitconfig file with service alias and openai api key', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(MOCK_GIT_CONFIG_WITH_SERVICE_ALIAS_AND_OPENAI_API_KEY)
    const config = loadGitConfig(defaultConfig as Config)
    expect(config.service.provider).toBe('openai')
    expect(config.mode).toBe('stdout')
    expect(config.defaultBranch).toBe('test')
  })
})
