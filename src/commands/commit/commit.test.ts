import { Arguments } from 'yargs'
import { handler } from './handler'
import { CommitOptions } from './config'
import { getRepo } from '../../lib/simple-git/getRepo'
import { getChanges } from '../../lib/simple-git/getChanges'
import { logSuccess } from '../../lib/ui/logSuccess'
import { fileChangeParser } from '../../lib/parsers/default'
import { generateAndReviewLoop } from '../../lib/ui/generateAndReviewLoop'
import { handleResult } from '../../lib/ui/handleResult'
import { loadConfig } from '../../lib/config/utils/loadConfig'
import { getApiKeyForModel, getModelAndProviderFromConfig } from '../../lib/langchain/utils'
import { getLlm } from '../../lib/langchain/utils/getLlm'
import { getTokenCounter } from '../../lib/utils/tokenizer'
import { COMMIT_PROMPT, CONVENTIONAL_COMMIT_PROMPT } from './prompt'
import { executeChainWithSchema } from '../../lib/langchain/utils/executeChainWithSchema'
import { getPrompt } from '../../lib/langchain/utils/getPrompt'
import { getCurrentBranchName } from '../../lib/simple-git/getCurrentBranchName'
import { getPreviousCommits } from '../../lib/simple-git/getPreviousCommits'
import { Logger } from '../../lib/utils/logger'
import { SimpleGit } from 'simple-git'
import { Config } from '../../commands/types'
import { deriveStatus } from '../../test/builders/makeFakeGit'
import { createCommit, PreCommitHookError } from '../../lib/simple-git/createCommit'
import { logLlmTelemetrySummary } from '../../lib/langchain/utils/observability'
import { selectPrompt } from '../../lib/ui/inquirerPrompts'

jest.mock('../../lib/utils/commitlintValidator', () => ({
  hasCommitlintConfig: jest.fn().mockResolvedValue(false),
  validateCommitMessage: jest.fn().mockResolvedValue({
    valid: true,
    errors: [],
    warnings: [],
  }),
  getCommitlintRulesContext: jest.fn().mockResolvedValue(''),
}))

jest.mock('../../lib/simple-git/getRepo')
jest.mock('../../lib/simple-git/getChanges')
jest.mock('../../lib/ui/logSuccess')
jest.mock('../../lib/parsers/default')
jest.mock('../../lib/ui/generateAndReviewLoop')
jest.mock('../../lib/ui/handleResult')
jest.mock('../../lib/config/utils/loadConfig')
jest.mock('../../lib/langchain/utils')
jest.mock('../../lib/langchain/utils/getLlm')
jest.mock('../../lib/utils/tokenizer')
jest.mock('./prompt')
jest.mock('../../lib/langchain/utils/executeChainWithSchema')
jest.mock('../../lib/langchain/utils/getPrompt')
jest.mock('../../lib/simple-git/getCurrentBranchName')
jest.mock('../../lib/simple-git/getPreviousCommits')
jest.mock('../../lib/simple-git/createCommit', () => {
  const actual = jest.requireActual('../../lib/simple-git/createCommit')
  return {
    ...actual,
    createCommit: jest.fn(),
  }
})
jest.mock('../../lib/langchain/utils/observability')
jest.mock('../../lib/ui/inquirerPrompts')

const mockGetRepo = getRepo as jest.MockedFunction<typeof getRepo>
const mockGetChanges = getChanges as jest.MockedFunction<typeof getChanges>
const mockLogSuccess = logSuccess as jest.MockedFunction<typeof logSuccess>
const mockFileChangeParser = fileChangeParser as jest.MockedFunction<typeof fileChangeParser>
const mockGenerateAndReviewLoop = generateAndReviewLoop as jest.MockedFunction<
  typeof generateAndReviewLoop
>
const mockHandleResult = handleResult as jest.MockedFunction<typeof handleResult>
const mockLoadConfig = loadConfig as jest.MockedFunction<typeof loadConfig>
const mockGetApiKeyForModel = getApiKeyForModel as jest.MockedFunction<typeof getApiKeyForModel>
const mockGetModelAndProviderFromConfig = getModelAndProviderFromConfig as jest.MockedFunction<
  typeof getModelAndProviderFromConfig
>
const mockGetTokenCounter = getTokenCounter as jest.MockedFunction<typeof getTokenCounter>
const mockGetLlm = getLlm as jest.MockedFunction<typeof getLlm>

