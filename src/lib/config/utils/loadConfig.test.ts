import { BaseCommandOptions } from '../../../commands/types'
import { ConfigWithServiceAlias } from '../types'
import { loadConfig } from './loadConfig'
import * as fs from 'fs'

jest.mock('fs')
jest.mock('os')
jest.mock('path')
jest.mock('ini')

const mockFs = fs as jest.Mocked<typeof fs>

describe('loadConfig', () => {
  beforeEach(() => {
    mockFs.existsSync.mockClear()
    mockFs.readFileSync.mockClear()
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  it('should correctly combine all config sources', () => {
    mockFs.existsSync.mockImplementation((filepath: fs.PathLike | undefined) => {
      return filepath
        ? ['.gitignore', '.ignore', 'config.json', '.gitconfig', '.coco.config.json'].includes(
            filepath.toString()
          )
        : false
    })

    mockFs.readFileSync.mockImplementation((filepath) => {
      switch (filepath.toString()) {
        case '.gitignore':
          return 'gitignorefile.txt\n'
        case '.ignore':
          return 'ignorefile.txt\n'
        case 'config.json':
          return JSON.stringify({ openAIApiKey: 'xdgConfigKey' })
        case '.gitconfig':
          return 'coco\nopenAIApiKey=gitConfigKey\ntokenLimit=250\n'
        case '.coco.config.json':
          return JSON.stringify({ openAIApiKey: 'projectConfigKey' })
        default:
          return ''
      }
    })

    process.env.OPENAI_API_KEY = 'envApiKey'
    process.env.COCO_TOKEN_LIMIT = '350'

    const argv = {
      service: 'openai',
      openAIApiKey: 'cmdLineApiKey',
      tokenLimit: 450,
    } as BaseCommandOptions

    const config = loadConfig<ConfigWithServiceAlias>(argv)

    // Check that the configuration is correctly combined
    expect(config.openAIApiKey).toBe('cmdLineApiKey') // cmd line flags should have the highest priority
    expect(config.tokenLimit).toBe(450) // environment variable should be overwritten by cmd line flag
    expect(config.ignoredFiles).toContain('gitignorefile.txt')
    expect(config.ignoredFiles).toContain('ignorefile.txt')
    expect(config.mode).toBe('stdout')

    // Cleanup
    delete process.env.OPENAI_API_KEY
    delete process.env.COCO_TOKEN_LIMIT
  })

  // It should load correct default services from env vars when using LLM Alias
  it('should load correct default service when using LLM Alias', () => {
    // process.env.OPENAI_API_KEY = 'sk_env-api-key'
    // process.env.COCO_TOKEN_LIMIT = '250'
    // const config = loadConfig(argv)
    // expect((config.service as LLMService).authentication.credentials?.apiKey).toBe('sk_env-api-key')
    // expect(config.tokenLimit).toBe(250)
    // delete process.env.OPENAI_API_KEY
    // delete process.env.COCO_TOKEN_LIMIT
  })

  // It should load correct Auth API key for OpenAI from env var when using LLM Alias
  it('should load correct Auth API key for OpenAI from env var when using LLM Alias', () => {})

  // It shoudl load correct Auth config for Olama from env var when using LLM Alias
  it('should load correct Auth config for Olama from env var when using LLM Alias', () => {})
})
