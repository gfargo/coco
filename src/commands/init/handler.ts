import { input, password, select, confirm, editor } from '@inquirer/prompts'
import { Config } from '../types'
import { appendToGitConfig } from '../../lib/config/services/git'
import { appendToEnvFile } from '../../lib/config/services/env'
import { logResult } from '../../lib/ui/logResult'
import { COMMIT_PROMPT } from '../commit/prompt'
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

export const handler: CommandHandler<InitArgv> = async (argv, logger) => {
  const options = loadConfig<InitOptions, InitArgv>(argv)

  logger.log(LOGO)

  let level = options?.level
  if (!level) {
    level = await select({
      message: 'configure coco for the current user or project?',
      choices: [
        {
          name: 'global',
          value: 'global',
          description: 'add coco config to your global git config',
        },
        {
          name: 'project',
          value: 'project',
          description: 'add coco config to existing git project',
        },
      ],
    })
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

      config.ignoredFiles = ignoredFiles?.split(',')?.map((file: string) => file.trim()) || []
      config.ignoredExtensions =
        ignoredExtensions?.split(',')?.map((ext: string) => ext.trim()) || []
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

  let configFilePath = ''

  switch (level) {
    case 'project':
      const projectConfiguration = (await select({
        message: 'where would you like to store the project config?',
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
      })) as ProjectConfigFileName
      configFilePath = await getProjectConfigFilePath(projectConfiguration)
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
    await checkAndHandlePackageInstallation({ global: level === 'global', logger })

    logger.log(`\ninit successful! 🦾🤖🎉`, { color: 'green' })
  } else {
    logger.log('\ninit cancelled.', { color: 'yellow' })
  }
}
