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
import { getTokenCounterForProvider } from '../../lib/utils/tokenizer'
import { Logger } from '../../lib/utils/logger'
import { TaskList } from '../../lib/ui/TaskList'
import { getProviderOverview } from '../../git/providerData'
import { getForgeActions } from '../../git/forgeActions'

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
jest.mock('../../git/providerData')
jest.mock('../../git/forgeActions')
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
const mockTaskListStart = jest.fn()
jest.mock('../../lib/ui/TaskList', () => ({
  TaskList: jest.fn().mockImplementation(() => ({
    start: mockTaskListStart,
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
const mockGetTokenCounterForProvider = getTokenCounterForProvider as jest.MockedFunction<
  typeof getTokenCounterForProvider
>
const mockGetProviderOverview = getProviderOverview as jest.MockedFunction<typeof getProviderOverview>
const mockGetForgeActions = getForgeActions as jest.MockedFunction<typeof getForgeActions>
const MockTaskList = TaskList as unknown as jest.Mock

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
      interactive: false,
    } as unknown as Config)
    mockGetApiKeyForModel.mockReturnValue('mock-api-key')
    mockGetModelAndProviderFromConfig.mockReturnValue({
      provider: 'openai',
      model: 'gpt-4o',
    })
    mockGetLlm.mockReturnValue({} as unknown as ReturnType<typeof getLlm>)
    mockGetTokenCounterForProvider.mockResolvedValue((text: string) => text.length)
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
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed[0]).toEqual({
      title: 'Review finding',
      summary: 'A review finding.',
      severity: 5,
      category: 'maintainability',
      filePath: 'src/file.ts',
    })
  })

  it('exits non-zero when a finding meets the --severity threshold (--json)', async () => {
    argv.json = true
    argv.severity = 4 // finding severity is 5 → should gate

    await expect(handler(argv, logger)).rejects.toMatchObject({ code: 1 })
  })

  it('does not gate when findings are below the --severity threshold', async () => {
    argv.json = true
    argv.severity = 8 // finding severity is 5 → below threshold

    await expect(handler(argv, logger)).resolves.toBeUndefined()
  })

  it('treats a NaN severity as no-threshold instead of crashing or silently comparing (#1599 defense-in-depth)', async () => {
    // The builder's .check() rejects NaN before the handler ever runs in
    // production; this locks in the handler's own Number.isFinite guard
    // as a backstop for anything that bypasses the builder (e.g. a direct
    // programmatic call).
    argv.json = true
    argv.severity = NaN

    await expect(handler(argv, logger)).resolves.toBeUndefined()
  })

  describe('empty-input --json paths (#1680)', () => {
    function captureStdoutWrites() {
      const writes: string[] = []
      const writeSpy = jest
        .spyOn(process.stdout, 'write')
        .mockImplementation(((chunk: string) => {
          writes.push(String(chunk))
          return true
        }) as never)
      return { writes, restore: () => writeSpy.mockRestore() }
    }

    it('emits an empty JSON array on a clean tree instead of a human sentence', async () => {
      argv.json = true
      mockGetChanges.mockResolvedValue({ staged: [], unstaged: [], untracked: [] })

      const { writes, restore } = captureStdoutWrites()
      try {
        await expect(handler(argv, logger)).rejects.toMatchObject({ code: 0 })
      } finally {
        restore()
      }

      expect(writes).toEqual(['[]\n'])
      expect(logger.setConfig).toHaveBeenCalledWith({ quiet: true })
    })

    it('emits an empty JSON array with --staged when nothing is staged', async () => {
      argv.json = true
      argv.staged = true
      mockGetChanges.mockResolvedValue({
        staged: [],
        unstaged: [{ filePath: 'src/file.ts', status: 'modified', summary: 'changed file' }],
        untracked: [],
      })

      const { writes, restore } = captureStdoutWrites()
      try {
        await expect(handler(argv, logger)).rejects.toMatchObject({ code: 0 })
      } finally {
        restore()
      }

      expect(writes).toEqual(['[]\n'])
    })

    it('emits an empty JSON array when the review loop reports noResult', async () => {
      argv.json = true

      const { generateAndReviewLoop } = jest.requireMock('../../lib/ui/generateAndReviewLoop') as {
        generateAndReviewLoop: jest.Mock
      }
      generateAndReviewLoop.mockImplementationOnce(async ({ noResult, options }) => {
        await noResult(options)
        return []
      })

      const { writes, restore } = captureStdoutWrites()
      try {
        await expect(handler(argv, logger)).rejects.toMatchObject({ code: 0 })
      } finally {
        restore()
      }

      expect(writes).toEqual(['[]\n'])
    })
  })

  it('reviews only staged changes with --staged', async () => {
    argv.staged = true
    argv.json = true

    await handler(argv, logger)

    // staged-only path summarizes the staged diff and never touches branch diff
    expect(mockGetDiffForBranch).not.toHaveBeenCalled()
    expect(mockFileChangeParser).toHaveBeenCalledWith(
      expect.objectContaining({ commit: '--staged' })
    )
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

  describe('language_context (#1614)', () => {
    it('is empty when no language is configured', async () => {
      argv.json = true
      await handler(argv, logger)
      const variables = mockExecuteChain.mock.calls[0][0].variables as Record<string, string>
      expect(variables.language_context).toBe('')
    })

    it('builds an instruction from the configured language', async () => {
      argv.json = true
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
        interactive: false,
        language: 'German',
      } as unknown as Config)

      await handler(argv, logger)
      const variables = mockExecuteChain.mock.calls[0][0].variables as Record<string, string>
      expect(variables.language_context).toBe('Write the code review feedback in German.')
    })

    it('honors a per-invocation --language flag over the configured language', async () => {
      argv.json = true
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
        interactive: false,
        language: 'German',
      } as unknown as Config)

      await handler(argv, logger)
      const variables = mockExecuteChain.mock.calls[0][0].variables as Record<string, string>
      expect(variables.language_context).toBe('Write the code review feedback in French.')
    })
  })

  describe('non-interactive TTY handling (no --json)', () => {
    let originalStdinIsTTY: PropertyDescriptor | undefined
    let originalStdoutIsTTY: PropertyDescriptor | undefined

    beforeEach(() => {
      originalStdinIsTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
      originalStdoutIsTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
    })

    afterEach(() => {
      if (originalStdinIsTTY) {
        Object.defineProperty(process.stdin, 'isTTY', originalStdinIsTTY)
      } else {
        delete (process.stdin as { isTTY?: boolean }).isTTY
      }
      if (originalStdoutIsTTY) {
        Object.defineProperty(process.stdout, 'isTTY', originalStdoutIsTTY)
      } else {
        delete (process.stdout as { isTTY?: boolean }).isTTY
      }
    })

    it('prints findings as text and skips TaskList when not a TTY', async () => {
      Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true })
      Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true })

      await handler(argv, logger)

      expect(MockTaskList).not.toHaveBeenCalled()
      const logCalls = (logger.log as jest.Mock).mock.calls.flat()
      expect(logCalls.some((arg) => typeof arg === 'string' && arg.includes('Review finding'))).toBe(true)
      expect(
        logCalls.some(
          (arg) => typeof arg === 'string' && arg.includes('re-run with --json for machine-readable output')
        )
      ).toBe(true)
    })

    it('still shows the interactive TaskList when both stdin and stdout are a TTY', async () => {
      Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })

      await handler(argv, logger)

      expect(MockTaskList).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ title: 'Review finding' })]),
        expect.anything()
      )
      expect(mockTaskListStart).toHaveBeenCalledTimes(1)
    })
  })

  describe('--pr / --comment (#1596)', () => {
    const mockGetPullRequestDiffByNumber = jest.fn()
    const mockCommentPullRequestByNumber = jest.fn()
    const mockRequestChangesPullRequestByNumber = jest.fn()

    beforeEach(() => {
      argv.json = true

      mockGetProviderOverview.mockResolvedValue({
        repository: { provider: 'github', remote: 'origin', owner: 'acme', name: 'widgets' },
        authenticated: true,
      } as unknown as Awaited<ReturnType<typeof getProviderOverview>>)

      mockGetForgeActions.mockReturnValue({
        getPullRequestDiffByNumber: mockGetPullRequestDiffByNumber,
        commentPullRequestByNumber: mockCommentPullRequestByNumber,
        requestChangesPullRequestByNumber: mockRequestChangesPullRequestByNumber,
      } as unknown as ReturnType<typeof getForgeActions>)

      mockGetPullRequestDiffByNumber.mockResolvedValue({
        ok: true,
        lines: ['diff --git a/file.ts b/file.ts', '+added line'],
      })
      mockCommentPullRequestByNumber.mockResolvedValue({ ok: true, message: 'Comment posted.' })
      mockRequestChangesPullRequestByNumber.mockResolvedValue({ ok: true, message: 'Changes requested.' })
    })

    it('sources the review context from the PR diff instead of local changes', async () => {
      argv.pr = 42

      await handler(argv, logger)

      expect(mockGetForgeActions).toHaveBeenCalledWith('github', expect.objectContaining({ gitlabPath: 'acme/widgets' }))
      expect(mockGetPullRequestDiffByNumber).toHaveBeenCalledWith(42)
      expect(mockGetChanges).not.toHaveBeenCalled()
      expect(mockGetDiffForBranch).not.toHaveBeenCalled()

      const variables = mockExecuteChain.mock.calls[0][0].variables as Record<string, string>
      expect(variables.changes).toContain('+added line')
    })

    it('exits with the diff-fetch error when the PR diff cannot be retrieved', async () => {
      argv.pr = 42
      mockGetPullRequestDiffByNumber.mockResolvedValue({ ok: false, message: 'PR #42 not found.' })

      await expect(handler(argv, logger)).rejects.toMatchObject({ code: 1 })
      expect(logger.error).toHaveBeenCalledWith('PR #42 not found.', { color: 'red' })
    })

    it('posts a plain comment when findings stay below --severity', async () => {
      argv.pr = 42
      argv.comment = true
      argv.severity = 8 // finding severity is 5 → below threshold

      await handler(argv, logger)

      expect(mockCommentPullRequestByNumber).toHaveBeenCalledWith(42, expect.stringContaining('Review finding'))
      expect(mockRequestChangesPullRequestByNumber).not.toHaveBeenCalled()
    })

    it('requests changes instead of commenting when findings meet --severity', async () => {
      argv.pr = 42
      argv.comment = true
      argv.severity = 4 // finding severity is 5 → meets threshold

      await expect(handler(argv, logger)).rejects.toMatchObject({ code: 1 })

      expect(mockRequestChangesPullRequestByNumber).toHaveBeenCalledWith(42, expect.stringContaining('Review finding'))
      expect(mockCommentPullRequestByNumber).not.toHaveBeenCalled()
    })
  })
})
