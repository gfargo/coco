import { Arguments } from 'yargs'
import { SimpleGit } from 'simple-git'
import { handler } from './handler'
import { ReviewOptions } from './config'
import { Config } from '../../commands/types'
import { getRepo } from '../../lib/simple-git/getRepo'
import { getChanges } from '../../lib/simple-git/getChanges'
import { getDiffForBranch } from '../../lib/simple-git/getDiffForBranch'
import { getCurrentBranchName } from '../../lib/simple-git/getCurrentBranchName'
import { fileChangeParser } from '../../lib/parsers/default'
import { executeChain } from '../../lib/langchain/utils/executeChain'
import { loadConfig } from '../../lib/config/utils/loadConfig'
import { getApiKeyForModel, getModelAndProviderFromConfig } from '../../lib/langchain/utils'
import { getLlm } from '../../lib/langchain/utils/getLlm'
import { getTokenCounter } from '../../lib/utils/tokenizer'
import { Logger } from '../../lib/utils/logger'

jest.mock('../../lib/simple-git/getRepo')
jest.mock('../../lib/simple-git/getChanges')
jest.mock('../../lib/simple-git/getDiffForBranch')
jest.mock('../../lib/simple-git/getCurrentBranchName')
jest.mock('../../lib/parsers/default')
jest.mock('../../lib/langchain/utils/executeChain')
jest.mock('../../lib/langchain/utils/createSchemaParser', () => ({
  createSchemaParser: jest.fn().mockReturnValue({}),
}))
jest.mock('../../lib/config/utils/loadConfig')
jest.mock('../../lib/langchain/utils')
jest.mock('../../lib/langchain/utils/getLlm')
jest.mock('../../lib/utils/tokenizer')
jest.mock('../../lib/ui/generateAndReviewLoop', () => ({
  generateAndReviewLoop: jest.fn().mockImplementation(async ({ factory, parser, agent, noResult, options }) => {
    const changes = await factory()
    if (!changes || (Array.isArray(changes) && changes.length === 0)) {
      await noResult(options)
      return []
    }
    const context = await parser(changes, '', options)
    return await agent(context, options)
  }),
}))
jest.mock('../../lib/ui/TaskList', () => ({
  TaskList: jest.fn().mockImplementation(() => ({
    start: jest.fn(),
  })),
}))

const mockGetRepo = getRepo as jest.MockedFunction<typeof getRepo>
const mockGetChanges = getChanges as jest.MockedFunction<typeof getChanges>
const mockGetDiffForBranch = getDiffForBranch as jest.MockedFunction<typeof getDiffForBranch>
const mockGetCurrentBranchName = getCurrentBranchName as jest.MockedFunction<typeof getCurrentBranchName>
const mockFileChangeParser = fileChangeParser as jest.MockedFunction<typeof fileChangeParser>
const mockExecuteChain = executeChain as jest.MockedFunction<typeof executeChain>
const mockLoadConfig = loadConfig as jest.MockedFunction<typeof loadConfig>
const mockGetApiKeyForModel = getApiKeyForModel as jest.MockedFunction<typeof getApiKeyForModel>
const mockGetModelAndProviderFromConfig = getModelAndProviderFromConfig as jest.MockedFunction<
  typeof getModelAndProviderFromConfig
>
const mockGetLlm = getLlm as jest.MockedFunction<typeof getLlm>
const mockGetTokenCounter = getTokenCounter as jest.MockedFunction<typeof getTokenCounter>

describe('review command', () => {
  let argv: Arguments<ReviewOptions>
  let logger: Logger

  beforeEach(() => {
    argv = {
      $0: 'coco',
      _: ['review'],
      interactive: false,
      branch: '',
      verbose: false,
      version: false,
      help: false,
    }
    logger = {
      log: jest.fn(),
      verbose: jest.fn(),
      setConfig: jest.fn(),
      startTimer: jest.fn().mockReturnThis(),
      stopTimer: jest.fn(),
      startSpinner: jest.fn().mockReturnThis(),
      stopSpinner: jest.fn(),
    } as unknown as Logger

    mockGetRepo.mockReturnValue({} as SimpleGit)
    mockLoadConfig.mockReturnValue({
      service: {
        authentication: {
          type: 'APIKey',
          credentials: {
            apiKey: 'mock-api-key',
          },
        },
        provider: 'openai',
        model: 'gpt-4o',
        tokenLimit: 4096,
        temperature: 0.2,
        maxConcurrent: 1,
      },
      defaultBranch: 'main',
      mode: 'stdout',
      interactive: false,
    } as unknown as Config)
    mockGetApiKeyForModel.mockReturnValue('mock-api-key')
    mockGetModelAndProviderFromConfig.mockReturnValue({
      provider: 'openai',
      model: 'gpt-4o',
    })
    mockGetLlm.mockReturnValue({} as unknown as ReturnType<typeof getLlm>)
    mockGetTokenCounter.mockResolvedValue((text: string) => text.length)
    mockGetChanges.mockResolvedValue({
      staged: [{ filePath: 'src/file.ts', status: 'modified', summary: 'changed file' }],
      unstaged: [],
      untracked: [],
    })
    mockGetCurrentBranchName.mockResolvedValue('feature/test-branch')
    mockGetDiffForBranch.mockResolvedValue({
      staged: [{ filePath: 'src/file.ts', status: 'modified', summary: 'changed file' }],
      unstaged: [],
      untracked: [],
    })
    mockFileChangeParser.mockResolvedValue('mocked file change summary')
    mockExecuteChain.mockResolvedValue([
      {
        title: 'Review finding',
        summary: 'A review finding.',
        severity: 5,
        category: 'maintainability',
        filePath: 'src/file.ts',
      },
    ])
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('trims oversized rendered review prompts before execution', async () => {
    mockLoadConfig.mockReturnValue({
      service: {
        authentication: {
          type: 'APIKey',
          credentials: {
            apiKey: 'mock-api-key',
          },
        },
        provider: 'openai',
        model: 'gpt-4o',
        tokenLimit: 2000,
        temperature: 0.2,
        maxConcurrent: 1,
      },
      defaultBranch: 'main',
      mode: 'stdout',
      interactive: false,
    } as unknown as Config)
    mockFileChangeParser.mockResolvedValue('x'.repeat(2500))

    await handler(argv, logger)

    const variables = mockExecuteChain.mock.calls[0][0].variables as Record<string, string>

    expect(variables.changes.length).toBeLessThan(2500)
    expect(logger.verbose).toHaveBeenCalledWith(
      expect.stringContaining('Rendered prompt exceeded token budget'),
      { color: 'yellow' }
    )
  })
})
