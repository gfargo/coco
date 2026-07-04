import { Arguments } from 'yargs'
import { handler } from './handler'
import { RecapOptions } from './config'
import { getRepo } from '../../lib/simple-git/getRepo'
import { getChanges } from '../../lib/simple-git/getChanges'
import { getChangesByTimestamp } from '../../lib/simple-git/getChangesByTimestamp'
import { getChangesSinceLastTag } from '../../lib/simple-git/getChangesSinceLastTag'
import { getCurrentBranchName } from '../../lib/simple-git/getCurrentBranchName'
import { getDiffForBranch } from '../../lib/simple-git/getDiffForBranch'
import { fileChangeParser } from '../../lib/parsers/default'
import { executeChain } from '../../lib/langchain/utils/executeChain'
import { loadConfig } from '../../lib/config/utils/loadConfig'
import { getApiKeyForModel, getModelAndProviderFromConfig } from '../../lib/langchain/utils'
import { getLlm } from '../../lib/langchain/utils/getLlm'
import { getTokenCounterForProvider } from '../../lib/utils/tokenizer'
import { handleResult } from '../../lib/ui/handleResult'
import { Logger } from '../../lib/utils/logger'
import { SimpleGit } from 'simple-git'
import { Config } from '../../commands/types'

jest.mock('../../lib/simple-git/getRepo')
jest.mock('../../lib/simple-git/getChanges')
jest.mock('../../lib/simple-git/getChangesByTimestamp')
jest.mock('../../lib/simple-git/getChangesSinceLastTag')
jest.mock('../../lib/simple-git/getCurrentBranchName')
jest.mock('../../lib/simple-git/getDiffForBranch')
jest.mock('../../lib/parsers/default')
jest.mock('../../lib/langchain/utils/executeChain')
jest.mock('../../lib/config/utils/loadConfig')
jest.mock('../../lib/langchain/utils')
jest.mock('../../lib/langchain/utils/getLlm')
jest.mock('../../lib/utils/tokenizer')
jest.mock('../../lib/ui/handleResult')
jest.mock('../../lib/ui/generateAndReviewLoop', () => ({
  generateAndReviewLoop: jest.fn().mockImplementation(async ({ factory, parser, agent, noResult, options }) => {
    const changes = await factory();
    if (!changes || (Array.isArray(changes) && changes.length === 0)) {
      await noResult(options);
      return '';
    }
    const context = await parser(changes, '', options);
    return await agent(context, options);
  }),
}));

const mockGetRepo = getRepo as jest.MockedFunction<typeof getRepo>
const mockGetChanges = getChanges as jest.MockedFunction<typeof getChanges>
const mockGetChangesByTimestamp = getChangesByTimestamp as jest.MockedFunction<typeof getChangesByTimestamp>
const mockGetChangesSinceLastTag = getChangesSinceLastTag as jest.MockedFunction<typeof getChangesSinceLastTag>
const mockGetCurrentBranchName = getCurrentBranchName as jest.MockedFunction<typeof getCurrentBranchName>
const mockGetDiffForBranch = getDiffForBranch as jest.MockedFunction<typeof getDiffForBranch>
const mockFileChangeParser = fileChangeParser as jest.MockedFunction<typeof fileChangeParser>
const mockExecuteChain = executeChain as jest.MockedFunction<typeof executeChain>
const mockLoadConfig = loadConfig as jest.MockedFunction<typeof loadConfig>
const mockGetApiKeyForModel = getApiKeyForModel as jest.MockedFunction<typeof getApiKeyForModel>
const mockGetModelAndProviderFromConfig = getModelAndProviderFromConfig as jest.MockedFunction<
  typeof getModelAndProviderFromConfig
>
const mockGetLlm = getLlm as jest.MockedFunction<typeof getLlm>
const mockGetTokenCounterForProvider = getTokenCounterForProvider as jest.MockedFunction<
  typeof getTokenCounterForProvider
>
const mockHandleResult = handleResult as jest.MockedFunction<typeof handleResult>


