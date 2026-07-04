import { handler } from './handler'
import { questions } from './questions'
import { InitOptions } from './config'
import { Config } from '../types'
import { appendToEnvFile } from '../../lib/config/services/env'
import { appendToGitConfig } from '../../lib/config/services/git'
import { appendToProjectJsonConfig } from '../../lib/config/services/project'
import { loadConfig } from '../../lib/config/utils/loadConfig'
import { checkAndHandlePackageInstallation } from '../../lib/ui/checkAndHandlePackageInstall'
import { logResult } from '../../lib/ui/logResult'
import { getDefaultServiceConfigFromAlias } from '../../lib/langchain/utils'
import { getPathToUsersGitConfig } from '../../lib/utils/getPathToUsersGitConfig'
import { getProjectConfigFilePath } from '../../lib/utils/getProjectConfigFilePath'
import { installNpmPackage } from '../../lib/utils/installPackage'
import { Logger } from '../../lib/utils/logger'
import { confirmPrompt } from '../../lib/ui/inquirerPrompts'
import { OllamaNotReadyError } from '../../lib/langchain/utils/ollamaStatus'

jest.mock('../../lib/ui/inquirerPrompts', () => ({
  confirmPrompt: jest.fn(),
}))
jest.mock('../../lib/config/services/env')
jest.mock('../../lib/config/services/git')
jest.mock('../../lib/config/services/project')
jest.mock('../../lib/config/utils/loadConfig')
jest.mock('../../lib/ui/checkAndHandlePackageInstall')
jest.mock('../../lib/ui/logResult')
jest.mock('../../lib/langchain/utils')
jest.mock('../../lib/utils/getPathToUsersGitConfig')
jest.mock('../../lib/utils/getProjectConfigFilePath')
jest.mock('../../lib/utils/installPackage')

const mockConfirm = confirmPrompt as jest.MockedFunction<typeof confirmPrompt>
const mockAppendToEnvFile = appendToEnvFile as jest.MockedFunction<typeof appendToEnvFile>
const mockAppendToGitConfig = appendToGitConfig as jest.MockedFunction<typeof appendToGitConfig>
const mockAppendToProjectJsonConfig = appendToProjectJsonConfig as jest.MockedFunction<
  typeof appendToProjectJsonConfig
>
const mockLoadConfig = loadConfig as jest.MockedFunction<typeof loadConfig>
const mockCheckAndHandlePackageInstallation = checkAndHandlePackageInstallation as jest.MockedFunction<
  typeof checkAndHandlePackageInstallation
>
const mockLogResult = logResult as jest.MockedFunction<typeof logResult>
const mockGetDefaultServiceConfigFromAlias = getDefaultServiceConfigFromAlias as jest.MockedFunction<
  typeof getDefaultServiceConfigFromAlias
>
const mockGetPathToUsersGitConfig = getPathToUsersGitConfig as jest.MockedFunction<
  typeof getPathToUsersGitConfig
>
const mockGetProjectConfigFilePath = getProjectConfigFilePath as jest.MockedFunction<
  typeof getProjectConfigFilePath
>
const mockInstallNpmPackage = installNpmPackage as jest.MockedFunction<typeof installNpmPackage>

function createLogger(): Logger {
  return {
    log: jest.fn(),
    verbose: jest.fn(),
    setConfig: jest.fn(),
    error: jest.fn(),
    startTimer: jest.fn().mockReturnThis(),
    stopTimer: jest.fn().mockReturnThis(),
    startSpinner: jest.fn().mockReturnThis(),
    stopSpinner: jest.fn().mockReturnThis(),
  } as unknown as Logger
}

function createArgv(overrides: Partial<InitOptions> = {}) {
  return {
    $0: 'coco',
    _: ['init'],
    interactive: false,
    verbose: false,
    version: false,
    help: false,
    ...overrides,
  }
}

function mockApiKeyService(provider: 'openai' | 'anthropic' = 'openai') {
  mockGetDefaultServiceConfigFromAlias.mockReturnValue({
    provider,
    model: provider === 'openai' ? 'gpt-4o' : 'claude-3-5-sonnet-latest',
    authentication: {
      type: 'APIKey',
      credentials: {
        apiKey: '',
      },
    },
  } as never)
}

