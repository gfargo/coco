import { CommitOptions } from './options'
import { Argv } from 'yargs'

import inquirer from 'inquirer'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { Config } from '../types'
import { appendToGitConfig } from '../../lib/config/services/git'
import { appendToEnvFile } from '../../lib/config/services/env'
import { loadConfig } from '../../lib/config/loadConfig'
import { Logger } from '../../lib/utils/logger'
import { logResult } from '../../lib/ui/logResult'
import { COMMIT_PROMPT } from '../../lib/langchain/prompts/commitDefault'
import { appendToProjectConfig } from '../../lib/config/services/project'

const handleProjectLevelConfig = async () => {
  const { projectConfiguration } = await inquirer.prompt({
    type: 'list',
    name: 'projectConfiguration',
    message: 'select type project level configuration:',
    choices: ['.coco.config.json', '.env'],
  })

  let configFile = '.coco.config.json'

  if (projectConfiguration === '.env') {
    configFile = '.env'
    if (!fs.existsSync('.env')) {
      fs.writeFileSync('.env', '')
    }
  }

  return configFile
}

const handleSystemLevelConfig = () => {
  return path.join(os.homedir(), '.gitconfig')
}

export async function handler(argv: Argv<CommitOptions>['argv']) {
  const options = loadConfig(argv) as CommitOptions
  const logger = new Logger(options)

  const { level } = await inquirer.prompt({
    type: 'list',
    name: 'level',
    message: 'configure coco at the system or project level:',
    choices: ['system', 'project'],
  })

  let configFilePath = ''

  switch (level) {
    case 'system':
      configFilePath = await handleSystemLevelConfig()
      break
    case 'project':
      configFilePath = await handleProjectLevelConfig()
      break
    default:
      break
  }

  const { apiKey, tokenLimit, defaultBranch, advOptions, mode } = await inquirer.prompt([
    {
      type: 'list',
      name: 'mode',
      message: 'what mode would you like to use?',
      choices: ['interactive', 'stdout'],
    },
    {
      type: 'password',
      name: 'apiKey',
      message: `enter your OpenAI API key:`,
      validate(input) {
        return input.length > 0 ? true : 'API key cannot be empty'
      },
    },
    {
      type: 'number',
      name: 'tokenLimit',
      message: 'maximum number of tokens for the commit message:',
      default: 500,
    },
    {
      type: 'input',
      name: 'defaultBranch',
      message: 'default branch for the repository:',
      default: 'main',
    },
    {
      type: 'confirm',
      name: 'advOptions',
      message: 'would you like to configure advanced options?',
      default: false,
    },
  ])

  const config: Partial<Config> = {
    openAIApiKey: '•••••••••••••••',
    tokenLimit,
    defaultBranch,
    mode,
  }

  /**
   * Prompt for advanced options
   *
   * e.g.
   * - ignored files
   * - ignored extensions
   * - commit message prompt
   */
  if (advOptions) {
    const { promptForIgnores } = await inquirer.prompt({
      type: 'confirm',
      name: 'promptForIgnores',
      message: 'would you like to configure ignored files and extensions?',
      default: false,
    })

    if (promptForIgnores) {
      const { ignoredFiles, ignoredExtensions } = await inquirer.prompt([
        {
          type: 'input',
          name: 'ignoredFiles',
          message:
            'paths of files to be excluded when generating commit messages (comma-separated):',
          default: 'package-lock.json',
        },
        {
          type: 'input',
          name: 'ignoredExtensions',
          message:
            'file extensions to be excluded when generating commit messages (comma-separated):',
          default: '.map, .lock',
        },
      ])

      config.ignoredFiles =
        ignoredFiles && ignoredFiles.split(',').map((file: string) => file.trim())
      config.ignoredExtensions =
        ignoredExtensions && ignoredExtensions.split(',').map((ext: string) => ext.trim())
    }

    const { promptForCommitPrompt } = await inquirer.prompt({
      type: 'confirm',
      name: 'promptForCommitPrompt',
      message: 'would you like to configure the commit message prompt?',
      default: false,
    })

    if (promptForCommitPrompt) {
      const { commitPrompt } = await inquirer.prompt({
        type: 'editor',
        name: 'commitPrompt',
        message: 'modify default commit message prompt:',
        default: COMMIT_PROMPT.template,
      })

      config.prompt = commitPrompt
    }
  }

  logResult('Config', JSON.stringify(config, null, 2))
  // add to config after logging, so that the API key is not logged
  config.openAIApiKey = apiKey

  const { confirm } = await inquirer.prompt({
    type: 'confirm',
    name: 'confirm',
    message: 'look good? (hiding API key for security)',
  })

  if (confirm) {
    if (configFilePath.endsWith('.gitconfig')) {
      await appendToGitConfig(configFilePath, config)
    } else if (configFilePath === '.env') {
      await appendToEnvFile(configFilePath, config)
    } else if (configFilePath === '.coco.config.json'){
      await appendToProjectConfig(configFilePath, config)
    }

    logger.log(`init successful! 🦾🤖🎉`, { color: 'green' })
  } else {
    logger.log('init cancelled.', { color: 'yellow' })
  }
}
