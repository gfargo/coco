import fs from 'fs'
import os from 'os'
import path from 'path'
import { Arguments } from 'yargs'
import { SimpleGit } from 'simple-git'
import { handler } from './handler'
import { ChangelogOptions } from './config'
import { Config } from '../../commands/types'
import { getRepo } from '../../lib/simple-git/getRepo'
import { getCommitLogCurrentBranch } from '../../lib/simple-git/getCommitLogCurrentBranch'
import { getCommitLogRangeDetails } from '../../lib/simple-git/getCommitLogRangeDetails'
import { getCurrentBranchName } from '../../lib/simple-git/getCurrentBranchName'
import { executeChain } from '../../lib/langchain/utils/executeChain'
import { loadConfig } from '../../lib/config/utils/loadConfig'
import { getApiKeyForModel, getModelAndProviderFromConfig } from '../../lib/langchain/utils'
import { getLlm } from '../../lib/langchain/utils/getLlm'
import { getTokenCounterForProvider } from '../../lib/utils/tokenizer'
import { handleResult } from '../../lib/ui/handleResult'
import { Logger } from '../../lib/utils/logger'
import { generateAndReviewLoop } from '../../lib/ui/generateAndReviewLoop'

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
    if (!context.length) {
      await noResult(options)
      return ''
    }
    return await agent(context, options)
  }),
}))

const mockGetRepo = getRepo as jest.MockedFunction<typeof getRepo>
const mockGetCommitLogCurrentBranch = getCommitLogCurrentBranch as jest.MockedFunction<
  typeof getCommitLogCurrentBranch
>
const mockGetCurrentBranchName = getCurrentBranchName as jest.MockedFunction<typeof getCurrentBranchName>
const mockGetCommitLogRangeDetails = getCommitLogRangeDetails as jest.MockedFunction<
  typeof getCommitLogRangeDetails
