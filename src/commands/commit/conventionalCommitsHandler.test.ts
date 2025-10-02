import { handler } from './handler'
import { Arguments } from 'yargs'
import { CommitOptions } from './config'
import { Logger } from '../../lib/utils/logger'

// Mock all dependencies
jest.mock('../../lib/simple-git/getRepo')
jest.mock('../../lib/simple-git/getChanges')
jest.mock('../../lib/config/utils/loadConfig')
jest.mock('../../lib/langchain/utils')
jest.mock('../../lib/ui/generateAndReviewLoop')
jest.mock('../../lib/ui/handleResult')
jest.mock('../../lib/utils/hasCommitlintConfig')
jest.mock('../../lib/utils/commitlintValidator')

import { loadConfig } from '../../lib/config/utils/loadConfig'
import { getApiKeyForModel, getModelAndProviderFromConfig } from '../../lib/langchain/utils'
import { generateAndReviewLoop } from '../../lib/ui/generateAndReviewLoop'
import { hasCommitlintConfig } from '../../lib/utils/hasCommitlintConfig'
import { getCommitlintRulesContext, checkCommitlintAvailability } from '../../lib/utils/commitlintValidator'

const mockLoadConfig = loadConfig as jest.MockedFunction<typeof loadConfig>
const mockGetApiKeyForModel = getApiKeyForModel as jest.MockedFunction<typeof getApiKeyForModel>
const mockGetModelAndProviderFromConfig = getModelAndProviderFromConfig as jest.MockedFunction<typeof getModelAndProviderFromConfig>
const mockGenerateAndReviewLoop = generateAndReviewLoop as jest.MockedFunction<typeof generateAndReviewLoop>
const mockHasCommitlintConfig = hasCommitlintConfig as jest.MockedFunction<typeof hasCommitlintConfig>
const mockGetCommitlintRulesContext = getCommitlintRulesContext as jest.MockedFunction<typeof getCommitlintRulesContext>
const mockCheckCommitlintAvailability = checkCommitlintAvailability as jest.MockedFunction<typeof checkCommitlintAvailability>

describe('Conventional Commits Handler', () => {
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
      verbose: false,
      version: false,
      help: false,
    }

    logger = {
      log: jest.fn(),
      verbose: jest.fn(),
      setConfig: jest.fn(),
    } as unknown as Logger

    // Default mocks
    mockLoadConfig.mockReturnValue({
      service: {
        authentication: { type: 'apiKey' },
        provider: 'openai',
        model: 'gpt-4o',
      },
      conventionalCommits: false,
    } as any)

    mockGetApiKeyForModel.mockReturnValue('mock-api-key')
    mockGetModelAndProviderFromConfig.mockReturnValue({
      provider: 'openai',
      model: 'gpt-4o',
    })

    mockGenerateAndReviewLoop.mockResolvedValue('mock commit message')
    mockHasCommitlintConfig.mockResolvedValue(false)
    mockGetCommitlintRulesContext.mockResolvedValue('')
    mockCheckCommitlintAvailability.mockReturnValue({
      available: true,
      missingPackages: [],
    })
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('Conventional Commits Mode Detection', () => {
    it('should call generateAndReviewLoop when conventional flag is set', async () => {
      argv.conventional = true

      await handler(argv, logger)

      expect(mockGenerateAndReviewLoop).toHaveBeenCalledWith(
        expect.objectContaining({
          agent: expect.any(Function),
        })
      )
    })

    it('should call generateAndReviewLoop when conventional commits enabled in config', async () => {
      mockLoadConfig.mockReturnValue({
        service: {
          authentication: { type: 'apiKey' },
          provider: 'openai',
          model: 'gpt-4o',
        },
        conventionalCommits: true,
      } as any)

      await handler(argv, logger)

      expect(mockGenerateAndReviewLoop).toHaveBeenCalled()
    })

    it('should call generateAndReviewLoop in regular mode', async () => {
      await handler(argv, logger)

      expect(mockGenerateAndReviewLoop).toHaveBeenCalled()
    })
  })

  describe('Basic Handler Functionality', () => {
    it('should handle conventional commits flag', async () => {
      argv.conventional = true

      await handler(argv, logger)

      expect(mockGenerateAndReviewLoop).toHaveBeenCalled()
    })

    it('should handle additional context', async () => {
      argv.additional = 'This resolves issue #123'

      await handler(argv, logger)

      expect(mockGenerateAndReviewLoop).toHaveBeenCalled()
    })

    it('should handle commit history requests', async () => {
      argv.withPreviousCommits = 3

      await handler(argv, logger)

      expect(mockGenerateAndReviewLoop).toHaveBeenCalled()
    })
  })

  describe('Configuration Options', () => {
    it('should handle branch name inclusion', async () => {
      argv.includeBranchName = true

      await handler(argv, logger)

      expect(mockGenerateAndReviewLoop).toHaveBeenCalled()
    })

    it('should handle branch name exclusion', async () => {
      argv.includeBranchName = false

      await handler(argv, logger)

      expect(mockGenerateAndReviewLoop).toHaveBeenCalled()
    })
  })

  describe('Error Handling', () => {
    it('should exit when API key is missing', async () => {
      mockGetApiKeyForModel.mockReturnValue('')
      const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called')
      })

      await expect(handler(argv, logger)).rejects.toThrow('process.exit called')
      expect(logger.log).toHaveBeenCalledWith('No API Key found. 🗝️🚪', { color: 'red' })
      
      mockExit.mockRestore()
    })

    it('should warn about Ollama model limitations', async () => {
      mockLoadConfig.mockReturnValue({
        service: {
          authentication: { type: 'apiKey' },
          provider: 'ollama',
          model: 'llama2',
        },
        conventionalCommits: true,
      } as unknown)

      mockGetModelAndProviderFromConfig.mockReturnValue({
        provider: 'ollama',
        model: 'llama2',
      })

      await handler(argv, logger)

      expect(logger.verbose).toHaveBeenCalledWith(
        '⚠️  Ollama models may not strictly adhere to the output format instructions.',
        { color: 'yellow' }
      )
    })
  })
})