function mockOllamaService() {
  mockGetDefaultServiceConfigFromAlias.mockReturnValue({
    provider: 'ollama',
    model: 'llama3',
    endpoint: 'http://localhost:11434',
    authentication: {
      type: 'None',
    },
  } as never)
}

describe('init command', () => {
  let logger: Logger

  beforeEach(() => {
    logger = createLogger()
    mockLoadConfig.mockReturnValue({
      scope: 'project',
      dryRun: false,
    } as unknown as Config)
    mockConfirm.mockResolvedValue(true)
    mockCheckAndHandlePackageInstallation.mockResolvedValue(undefined)
    mockAppendToGitConfig.mockResolvedValue(undefined)
    mockAppendToEnvFile.mockResolvedValue(undefined)
    mockInstallNpmPackage.mockResolvedValue(true)
    mockGetPathToUsersGitConfig.mockReturnValue('/home/coco/.gitconfig')
    mockGetProjectConfigFilePath.mockResolvedValue('/repo/.coco.config.json')
    mockApiKeyService('openai')

    jest.spyOn(questions, 'whatScope').mockResolvedValue('project')
    jest.spyOn(questions, 'setupCommitlint').mockResolvedValue(false)
    jest.spyOn(questions, 'selectLLMProvider').mockResolvedValue('openai')
    jest.spyOn(questions, 'selectLLMModel').mockResolvedValue('gpt-4o')
    jest.spyOn(questions, 'inputApiKey').mockResolvedValue('secret-api-key')
    jest.spyOn(questions, 'configureAdvancedOptions').mockResolvedValue(false)
    jest.spyOn(questions, 'selectProjectConfigFileType').mockResolvedValue('.coco.config.json')
  })

  afterEach(() => {
    jest.restoreAllMocks()
    jest.clearAllMocks()
  })

  it('supports a non-interactive dry run without prompts or writes', async () => {
    mockLoadConfig.mockReturnValue({
      scope: 'project',
      dryRun: true,
    } as unknown as Config)

    await handler(createArgv({ dryRun: true }), logger)

    expect(questions.selectLLMProvider).not.toHaveBeenCalled()
    expect(mockAppendToProjectJsonConfig).not.toHaveBeenCalled()
    expect(mockCheckAndHandlePackageInstallation).not.toHaveBeenCalled()
    expect(logger.log).toHaveBeenCalledWith('\ninit dry run successful for project scope', {
      color: 'green',
    })
  })

  it('writes project json config when scope is provided', async () => {
    await handler(createArgv({ scope: 'project' }), logger)

    expect(questions.whatScope).not.toHaveBeenCalled()
    expect(mockAppendToProjectJsonConfig).toHaveBeenCalledWith(
      '/repo/.coco.config.json',
      expect.objectContaining({
        service: expect.objectContaining({
          provider: 'openai',
          authentication: expect.objectContaining({
            credentials: expect.objectContaining({
              apiKey: 'secret-api-key',
            }),
          }),
        }),
      })
    )
    expect(mockCheckAndHandlePackageInstallation).toHaveBeenCalledWith({
      global: false,
      logger,
    })
  })

  it('writes project json config for the recommended .coco.json format', async () => {
    // Regression: `.coco.json` (the recommended option) previously matched no
    // write branch, so init reported success but persisted nothing.
    jest.spyOn(questions, 'selectProjectConfigFileType').mockResolvedValue('.coco.json')
    mockGetProjectConfigFilePath.mockResolvedValue('/repo/.coco.json')

    await handler(createArgv({ scope: 'project' }), logger)

    expect(mockAppendToProjectJsonConfig).toHaveBeenCalledWith(
      '/repo/.coco.json',
      expect.any(Object),
    )
    expect(logger.log).toHaveBeenCalledWith('\ninit successful! 🦾🤖🎉', {
      color: 'green',
    })
  })

  it('writes env config when selected for a project config', async () => {
    jest.spyOn(questions, 'selectProjectConfigFileType').mockResolvedValue('.env')
    mockGetProjectConfigFilePath.mockResolvedValue('/repo/.env')

    await handler(createArgv({ scope: 'project' }), logger)

    expect(mockAppendToEnvFile).toHaveBeenCalledWith('/repo/.env', expect.any(Object))
  })

  it('writes global git config and installs commitlint packages when requested', async () => {
    mockLoadConfig.mockReturnValue({
      scope: 'global',
      dryRun: false,
    } as unknown as Config)
    jest.spyOn(questions, 'setupCommitlint').mockResolvedValue(true)
    jest.spyOn(questions, 'selectLLMProvider').mockResolvedValue('ollama')
    jest.spyOn(questions, 'selectLLMModel').mockResolvedValue('llama3')
    mockOllamaService()

    await handler(createArgv({ scope: 'global' }), logger)

    expect(mockAppendToGitConfig).toHaveBeenCalledWith('/home/coco/.gitconfig', expect.any(Object))
    expect(mockCheckAndHandlePackageInstallation).toHaveBeenCalledWith({
      global: true,
      logger,
    })
    expect(mockInstallNpmPackage).toHaveBeenCalledWith({
      name: '@commitlint/config-conventional',
      flags: ['-g'],
    })
    expect(mockInstallNpmPackage).toHaveBeenCalledWith({
      name: '@commitlint/cli',
      flags: ['-g'],
    })
  })

  it('does not write config when approval is declined', async () => {
    mockConfirm.mockResolvedValue(false)

    await handler(createArgv({ scope: 'project' }), logger)

    expect(mockAppendToProjectJsonConfig).not.toHaveBeenCalled()
    expect(mockCheckAndHandlePackageInstallation).not.toHaveBeenCalled()
    // File-type question must not be asked when the user cancelled
    expect(questions.selectProjectConfigFileType).not.toHaveBeenCalled()
    expect(logger.log).toHaveBeenCalledWith('\ninit cancelled.', { color: 'yellow' })
  })

  it('logs invalid advanced service fields and continues', async () => {
    jest.spyOn(questions, 'configureAdvancedOptions').mockResolvedValue(true)
    jest.spyOn(questions, 'selectMode').mockResolvedValue('stdout')
    jest.spyOn(questions, 'selectDefaultGitBranch').mockResolvedValue('main')
    jest.spyOn(questions, 'inputModelTemperature').mockResolvedValue(0.2)
    jest.spyOn(questions, 'inputTokenLimit').mockResolvedValue(4096)
    jest.spyOn(questions, 'inputRequestTimeout').mockResolvedValue(30000)
    jest.spyOn(questions, 'inputRequestMaxRetries').mockResolvedValue(2)
    jest.spyOn(questions, 'inputServiceFields').mockResolvedValue('{bad json')
    mockConfirm
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)

    await handler(createArgv({ scope: 'project' }), logger)

    expect(logger.error).toHaveBeenCalledWith('Invalid JSON for service fields. Skipping.', {
      color: 'red',
    })
    expect(mockLogResult).toHaveBeenCalled()
    expect(mockAppendToProjectJsonConfig).toHaveBeenCalled()
  })

  it('re-offers the provider picker when Ollama is not ready, preserving the session', async () => {
    // First pass: user picks Ollama, but it isn't ready, so selectLLMModel
    // throws OllamaNotReadyError. The handler should catch it and re-prompt
    // the provider rather than aborting the whole init session.
    jest
      .spyOn(questions, 'selectLLMProvider')
      .mockResolvedValueOnce('ollama')
      .mockResolvedValueOnce('openai')
    jest
      .spyOn(questions, 'selectLLMModel')
      .mockRejectedValueOnce(new OllamaNotReadyError())
      .mockResolvedValueOnce('gpt-4o')
    mockApiKeyService('openai')

    await handler(createArgv({ scope: 'project' }), logger)

    expect(questions.selectLLMProvider).toHaveBeenCalledTimes(2)
    expect(mockAppendToProjectJsonConfig).toHaveBeenCalledWith(
      '/repo/.coco.config.json',
      expect.objectContaining({
        service: expect.objectContaining({ provider: 'openai' }),
      })
    )
  })
})
