import * as fs from 'fs'
import { getDefaultServiceConfigFromAlias } from '../../langchain/utils'
import { Config } from '../types'
import { OllamaLLMService, OpenAILLMService } from '../../langchain/types'
import { loadGitConfig, appendToGitConfig } from './git'
import { CONFIG_ALREADY_EXISTS } from '../../ui/helpers'
import { updateFileSection } from '../../utils/updateFileSection'

jest.mock('fs')
jest.mock('../../utils/updateFileSection')

const mockFs = fs as jest.Mocked<typeof fs>
const mockedUpdateFileSection = updateFileSection as jest.MockedFunction<typeof updateFileSection>

const defaultConfig: Partial<Config> = {
  service: getDefaultServiceConfigFromAlias('ollama'),
  mode: 'stdout',
  defaultBranch: 'test',
}

const MOCK_GIT_CONFIG = `
[coco]
  serviceProvider = openai
  serviceModel = gpt-4o
  serviceApiKey = test-api-key
  serviceRequestOptionsTimeout = 10000
  serviceRequestOptionsMaxRetries = 5
  serviceFields = {"temperature":0.5,"maxTokens":4000}
  mode = interactive
  defaultBranch = main
`

const MOCK_GIT_CONFIG_OLLAMA = `
[coco]
  serviceProvider = ollama
  serviceModel = llama3
  serviceEndpoint = http://localhost:11434
`

const MOCK_GIT_CONFIG_WITHOUT_COCO_SECTION = `
[core]
  editor=nano
  autocrlf=input
  excludesfile=/home/username/.gitignore_global
[user]
  name=John Doe
`

describe('loadGitConfig', () => {
  afterEach(() => {
    jest.resetAllMocks()
  })

  it('should parse basic .gitconfig file', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(MOCK_GIT_CONFIG)
    const config = loadGitConfig(defaultConfig as Config)
    const service = config.service as OpenAILLMService
    expect(service.provider).toBe('openai')
    expect(service.model).toBe('gpt-4o')
    if (service.authentication.type === 'APIKey') {
      expect(service.authentication.credentials.apiKey).toBe('test-api-key')
    }
    expect(service.requestOptions?.timeout).toBe(10000)
    expect(service.requestOptions?.maxRetries).toBe(5)
    expect(service.fields).toEqual({ temperature: 0.5, maxTokens: 4000 })
    expect(config.mode).toBe('interactive')
    expect(config.defaultBranch).toBe('main')
  })

  it('should parse .gitconfig file for ollama', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(MOCK_GIT_CONFIG_OLLAMA)
    const config = loadGitConfig(defaultConfig as Config)
    const service = config.service as OllamaLLMService
    expect(service.provider).toBe('ollama')
    expect(service.model).toBe('llama3')
    expect(service.endpoint).toBe('http://localhost:11434')
  })

  it('should parse .gitconfig file without coco section', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(MOCK_GIT_CONFIG_WITHOUT_COCO_SECTION)
    const config = loadGitConfig(defaultConfig as Config)
    expect(config.service).toEqual(defaultConfig.service)
    expect(config.mode).toBe('stdout')
    expect(config.defaultBranch).toBe('test')
  })
})

describe('appendToGitConfig', () => {
  afterEach(() => {
    jest.resetAllMocks()
  })

  it('should append config to .gitconfig file', async () => {
    const config: Partial<Config> = {
      service: {
        provider: 'openai',
        model: 'gpt-4o',
        authentication: {
          type: 'APIKey',
          credentials: {
            apiKey: 'test-api-key',
          },
        },
        requestOptions: {
          timeout: 10000,
          maxRetries: 5,
        },
        fields: {
          temperature: 0.5,
          maxTokens: 4000,
        },
      } as OpenAILLMService,
      mode: 'interactive',
      defaultBranch: 'main',
    }

    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue('')
    mockedUpdateFileSection.mockResolvedValue(undefined)

    await appendToGitConfig('~/.gitconfig', config)

    expect(mockedUpdateFileSection).toHaveBeenCalledWith({
      filePath: '~/.gitconfig',
      startComment: '# -- start coco config --',
      endComment: '# -- end coco config --',
      getNewContent: expect.any(Function),
      confirmUpdate: true,
      confirmMessage: CONFIG_ALREADY_EXISTS,
    })
  })
})