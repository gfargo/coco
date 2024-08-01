import { confirm } from '@inquirer/prompts'
import { appendToGitConfig } from '../../lib/config/services/git'
import { appendToEnvFile } from '../../lib/config/services/env'
import { logResult } from '../../lib/ui/logResult'
import { appendToProjectJsonConfig } from '../../lib/config/services/project'
import { LOGO } from '../../lib/ui/helpers'
import { checkAndHandlePackageInstallation } from '../../lib/ui/checkAndHandlePackageInstall'

import { InitArgv, InitOptions } from './options'
import { getPathToUsersGitConfig } from '../../lib/utils/getPathToUsersGitConfig'
import { getProjectConfigFilePath } from '../../lib/utils/getProjectConfigFilePath'
import { CommandHandler } from '../../lib/types'
import { loadConfig } from '../../lib/config/utils/loadConfig'
import { questions } from './questions'
import { getDefaultServiceConfigFromAlias } from '../../lib/langchain/utils'
import { ConfigWithServiceObject } from '../../lib/config/types'

export const handler: CommandHandler<InitArgv> = async (argv, logger) => {
  const options = loadConfig<InitOptions, InitArgv>(argv)

  logger.log(LOGO)

  let scope = options?.scope
  if (!scope) {
    scope = await questions.whatScope()

    const llmProvider = await questions.selectLLMProvider()
    const llmModel = await questions.selectLLMModel(llmProvider)

    const service = getDefaultServiceConfigFromAlias(llmProvider, llmModel)

    const config: ConfigWithServiceObject = {
      defaultBranch: 'main',
      mode: 'interactive',
      service: service,
    }

    let openAIKey = ''
    if (llmProvider === 'openai') {
      openAIKey = await questions.inputOpenAIApiKey()

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

      config.temperature = await questions.inputModelTemperature()

      config.tokenLimit = await questions.inputTokenLimit()

      config.verbose = await questions.enableVerboseMode()

      const promptForIgnores = await confirm({
        message: 'would you like to configure ignored files and extensions?',
        default: false,
      })

      if (promptForIgnores) {
        config.ignoredFiles = await questions.whatFilesToIgnore()
        config.ignoredExtensions = await questions.whatExtensionsToIgnore()
      }

      const promptForCommitPrompt = await confirm({
        message: 'would you like to configure the commit message prompt?',
        default: false,
      })

      if (promptForCommitPrompt) {
        config.prompt = await questions.modifyCommitPrompt()
      }
    }

    logResult('Config', JSON.stringify(config, null, 2))
    let approvalMessage = 'does this look good?'

    if (llmProvider === 'openai') {
      if (config.service.authentication.type === 'APIKey') {
        // add to config after logging, so that the API key is not logged
        config.service.authentication.credentials.apiKey = openAIKey
        approvalMessage = 'looking good? (API key hidden for security)'
      }
    }

    const isApproved = await confirm({
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

      logger.log(`\ninit successful! 🦾🤖🎉`, { color: 'green' })
    } else {
      logger.log('\ninit cancelled.', { color: 'yellow' })
    }
  }
}
