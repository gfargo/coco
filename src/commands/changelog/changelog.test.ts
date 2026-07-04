import { Arguments } from 'yargs'
import { SimpleGit } from 'simple-git'
import { handler } from './handler'
import { ChangelogOptions } from './config'
import { Config } from '../../commands/types'
import { getRepo } from '../../lib/simple-git/getRepo'
import { getCommitLogCurrentBranch } from '../../lib/simple-git/getCommitLogCurrentBranch'
import { getCurrentBranchName } from '../../lib/simple-git/getCurrentBranchName'
import { executeChain } from '../../lib/langchain/utils/executeChain'
import { loadConfig } from '../../lib/config/utils/loadConfig'
import { getApiKeyForModel, getModelAndProviderFromConfig } from '../../lib/langchain/utils'
import { getLlm } from '../../lib/langchain/utils/getLlm'
import { getTokenCounter } from '../../lib/utils/tokenizer'
import { handleResult } from '../../lib/ui/handleResult'
import { Logger } from '../../lib/utils/logger'

jest.mock('../../lib/simple-git/getRepo')
jest.mock('../../lib/simple-git/getCommitLogCurrentBranch')
jest.mock('../../lib/simple-git/getCommitLogAgainstBranch')
jest.mock('../../lib/simple-git/getCommitLogAgainstTag')
jest.mock('../../lib/simple-git/getCommitLogRangeDetails')
jest.mock('../../lib/simple-git/getChangesSinceLastTag')
jest.mock('../../lib/simple-git/getChangesByCommit')
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
jest.mock('../../lib/ui/handleResult')
jest.mock('../../lib/ui/generateAndReviewLoop', () => ({
  generateAndReviewLoop: jest.fn().mockImplementation(async ({ factory, parser, agent, noResult, options }) => {
    const changes = await factory()
    if (!changes || (Array.isArray(changes) && changes.length === 0)) {
      await noResult(options)
      return ''
    }
    const context = await parser(changes, '', options)
    return await agent(context, options)
  }),
}))

const mockGetRepo = getRepo as jest.MockedFunction<typeof getRepo>
const mockGetCommitLogCurrentBranch = getCommitLogCurrentBranch as jest.MockedFunction<
  typeof getCommitLogCurrentBranch
>
const mockGetCurrentBranchName = getCurrentBranchName as jest.MockedFunction<typeof getCurrentBranchName>
const mockExecuteChain = executeChain as jest.MockedFunction<typeof executeChain>
const mockLoadConfig = loadConfig as jest.MockedFunction<typeof loadConfig>
const mockGetApiKeyForModel = getApiKeyForModel as jest.MockedFunction<typeof getApiKeyForModel>
const mockGetModelAndProviderFromConfig = getModelAndProviderFromConfig as jest.MockedFunction<
  typeof getModelAndProviderFromConfig
>
const mockGetLlm = getLlm as jest.MockedFunction<typeof getLlm>
const mockGetTokenCounter = getTokenCounter as jest.MockedFunction<typeof getTokenCounter>
const mockHandleResult = handleResult as jest.MockedFunction<typeof handleResult>

describe('changelog command', () => {
  let argv: Arguments<ChangelogOptions>
  let logger: Logger

  beforeEach(() => {
    argv = {
      $0: 'coco',
      _: ['changelog'],
      interactive: false,
      mode: 'stdout',
      verbose: false,
      version: false,
      help: false,
    } as unknown as Arguments<ChangelogOptions>
    logger = {
      log: jest.fn(),
      verbose: jest.fn(),
      setConfig: jest.fn(),
      error: jest.fn(),
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
    } as unknown as Config)
    mockGetApiKeyForModel.mockReturnValue('mock-api-key')
    mockGetModelAndProviderFromConfig.mockReturnValue({
      provider: 'openai',
      model: 'gpt-4o',
    })
    mockGetLlm.mockReturnValue({} as unknown as ReturnType<typeof getLlm>)
    mockGetTokenCounter.mockResolvedValue((text: string) => text.length)
    mockGetCommitLogCurrentBranch.mockResolvedValue([
      {
        hash: 'abc1234',
        author_name: 'Test Author',
        message: 'feat: add a thing',
        body: 'body text',
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any)
    mockGetCurrentBranchName.mockResolvedValue('feature/test-branch')
    mockExecuteChain.mockResolvedValue({
      title: 'Mocked changelog title',
      content: 'Mocked changelog content',
    })
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('emits machine-readable JSON when --json is passed', async () => {
    argv.json = true

    const writes: string[] = []
    const writeSpy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(((chunk: string) => {
        writes.push(String(chunk))
        return true
      }) as never)
    try {
      await handler(argv, logger)
    } finally {
      writeSpy.mockRestore()
    }

    const jsonCall = writes
      .find((message) => {
        try {
          JSON.parse(message)
          return true
        } catch {
          return false
        }
      })

    expect(jsonCall).toBeDefined()
    const parsed = JSON.parse(jsonCall as string)
    expect(parsed.title).toBe('Mocked changelog title')
    expect(typeof parsed.content).toBe('string')
    expect(parsed.content).toContain('Mocked changelog content')
    expect(mockHandleResult).not.toHaveBeenCalled()
  })

  it('renders formatted output (not JSON) by default', async () => {
    await handler(argv, logger)
    expect(mockHandleResult).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'stdout' })
    )
  })
})
