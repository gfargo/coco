import { appendToEnvFile } from '../../lib/config/services/env'
import { appendToGitConfig } from '../../lib/config/services/git'
import { appendToProjectJsonConfig } from '../../lib/config/services/project'
import { checkAndHandlePackageInstallation } from '../../lib/ui/checkAndHandlePackageInstall'
import { LOGO } from '../../lib/ui/helpers'
import { confirmPrompt } from '../../lib/ui/inquirerPrompts'
import { logResult } from '../../lib/ui/logResult'
import { installNpmPackage } from '../../lib/utils/installPackage'

import { ConfigWithServiceObject } from '../../lib/config/types'
import { loadConfig } from '../../lib/config/utils/loadConfig'
import { OllamaLLMService } from '../../lib/langchain/types'
import { getDefaultServiceConfigFromAlias } from '../../lib/langchain/utils'
import { CommandHandler } from '../../lib/types'
import { Logger } from '../../lib/utils/logger'
import { getPathToUsersGitConfig } from '../../lib/utils/getPathToUsersGitConfig'
import { getProjectConfigFilePath } from '../../lib/utils/getProjectConfigFilePath'
import { applyRepoCwd } from '../utils/applyRepoFlag'
import { InitArgv, InitOptions } from './config'
import { questions } from './questions'

export const handler: CommandHandler<InitArgv> = async (argv, logger) => {
  // Honor the global --repo flag so `coco init --repo <X> --scope project`
  // writes the project config to X, not the launcher's cwd. The
  // chdir has to happen before getProjectConfigFilePath resolves
  // its target path (it reads process.cwd).
  //
  // `InitArgv` is `Argv<InitOptions>['argv']` which yargs types as a
  // union including Promise — pass just the `repo` field as a plain
  // object so the helper's narrow signature stays clean.
  applyRepoCwd({ repo: (argv as { repo?: string }).repo })

  const options = loadConfig<InitOptions, InitArgv>(argv)

  logger.log(LOGO)

  let scope = options?.scope
  let shouldSetupCommitlint = false

  if (options.dryRun) {
    logger.log(`\ninit dry run successful for ${scope || 'project'} scope`, { color: 'green' })
    return
  }
  
  if (!scope) {
    scope = await questions.whatScope()
  }

  // Ask about commitlint setup after scope selection
  shouldSetupCommitlint = await questions.setupCommitlint()

  const llmProvider = await questions.selectLLMProvider()
  const llmModel = await questions.selectLLMModel(llmProvider)

  const service = getDefaultServiceConfigFromAlias(llmProvider, llmModel)

  const config: ConfigWithServiceObject = {
    defaultBranch: 'main',
    mode: 'interactive',
    service: service,
  }

  let apiKey = '' as string
  if (llmProvider === 'openai') {
    apiKey = await questions.inputApiKey('OpenAI', 'OPENAI_API_KEY')

    if (config.service.authentication.type === 'APIKey') {
      config.service.authentication.credentials.apiKey = '•••••••••••••••'
    }
  }

  if (llmProvider === 'anthropic') {
    apiKey = await questions.inputApiKey('Anthropic', 'ANTHROPIC_API_KEY')

    if (config.service.authentication.type === 'APIKey') {
      config.service.authentication.credentials.apiKey = '•••••••••••••••'
    }
  }

  const advOptions = await questions.configureAdvancedOptions()

    /**
     * Prompt for advanced options
     *
     * e.g.
     * - interactive v.s stdout mode
     * - default branch
     * - temperature
     * - token limit
     * - verbose logging
     * - ignored files
     * - ignored extensions
     * - commit message prompt
     */
  if (advOptions) {
    config.mode = await questions.selectMode()

      config.defaultBranch = await questions.selectDefaultGitBranch()

      config.service = {
        ...config.service,
        temperature: await questions.inputModelTemperature(),
        tokenLimit: await questions.inputTokenLimit(),
      }

      config.verbose = await questions.enableVerboseMode()

      if (llmProvider === 'ollama') {
        ;(config.service as OllamaLLMService).endpoint = await questions.inputOllamaEndpoint()
      }

      config.service.requestOptions = {
        timeout: await questions.inputRequestTimeout(),
        maxRetries: await questions.inputRequestMaxRetries(),
      }

      const promptForServiceFields = await confirmPrompt({
        message: 'would you like to configure additional service fields (advanced)?',
        default: false,
      })

      if (promptForServiceFields) {
        const fieldsJson = await questions.inputServiceFields()
        try {
          config.service.fields = JSON.parse(fieldsJson)
        } catch (e) {
          logger.log('Invalid JSON for service fields. Skipping.', { color: 'red' })
          
          logger.verbose(`Error parsing service fields: ${(e as Error).message}`, {
            color: 'red',
          })
        }
      }

      const promptForIgnores = await confirmPrompt({
        message: 'would you like to configure ignored files and extensions?',
        default: false,
      })

      if (promptForIgnores) {
        config.ignoredFiles = await questions.whatFilesToIgnore()
        config.ignoredExtensions = await questions.whatExtensionsToIgnore()
      }

      const promptForCommitPrompt = await confirmPrompt({
        message: 'would you like to configure the commit message prompt?',
        default: false,
      })

      if (promptForCommitPrompt) {
        config.prompt = await questions.modifyCommitPrompt()
      }
    }

  logResult('Config', JSON.stringify(config, null, 2))
  let approvalMessage = 'does this look good?'

  if (config.service.authentication.type === 'APIKey') {
    // add to config after logging, so that the API key is not logged
    config.service.authentication.credentials.apiKey = apiKey
    approvalMessage = 'looking good? (API key hidden for security)'
  }

  const isApproved = await confirmPrompt({
    message: approvalMessage,
  })

  let configFilePath = ''

  switch (scope) {
    case 'project':
      const fileTypeSelection = await questions.selectProjectConfigFileType()
      configFilePath = await getProjectConfigFilePath(fileTypeSelection)
      break
    case 'global':
    default:
      configFilePath = getPathToUsersGitConfig()
      break
  }

  if (isApproved) {
    if (configFilePath.endsWith('.gitconfig')) {
      await appendToGitConfig(configFilePath, config)
    } else if (configFilePath.endsWith('.env')) {
      await appendToEnvFile(configFilePath, config)
    } else if (configFilePath.endsWith('.coco.config.json')) {
      appendToProjectJsonConfig(configFilePath, config)
    }

    // After config is written, check for package installation
    await checkAndHandlePackageInstallation({ global: scope === 'global', logger })

    // Install commitlint packages if user requested
    if (shouldSetupCommitlint) {
      await installCommitlintPackages(scope, logger)
    }

    logger.log(`\ninit successful! 🦾🤖🎉`, { color: 'green' })
  } else {
    logger.log('\ninit cancelled.', { color: 'yellow' })
  }
}

