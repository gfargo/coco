import { appendToEnvFile } from '../../lib/config/services/env'
import { appendToGitConfig } from '../../lib/config/services/git'
import { appendToProjectJsonConfig } from '../../lib/config/services/project'
import chalk from 'chalk'
import { checkAndHandlePackageInstallation } from '../../lib/ui/checkAndHandlePackageInstall'
import { FAIL, PASS, WARN } from '../../lib/ui/glyphs'
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
import { runDiagnostics } from '../doctor/checks'
import { applyRepoCwd } from '../utils/applyRepoFlag'
import { InitArgv, InitOptions } from './config'
import { questions } from './questions'

export const handler: CommandHandler<InitArgv> = async (argv, logger) => {
  // Honor the global --repo flag so `coco init --repo <X> --scope project`
  // writes the project config to X, not the launcher's cwd. The
  // chdir has to happen before getProjectConfigFilePath resolves
  // its target path (it reads process.cwd).
  applyRepoCwd(argv)

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

  if (llmProvider === 'gemini') {
    apiKey = await questions.inputApiKey('Google Gemini', 'GEMINI_API_KEY')

    if (config.service.authentication.type === 'APIKey') {
      config.service.authentication.credentials.apiKey = '•••••••••••••••'
    }
  }

  if (llmProvider === 'mistral') {
    apiKey = await questions.inputApiKey('Mistral', 'MISTRAL_API_KEY')

    if (config.service.authentication.type === 'APIKey') {
      config.service.authentication.credentials.apiKey = '•••••••••••••••'
    }
  }

  if (llmProvider === 'azure') {
    apiKey = await questions.inputApiKey('Azure OpenAI', 'AZURE_OPENAI_API_KEY')

    if (config.service.authentication.type === 'APIKey') {
      config.service.authentication.credentials.apiKey = '•••••••••••••••'
    }
  }

  if (llmProvider === 'bedrock') {
    // Bedrock authenticates through the AWS credential chain — there is no
    // coco-managed API key to prompt for. Point the user at the env vars
    // the AWS SDK resolves automatically.
    console.log(
      'AWS Bedrock uses the standard AWS credential chain (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION). Set those in your environment.'
    )
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

    // Post-write verification — run the same check `coco doctor` runs
    // so the user finds out about typos / structural issues now,
    // before their first `coco commit`. Re-load from disk so we
    // verify the persisted config (not the in-memory shape we just
    // built), which catches transcription bugs in the appenders.
    try {
      const persistedConfig = loadConfig({})
      const diagnostics = runDiagnostics(persistedConfig)
      const errors = diagnostics.filter((d) => d.severity === 'error')
      const warnings = diagnostics.filter((d) => d.severity === 'warn')

      if (errors.length === 0 && warnings.length === 0) {
        logger.log(`${PASS()} Verified: no issues found in your new config.`, { color: 'green' })
      } else {
        if (errors.length > 0) {
          logger.log(`${FAIL()} ${errors.length} error(s) found in the persisted config:`, { color: 'red' })
          for (const diagnostic of errors) {
            logger.log(`  ${chalk.red(diagnostic.message)}`)
          }
        }
        if (warnings.length > 0) {
          logger.log(`${WARN()} ${warnings.length} warning(s) found in the persisted config:`, { color: 'yellow' })
          for (const diagnostic of warnings) {
            logger.log(`  ${chalk.yellow(diagnostic.message)}`)
          }
        }
        logger.log(`${chalk.dim('Run')} ${chalk.cyan('coco doctor')} ${chalk.dim('for the full diagnostic report.')}`)
      }
    } catch (verifyError) {
      // Verification is a polish step, not a blocker. If it crashes
      // (e.g. config file written to a path the loader can't reach
      // from the current cwd), fall through to a hint instead of
      // failing the whole init flow — the config is on disk and
      // the user can run `coco doctor` themselves.
      logger.log(
        `${chalk.dim('Skipped post-init verification:')} ${(verifyError as Error).message}`,
        { color: 'gray' }
      )
      logger.log(`${chalk.dim('Run')} ${chalk.cyan('coco doctor')} ${chalk.dim('to verify your config manually.')}`)
    }
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
