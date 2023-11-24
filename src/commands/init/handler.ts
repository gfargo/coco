import { CommitOptions } from './options'
import { Argv } from 'yargs'

import inquirer from 'inquirer'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { Config } from '../types'
import { appendToIniFile } from '../../lib/config/services/git'
import { appendToEnvFile } from '../../lib/config/services/env'
import { loadConfig } from '../../lib/config/loadConfig'
import { Logger } from '../../lib/utils/logger'
import { logResult } from '../../lib/ui/logResult'

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
    choices: ['System', 'Project'],
  })

  let configFilePath = ''

  switch (level) {
    case 'System':
      configFilePath = handleSystemLevelConfig()
      break
    case 'Project':
      configFilePath = await handleProjectLevelConfig()
      break
    default:
      break
  }

  const { apiKey, tokenLimit, ignoredFiles, ignoredExtensions, defaultBranch } =
    await inquirer.prompt([
      {
        type: 'password',
        name: 'apiKey',
        // message: `Enter your ${llm} API key:`,
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
        name: 'ignoredFiles',
        message: 'paths of files to be excluded when generating commit messages (comma-separated):',
        default: 'package-lock.json',
      },
      {
        type: 'input',
        name: 'ignoredExtensions',
        message:
          'File extensions to be excluded when generating commit messages (comma-separated):',
        default: '.map, .lock',
      },
      {
        type: 'input',
        name: 'defaultBranch',
        message: 'Default branch for the repository:',
        default: 'main',
      },
    ])

  const config: Partial<Config> = {
    openAIApiKey: apiKey,
    tokenLimit,
    ignoredFiles: ignoredFiles.split(',').map((file: string) => file.trim()),
    ignoredExtensions: ignoredExtensions.split(',').map((ext: string) => ext.trim()),
    defaultBranch,
  }

  logResult('Config', JSON.stringify(config, null, 2))

  // Verify answers before proceeding
  const { confirm } = await inquirer.prompt({
    type: 'confirm',
    name: 'confirm',
    message: 'Are these settings correct?',
  })

  if (confirm) {
    if (configFilePath.endsWith('.gitconfig')) {
      appendToIniFile(configFilePath, config)
    } else if (configFilePath === '.env') {
      appendToEnvFile(configFilePath, config)
    } else {
      fs.appendFileSync(configFilePath, JSON.stringify(config, null, 2))
    }
    logger.log(`configuration appended to ${configFilePath}`, { color: 'green' })
  } else {
    logger.log('init cancelled.', { color: 'yellow' })
  }
}