describe('recap command', () => {
  let argv: Arguments<RecapOptions>
  let logger: Logger

  beforeEach(() => {
    argv = {
      $0: 'coco',
      _: ['recap'],
      interactive: false,
      mode: 'stdout',
      verbose: false,
      version: false,
      help: false,
    }
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
      currentBranch: false,
    } as unknown as Config)
    mockGetApiKeyForModel.mockReturnValue('mock-api-key')
    mockGetModelAndProviderFromConfig.mockReturnValue({
      provider: 'openai',
      model: 'gpt-4o',
    })
    mockGetLlm.mockReturnValue({} as unknown as ReturnType<typeof getLlm>)
    mockGetTokenCounterForProvider.mockResolvedValue((text: string) => text.length)
    mockGetChanges.mockResolvedValue({
      staged: [],
      unstaged: [],
      untracked: [],
    })
    mockGetChangesByTimestamp.mockResolvedValue(['mocked timestamp changes'])
    mockGetChangesSinceLastTag.mockResolvedValue(['mocked tag changes'])
    mockGetCurrentBranchName.mockResolvedValue('feature/test-branch')
    mockGetDiffForBranch.mockResolvedValue({
      staged: [{ filePath: 'branch-file.txt', status: 'added', summary: 'branch file summary' }],
      unstaged: [],
      untracked: [],
    })
    mockFileChangeParser.mockResolvedValue('mocked file change summary')
    mockExecuteChain.mockResolvedValue({ title: 'mocked git commit title', summary: 'mocked summary message from git commit message' })
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('should call getChanges for current timeframe', async () => {
    await handler(argv, logger)
    expect(mockGetChanges).toHaveBeenCalled()
  })

  it('should call getChangesByTimestamp for yesterday', async () => {
    argv.yesterday = true
    await handler(argv, logger)
    expect(mockGetChangesByTimestamp).toHaveBeenCalled()
  })

  it('should call getChangesByTimestamp for last-week', async () => {
    argv['last-week'] = true
    await handler(argv, logger)
    expect(mockGetChangesByTimestamp).toHaveBeenCalled()
  })

  it('should call getChangesByTimestamp for last-month', async () => {
    argv['last-month'] = true
    await handler(argv, logger)
    expect(mockGetChangesByTimestamp).toHaveBeenCalled()
  })

  it('should call getChangesSinceLastTag for last-tag', async () => {
    argv['last-tag'] = true
    await handler(argv, logger)
    expect(mockGetChangesSinceLastTag).toHaveBeenCalled()
  })

  it('should call getDiffForBranch for currentBranch', async () => {
    argv.currentBranch = true
    await handler(argv, logger)
    expect(mockGetDiffForBranch).toHaveBeenCalledWith(expect.objectContaining({
      baseBranch: 'main',
      headBranch: 'feature/test-branch',
    }))
  })

  it('should pass correct changes to parser for currentBranch', async () => {
    argv.currentBranch = true
    await handler(argv, logger)
    expect(mockFileChangeParser).toHaveBeenCalledWith(expect.objectContaining({
      changes: [
        { filePath: 'branch-file.txt', status: 'added', summary: 'branch file summary' },
      ],
    }))
  })

  it('resolves stdout mode when non-interactive (regression for `?? ` short-circuit)', async () => {
    argv.interactive = false
    await handler(argv, logger)
    expect(mockHandleResult).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'stdout' })
    )
  })

  it('resolves interactive mode when --interactive is passed', async () => {
    argv.interactive = true
    await handler(argv, logger)
    expect(mockHandleResult).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'interactive' })
    )
  })

  it('honors an explicit --timeframe value', async () => {
    argv.timeframe = 'last-week'
    await handler(argv, logger)
    expect(mockGetChangesByTimestamp).toHaveBeenCalled()
  })

  it('emits machine-readable JSON when --json is passed', async () => {
    argv.json = true
    mockGetChanges.mockResolvedValue({
      staged: [{ filePath: 'src/file.ts', status: 'modified', summary: 'changed file' }],
      unstaged: [],
      untracked: [],
    })

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
    expect(parsed).toEqual({
      title: 'mocked git commit title',
      summary: 'mocked summary message from git commit message',
    })
    expect(mockHandleResult).not.toHaveBeenCalled()
  })

  it('emits a JSON error envelope and exits non-zero when the LLM call fails with --json', async () => {
    argv.json = true
    mockExecuteChain.mockRejectedValue(new Error('boom'))

    const writes: string[] = []
    const writeSpy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(((chunk: string) => {
        writes.push(String(chunk))
        return true
      }) as never)

    try {
      await expect(handler(argv, logger)).rejects.toMatchObject({ name: 'CommandExitError', code: 1 })
    } finally {
      writeSpy.mockRestore()
    }

    const jsonCall = writes.find((message) => {
      try {
        JSON.parse(message)
        return true
      } catch {
        return false
      }
    })

    expect(jsonCall).toBeDefined()
    expect(JSON.parse(jsonCall as string)).toEqual({ error: 'boom' })
  })

  it('still prints the fallback markdown but exits non-zero on LLM failure without --json', async () => {
    mockExecuteChain.mockRejectedValue(new Error('boom'))

    await expect(handler(argv, logger)).rejects.toMatchObject({ name: 'CommandExitError', code: 1 })

    expect(mockHandleResult).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.stringContaining('Failed to parse the response'),
      })
    )
  })

  it('trims oversized rendered recap prompts before execution', async () => {
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
        tokenLimit: 700,
        temperature: 0.2,
        maxConcurrent: 1,
      },
      defaultBranch: 'main',
      mode: 'stdout',
      currentBranch: false,
    } as unknown as Config)
    mockFileChangeParser.mockResolvedValue('x'.repeat(2000))

    await handler(argv, logger)

    const variables = mockExecuteChain.mock.calls[0][0].variables as Record<string, string>

    expect(variables.changes.length).toBeLessThan(2000)
    expect(logger.verbose).toHaveBeenCalledWith(
      expect.stringContaining('Rendered prompt exceeded token budget'),
      { color: 'yellow' }
    )
  })
})
