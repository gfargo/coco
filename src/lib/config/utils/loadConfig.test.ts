import { BaseArgvOptions, BaseCommandOptions } from '../../../commands/types'
import { getDefaultServiceConfigFromAlias } from '../../langchain/utils'
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
          return JSON.stringify({ service: getDefaultServiceConfigFromAlias('ollama') })
        default:
          return ''
      }
    })

    process.env.OPENAI_API_KEY = 'envApiKey'
    process.env.COCO_TOKEN_LIMIT = '350'

    // TODO: Fix this empty object and underlying types
    const argv = {} as BaseArgvOptions

    const config = loadConfig<BaseCommandOptions>(argv)

    // Check that the configuration is correctly combined
    expect(config.service.provider).toBe('ollama')
    // expect(config.tokenLimit).toBe(450) // environment variable should be overwritten by cmd line flag
    expect(config.ignoredFiles).toContain('gitignorefile.txt')
    expect(config.ignoredFiles).toContain('ignorefile.txt')
    expect(config.mode).toBe('stdout')
    // Cleanup
    delete process.env.OPENAI_API_KEY
    delete process.env.COCO_TOKEN_LIMIT
  })
})