>
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
const mockGenerateAndReviewLoop = generateAndReviewLoop as jest.MockedFunction<typeof generateAndReviewLoop>

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
    mockGetTokenCounterForProvider.mockResolvedValue((text: string) => text.length)
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

  describe('--write (#1600)', () => {
    let dir: string
    let filePath: string

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coco-changelog-handler-write-'))
      filePath = path.join(dir, 'CHANGELOG.md')
    })

    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true })
    })

    it('writes the generated section into --file', async () => {
      argv.write = true
      argv.file = filePath

      await handler(argv, logger)

      const written = fs.readFileSync(filePath, 'utf8')
      expect(written).toContain('## Mocked changelog title')
      expect(written).toContain('Mocked changelog content')
    })

    it('still writes the file when --json is also passed', async () => {
      argv.write = true
      argv.file = filePath
      argv.json = true

      const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation((() => true) as never)
      try {
        await handler(argv, logger)
      } finally {
        writeSpy.mockRestore()
      }

      const written = fs.readFileSync(filePath, 'utf8')
      expect(written).toContain('## Mocked changelog title')
    })

    it('does not touch the file when --write is not passed', async () => {
      await handler(argv, logger)
      expect(fs.existsSync(filePath)).toBe(false)
    })
  })

  describe('reconciling user edits from the interactive review loop (#1679/OSS-993)', () => {
    let dir: string
    let filePath: string

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coco-changelog-handler-edit-'))
      filePath = path.join(dir, 'CHANGELOG.md')

      // Simulate the review loop's Edit path: it still calls `agent` (so
      // `structured` gets captured from the pre-edit LLM response), but the
      // loop's final return value is the user's edited text rather than the
      // agent's raw output.
      mockGenerateAndReviewLoop.mockImplementationOnce(async ({ factory, parser, agent, options }) => {
        const changes = await factory()
        const context = await parser(changes, '', options)
        await agent(context, options)
        return 'Edited title\n\nEdited body'
      })
    })

    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true })
    })

    it('writes the edited title/content to the file, not the stale pre-edit snapshot', async () => {
      argv.write = true
      argv.file = filePath

      await handler(argv, logger)

      const written = fs.readFileSync(filePath, 'utf8')
      expect(written).toContain('## Edited title')
      expect(written).toContain('Edited body')
      expect(written).not.toContain('Mocked changelog title')
      expect(written).not.toContain('Mocked changelog content')
    })

    it('emits the edited title/content via --json, not the stale pre-edit snapshot', async () => {
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

      const jsonCall = writes.find((message) => {
        try {
          JSON.parse(message)
          return true
        } catch {
          return false
        }
      })

      expect(jsonCall).toBeDefined()
      const parsed = JSON.parse(jsonCall as string)
      expect(parsed.title).toBe('Edited title')
      expect(parsed.content).toContain('Edited body')
    })
  })

  it('emits JSON null (not colored status text) when there are no commits and --json is passed', async () => {
    argv.json = true
    mockGetCommitLogCurrentBranch.mockResolvedValue([])

    const writes: string[] = []
    const writeSpy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(((chunk: string) => {
        writes.push(String(chunk))
        return true
      }) as never)

    try {
      await expect(handler(argv, logger)).rejects.toMatchObject({ name: 'CommandExitError', code: 0 })
    } finally {
      writeSpy.mockRestore()
    }

    expect(writes.map((w) => w.trim())).toContain('null')
  })

  describe('language_context (#1614)', () => {
    it('is empty when no language is configured', async () => {
      await handler(argv, logger)
      const call = mockExecuteChain.mock.calls[0][0] as { variables: Record<string, string> }
      expect(call.variables.language_context).toBe('')
    })

    it('builds an instruction from the configured language', async () => {
      mockLoadConfig.mockReturnValue({
        service: {
          authentication: { type: 'APIKey', credentials: { apiKey: 'mock-api-key' } },
          provider: 'openai',
          model: 'gpt-4o',
          tokenLimit: 4096,
          temperature: 0.2,
          maxConcurrent: 1,
        },
        defaultBranch: 'main',
        mode: 'stdout',
        language: 'German',
      } as unknown as Config)

      await handler(argv, logger)
      const call = mockExecuteChain.mock.calls[0][0] as { variables: Record<string, string> }
      expect(call.variables.language_context).toBe('Write the changelog in German.')
    })

    it('honors a per-invocation --language flag over the configured language', async () => {
      ;(argv as unknown as { language?: string }).language = 'French'
      mockLoadConfig.mockReturnValue({
        service: {
          authentication: { type: 'APIKey', credentials: { apiKey: 'mock-api-key' } },
          provider: 'openai',
          model: 'gpt-4o',
          tokenLimit: 4096,
          temperature: 0.2,
          maxConcurrent: 1,
        },
        defaultBranch: 'main',
        mode: 'stdout',
        language: 'German',
      } as unknown as Config)

      await handler(argv, logger)
      const call = mockExecuteChain.mock.calls[0][0] as { variables: Record<string, string> }
      expect(call.variables.language_context).toBe('Write the changelog in French.')
    })
  })

  describe('--range (#1590)', () => {
    beforeEach(() => {
      mockGetCommitLogRangeDetails.mockResolvedValue([
        {
          hash: 'def5678',
          author_name: 'Test Author',
          message: 'feat: ranged commit',
          body: 'body text',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      ])
    })

    it('accepts git\'s native `<from>..<to>` syntax (no colon) instead of silently falling through to current-branch mode', async () => {
      mockLoadConfig.mockReturnValue({
        service: {
          authentication: { type: 'APIKey', credentials: { apiKey: 'mock-api-key' } },
          provider: 'openai',
          model: 'gpt-4o',
          tokenLimit: 4096,
          temperature: 0.2,
          maxConcurrent: 1,
        },
        defaultBranch: 'main',
        mode: 'stdout',
        range: 'HEAD~5..HEAD',
      } as unknown as Config)

      await handler(argv, logger)

      expect(mockGetCommitLogRangeDetails).toHaveBeenCalledWith(
        'HEAD~5', 'HEAD', expect.objectContaining({ noMerges: true })
      )
      expect(mockGetCommitLogCurrentBranch).not.toHaveBeenCalled()
    })

    it('rejects a range with no recognizable separator instead of silently ignoring it', async () => {
      mockLoadConfig.mockReturnValue({
        service: {
          authentication: { type: 'APIKey', credentials: { apiKey: 'mock-api-key' } },
          provider: 'openai',
          model: 'gpt-4o',
          tokenLimit: 4096,
          temperature: 0.2,
          maxConcurrent: 1,
        },
        defaultBranch: 'main',
        mode: 'stdout',
        range: 'not-a-valid-range',
      } as unknown as Config)

      await expect(handler(argv, logger)).rejects.toMatchObject({ name: 'CommandExitError', code: 1 })
      expect(mockGetCommitLogRangeDetails).not.toHaveBeenCalled()
    })

    it('rejects --range combined with --branch instead of silently ignoring --branch', async () => {
      argv.branch = 'develop'
      mockLoadConfig.mockReturnValue({
        service: {
          authentication: { type: 'APIKey', credentials: { apiKey: 'mock-api-key' } },
          provider: 'openai',
          model: 'gpt-4o',
          tokenLimit: 4096,
          temperature: 0.2,
          maxConcurrent: 1,
        },
        defaultBranch: 'main',
        mode: 'stdout',
        range: 'abc123:def456',
      } as unknown as Config)

      await expect(handler(argv, logger)).rejects.toMatchObject({ name: 'CommandExitError', code: 1 })
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('--range'),
        expect.anything()
      )
    })
  })
})