// Mock prompts
const mockCommitPrompt = COMMIT_PROMPT as jest.Mocked<typeof COMMIT_PROMPT>
const mockConventionalCommitPrompt = CONVENTIONAL_COMMIT_PROMPT as jest.Mocked<
  typeof CONVENTIONAL_COMMIT_PROMPT
>

// Mock additional functions
const mockExecuteChainWithSchema = executeChainWithSchema as jest.MockedFunction<
  typeof executeChainWithSchema
>
const mockGetPrompt = getPrompt as jest.MockedFunction<typeof getPrompt>
const mockGetCurrentBranchName = getCurrentBranchName as jest.MockedFunction<
  typeof getCurrentBranchName
>
const mockGetPreviousCommits = getPreviousCommits as jest.MockedFunction<typeof getPreviousCommits>
const mockCreateCommit = createCommit as jest.MockedFunction<typeof createCommit>
const mockLogLlmTelemetrySummary = logLlmTelemetrySummary as jest.MockedFunction<
  typeof logLlmTelemetrySummary
>
const mockSelectPrompt = selectPrompt as jest.MockedFunction<typeof selectPrompt>

describe('commit command', () => {
  let argv: Arguments<CommitOptions>
  let logger: Logger

  beforeEach(() => {
    argv = {
      $0: 'coco',
      _: ['commit'],
      interactive: false,
      openInEditor: false,
      ignoredFiles: [],
      ignoredExtensions: [],
      withPreviousCommits: 0,
      conventional: false,
      includeBranchName: true,
      noDiff: false,
      noVerify: false,
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

    mockGetRepo.mockReturnValue({
      status: jest.fn().mockResolvedValue(
        deriveStatus([
          { path: 'file1.txt', index: 'A', working_dir: ' ' },
          { path: 'file2.txt', index: 'M', working_dir: 'M' },
          { path: 'file3.txt', index: '?', working_dir: '?' },
        ])
      ),
      revparse: jest.fn().mockResolvedValue('mock-branch-name'),
      commit: jest.fn().mockResolvedValue(undefined),
    } as unknown as SimpleGit)

    mockGetChanges.mockResolvedValue({
      staged: [
        { filePath: 'file1.txt', status: 'added', summary: 'file1.txt summary' },
        { filePath: 'file2.txt', status: 'modified', summary: 'file2.txt summary' },
      ],
      unstaged: [],
      untracked: [],
    })

    mockFileChangeParser.mockResolvedValue('mocked summary')
    mockGenerateAndReviewLoop.mockImplementation(async ({ factory, parser, agent, options }) => {
      // Call the factory function to simulate generateAndReviewLoop behavior
      const changes = await factory()
      // Call the parser function with proper parameters
      const result = await agent('test context', options)
      await parser(changes, result, options)
      return 'mocked commit message'
    })
    mockLogSuccess.mockImplementation(() => {})
    mockHandleResult.mockResolvedValue(undefined)

    // Mock config and LLM dependencies
    mockLoadConfig.mockReturnValue({
      service: {
        authentication: { type: 'apiKey' },
        provider: 'openai',
        model: 'gpt-4o',
      },
      hideCocoBanner: false,
      noDiff: false,
      ignoredFiles: [],
      ignoredExtensions: [],
      includeBranchName: true,
      conventionalCommits: false,
      openInEditor: false,
      mode: 'stdout',
    } as unknown as Config)

    mockGetApiKeyForModel.mockReturnValue('mock-api-key')
    mockGetModelAndProviderFromConfig.mockReturnValue({
      provider: 'openai',
      model: 'gpt-4o',
    })
    mockGetTokenCounter.mockResolvedValue(jest.fn())
    mockGetLlm.mockReturnValue({} as unknown as ReturnType<typeof getLlm>)

    // Mock prompts
    mockCommitPrompt.template = 'Test commit prompt template'
    mockCommitPrompt.inputVariables = [
      'summary',
      'format_instructions',
      'additional_context',
      'commit_history',
      'branch_name_context',
    ]
    mockConventionalCommitPrompt.template = 'Test conventional commit prompt template'
    mockConventionalCommitPrompt.inputVariables = [
      'summary',
      'format_instructions',
      'additional_context',
      'commit_history',
      'branch_name_context',
    ]

    // Mock additional functions
    mockExecuteChainWithSchema.mockResolvedValue({
      title: 'Test commit title',
      body: 'Test commit body',
    })
    mockGetPrompt.mockReturnValue({
      template: 'Test prompt template',
      inputVariables: ['summary'],
    } as unknown as ReturnType<typeof getPrompt>)
    mockGetCurrentBranchName.mockResolvedValue('main')
    mockGetPreviousCommits.mockResolvedValue('Previous commits mock')
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('should call getChanges when noDiff is false', async () => {
    await handler(argv, logger)
    expect(mockGetChanges).toHaveBeenCalled()
  })

  it('should not call getChanges when noDiff is true', async () => {
    argv.noDiff = true
    // Update the config mock to have noDiff: true
    mockLoadConfig.mockReturnValue({
      service: {
        authentication: { type: 'apiKey' },
        provider: 'openai',
        model: 'gpt-4o',
      },
      hideCocoBanner: false,
      noDiff: true,
      ignoredFiles: [],
      ignoredExtensions: [],
      includeBranchName: true,
      conventionalCommits: false,
      openInEditor: false,
      mode: 'stdout',
    } as unknown as Config)

    await handler(argv, logger)
    expect(mockGetChanges).not.toHaveBeenCalled()
  })

  it('should NOT call fileChangeParser when noDiff is true', async () => {
    argv.noDiff = true
    // Update the config mock to have noDiff: true
    mockLoadConfig.mockReturnValue({
      service: {
        authentication: { type: 'apiKey' },
        provider: 'openai',
        model: 'gpt-4o',
      },
      hideCocoBanner: false,
      noDiff: true,
      ignoredFiles: [],
      ignoredExtensions: [],
      includeBranchName: true,
      conventionalCommits: false,
      openInEditor: false,
      mode: 'stdout',
    } as unknown as Config)

    await handler(argv, logger)
    // When noDiff is true, fileChangeParser should NOT be called
    // because we bypass diff parsing and just use file status
    expect(mockFileChangeParser).not.toHaveBeenCalled()
  })

  describe('interactive commit flow (awaited handleResult)', () => {
    beforeEach(() => {
      argv.interactive = true
      mockHandleResult.mockImplementation(async ({ mode, result, interactiveModeCallback }) => {
        if (mode === 'interactive' && interactiveModeCallback) {
          await interactiveModeCallback(result)
        }
      })
    })

    it('propagates a CommandExitError when the user chooses to abort a hook failure', async () => {
      mockCreateCommit.mockRejectedValue(new PreCommitHookError('lint failed'))
      mockSelectPrompt.mockResolvedValue('abort')

      await expect(handler(argv, logger)).rejects.toMatchObject({
        name: 'CommandExitError',
        code: 1,
      })
    })

    it('propagates non-hook createCommit failures instead of orphaning them', async () => {
      mockCreateCommit.mockRejectedValue(new Error('GPG signing failed'))

      await expect(handler(argv, logger)).rejects.toThrow('GPG signing failed')
      expect(mockSelectPrompt).not.toHaveBeenCalled()
    })

    it('logs telemetry only after the interactive commit flow completes', async () => {
      mockCreateCommit.mockRejectedValue(new PreCommitHookError('lint failed'))
      mockSelectPrompt.mockResolvedValue('abort')

      await expect(handler(argv, logger)).rejects.toMatchObject({ name: 'CommandExitError' })

      expect(mockSelectPrompt).toHaveBeenCalled()
      expect(mockLogLlmTelemetrySummary).not.toHaveBeenCalled()
    })

    it('resolves and logs success + telemetry on the happy path', async () => {
      mockCreateCommit.mockResolvedValue({} as Awaited<ReturnType<typeof createCommit>>)

      await handler(argv, logger)

      expect(mockCreateCommit).toHaveBeenCalled()
      expect(mockLogSuccess).toHaveBeenCalled()
      expect(mockLogLlmTelemetrySummary).toHaveBeenCalledWith(logger, 'commit')

      const successOrder = mockLogSuccess.mock.invocationCallOrder[0]
      const telemetryOrder = mockLogLlmTelemetrySummary.mock.invocationCallOrder[0]
      expect(successOrder).toBeLessThan(telemetryOrder)
    })
  })
})
