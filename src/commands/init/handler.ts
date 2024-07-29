import { select, confirm } from '@inquirer/prompts'
import { Config } from '../types'
import { appendToGitConfig } from '../../lib/config/services/git'
import { appendToEnvFile } from '../../lib/config/services/env'
import { logResult } from '../../lib/ui/logResult'
// import { COMMIT_PROMPT } from '../commit/prompt'
import { appendToProjectJsonConfig } from '../../lib/config/services/project'
import { LOGO } from '../../lib/ui/helpers'
import { checkAndHandlePackageInstallation } from '../../lib/ui/checkAndHandlePackageInstall'

import { InitArgv, InitOptions } from './options'
import { getPathToUsersGitConfig } from '../../lib/utils/getPathToUsersGitConfig'
import {
  ProjectConfigFileName,
  getProjectConfigFilePath,
} from '../../lib/utils/getProjectConfigFilePath'
import { CommandHandler } from '../../lib/types'
import { loadConfig } from '../../lib/config/utils/loadConfig'
import { questions } from './questions'

export const handler: CommandHandler<InitArgv> = async (argv, logger) => {
  const options = loadConfig<InitOptions, InitArgv>(argv)

  logger.log(LOGO)

  let scope = options?.scope
  if (!scope) {
    scope = await questions.whatScope()

    // interactive v.s stdout mode
    const mode = await questions.selectMode()

    // ask user if they want to use Ollama or OpenAI

    const apiKey = await questions.inputOpenAIApiKey()

    const tokenLimit = await questions.inputTokenLimit()

    const defaultBranch = await questions.selectDefaultGitBranch()

    const advOptions = await questions.configureAdvancedOptions()

    const config: Partial<Config> = {
      openAIApiKey: '•••••••••••••••',
      tokenLimit: tokenLimit,
      defaultBranch,
      mode,
    }

    /**
     * Prompt for advanced options
     *
     * e.g.
     * - temperature
     * - verbose logging
     * - ignored files
     * - ignored extensions
     * - commit message prompt
     */
    if (advOptions) {
      config.temperature = await questions.inputModelTemperature()

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
    // add to config after logging, so that the API key is not logged
    config.openAIApiKey = apiKey

    const isApproved = await confirm({
      message: 'looking good? (API key hidden for security)',
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
