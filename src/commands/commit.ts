import { Argv, CommandBuilder } from 'yargs'
import { simpleGit, SimpleGit } from 'simple-git'
import { loadConfig } from '../lib/config/loadConfig'
import {
  generateCommitMessageAndReviewLoop,
  handleResult,
  isInteractive,
} from '../lib/ui'
import { getTokenizer } from '../lib/utils/getTokenizer'
import { Logger } from '../lib/utils/logger'
import {
  getModel,
  getModelAPIKey as getApiKeyForModel,
} from '../lib/langchain/utils'
import { getChanges } from '../lib/simple-git/getChanges'
import { BaseCommandOptions } from '../types'

// const argv = loadArgv()
const tokenizer = getTokenizer()
const git: SimpleGit = simpleGit()

export interface CommitOptions extends BaseCommandOptions {
  interactive: boolean
  tokenLimit: number
  prompt: string
  commit: boolean
  summarizePrompt: string
  openInEditor: boolean
  ignoredFiles: string[]
  ignoredExtensions: string[]
}

export const command = ['commit', '$0']
export const description = 'Generate a commit message based on the diff summary'

export const builder: CommandBuilder<CommitOptions> = {
  model: { type: 'string', description: 'LLM/Model-Name' },
  openAIApiKey: {
    type: 'string',
    description: 'OpenAI API Key',
    conflicts: 'huggingFaceHubApiKey',
  },
  huggingFaceHubApiKey: {
    type: 'string',
    description: 'HuggingFace Hub API Key',
    conflicts: 'openAIApiKey',
  },
  tokenLimit: { type: 'number', description: 'Token limit' },
  prompt: {
    type: 'string',
    alias: 'p',
    description: 'Commit message prompt',
  },
  i: {
    type: 'boolean',
    alias: 'interactive',
    description: 'Toggle interactive mode',
  },
  s: {
    type: 'boolean',
    description: 'Automatically commit staged changes with generated commit message',
    default: false,
  },
  e: {
    type: 'boolean',
    alias: 'edit',
    description: 'Open commit message in editor before proceeding',
  },
  summarizePrompt: {
    type: 'string',
    description: 'Large file summary prompt',
  },
  ignoredFiles: {
    type: 'array',
    description: 'Ignored files',
  },
  ignoredExtensions: {
    type: 'array',
    description: 'Ignored extensions',
  },
}

export async function handler(argv: Argv<CommitOptions>['argv']) {
  const options = loadConfig(argv) as CommitOptions
  const logger = new Logger(options)

  const key = getApiKeyForModel(options.model, options)

  if (!key) {
    logger.log(`No API Key found. 🗝️🚪`, { color: 'red' })
    process.exit(1)
  }

  const model = getModel(options.model, key, {
    temperature: 0.4,
    maxConcurrency: 10,
  })

  const INTERACTIVE = isInteractive(options)

  const { staged: changes } = await getChanges({ git })

  const commitMsg = await generateCommitMessageAndReviewLoop(changes, {
    logger,
    model,
    git,
    tokenizer,
    prompt: options.prompt,
    interactive: INTERACTIVE,
    openInEditor: options.openInEditor,
  })

  const MODE =
    (options.interactive && 'interactive') ||
    (options.commit && 'interactive') ||
    options?.mode ||
    'stdout'

  handleResult(commitMsg, {
    mode: MODE as 'interactive' | 'stdout',
    git,
  })
}