/**
 * Install commitlint packages based on scope (global or project)
 */
async function installCommitlintPackages(scope: 'global' | 'project', logger: Logger): Promise<void> {
  const packages = ['@commitlint/config-conventional', '@commitlint/cli']
  
  try {
    if (scope === 'global') {
      logger.startSpinner('Installing commitlint packages globally...', { color: 'blue' })
      
      for (const pkg of packages) {
        await installNpmPackage({ name: pkg, flags: ['-g'] })
      }
      
      logger.stopSpinner('Installed commitlint packages globally')
    } else {
      logger.startSpinner('Installing commitlint packages in project...', { color: 'blue' })
      
      for (const pkg of packages) {
        await installNpmPackage({ name: pkg, flags: ['--save-dev'] })
      }
      
      logger.stopSpinner('Installed commitlint packages in project')
    }
  } catch (error) {
    logger.stopSpinner('Failed to install commitlint packages')
    logger.log(`Error installing commitlint packages: ${(error as Error).message}`, { color: 'red' })
    logger.log('You can install them manually later:', { color: 'yellow' })
    
    if (scope === 'global') {
      logger.log('npm install -g @commitlint/config-conventional @commitlint/cli', { color: 'gray' })
    } else {
      logger.log('npm install --save-dev @commitlint/config-conventional @commitlint/cli', { color: 'gray' })
    }
  }
}
