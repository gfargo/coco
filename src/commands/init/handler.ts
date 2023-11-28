import { input, password, select, confirm, editor } from '@inquirer/prompts'
import { Config } from '../types'
import { appendToGitConfig } from '../../lib/config/services/git'
import { appendToEnvFile } from '../../lib/config/services/env'
import { logResult } from '../../lib/ui/logResult'
import { COMMIT_PROMPT } from '../../lib/langchain/prompts/commitDefault'
import { appendToProjectConfig } from '../../lib/config/services/project'
import { LOGO } from '../../lib/ui/helpers'
import { checkAndHandlePackageInstallation } from '../../lib/ui/checkAndHandlePackageInstall'

import { InitArgv } from './options'
import { getPathToUsersGitConfig } from '../../lib/utils/getPathToUsersGitConfig'
import { createProjectFileAndReturnPath } from '../../lib/utils/createProjectFileAndReturnPath'
import { CommandHandler } from '../../lib/types'

export const handler: CommandHandler<InitArgv> = async (argv, logger) => {
  logger.log(LOGO)

  const level = await select({
    message: 'configure coco at the system or project level:',
    choices: [
      {
        name: 'system',
        value: 'system',
        description: 'add coco config to your global git config',
      },
      {
        name: 'project',
        value: 'project',
        description: 'add coco config to existing git project',
      },
    ],
  })

  let configFilePath = ''

  switch (level) {
    case 'project':
      const projectConfiguration = await select({
        message: 'select type project level configuration:',
        choices: [
          {
            name: '.coco.config.json',
            value: '.coco.config.json',
          },
          {
            name: '.env',
            value: '.env',
          },
        ],
      })
      configFilePath = await createProjectFileAndReturnPath(projectConfiguration)
      break
    case 'system':
    default:
      configFilePath = getPathToUsersGitConfig()
      break
  }

  // interactive v.s stdout mode
  const mode = (await select({
    message: 'select mode:',
    choices: [
      {
        name: 'interactive',
        value: 'interactive',
        description: 'interactive prompt for creating, reviewing, and committing',
      },
      {
        name: 'stdout',
        value: 'stdout',
        description: 'print results to stdout',
      },
    ],
  })) as 'interactive' | 'stdout'

  const apiKey = await password({
    message: `enter your OpenAI API key:`,
    validate(input) {
      return input.length > 0 ? true : 'API key cannot be empty'
    },
  })

  const tokenLimit = await input({
    message: 'maximum number of tokens for the commit message:',
    default: '500',
  })

  const defaultBranch = await input({
    message: 'default branch for the repository:',
    default: 'main',
  })

  const advOptions = await confirm({
    message: 'would you like to configure advanced options?',
    default: false,
  })

  const config: Partial<Config> = {
    openAIApiKey: '•••••••••••••••',
    tokenLimit: parseInt(tokenLimit),
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
    const temperature = await input({
      message: 'temperature for the model:',
      default: '0.4',
    })
    config.temperature = parseFloat(temperature)

    config.verbose = await confirm({
      message: 'enable verbose logging:',
      default: false,
    })

    const promptForIgnores = await confirm({
      message: 'would you like to configure ignored files and extensions?',
      default: false,
    })

    if (promptForIgnores) {
      const ignoredFiles = await input({
        message: 'paths of files to be excluded when generating commit messages (comma-separated):',
        default: 'package-lock.json',
      })

      const ignoredExtensions = await input({
        message:
          'file extensions to be excluded when generating commit messages (comma-separated):',
        default: '.map, .lock',
      })

      config.ignoredFiles =
        (ignoredFiles && ignoredFiles.split(',').map((file: string) => file.trim())) || []
      config.ignoredExtensions =
        (ignoredExtensions && ignoredExtensions.split(',').map((ext: string) => ext.trim())) || []
    }

    const promptForCommitPrompt = await confirm({
      message: 'would you like to configure the commit message prompt?',
      default: false,
    })

    if (promptForCommitPrompt) {
      const commitPrompt = await editor({
        message: 'modify default commit message prompt:',
        default: COMMIT_PROMPT.template,
      })

      config.prompt = commitPrompt
    }
  }

  logResult('Config', JSON.stringify(config, null, 2))
  // add to config after logging, so that the API key is not logged
  config.openAIApiKey = apiKey

  const isApproved = await confirm({
    message: 'looking good? (API key hidden for security)',
  })

  if (isApproved) {
    if (configFilePath.endsWith('.gitconfig')) {
      await appendToGitConfig(configFilePath, config)
    } else if (configFilePath === '.env') {
      await appendToEnvFile(configFilePath, config)
    } else if (configFilePath === '.coco.config.json') {
      await appendToProjectConfig(configFilePath, config)
    }

    // After config is written, check for package installation
    await checkAndHandlePackageInstallation({ global: level === 'system', logger })

    logger.log(`\ninit successful! 🦾🤖🎉`, { color: 'green' })
  } else {
    logger.log('\ninit cancelled.', { color: 'yellow' })
  }
}
