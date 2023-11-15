import { Options, Argv } from 'yargs'
import { BaseCommandOptions } from '../types'

export interface CommitOptions extends BaseCommandOptions {
  prompt: string
  commit: boolean
  summarizePrompt: string
  openInEditor: boolean
  ignoredFiles: string[]
  ignoredExtensions: string[]
}

/**
 * Command line options via yargs
 */
export const options = {
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
} as Record<string, Options>

export const builder = (yargs: Argv) => {
  return yargs.options(options)
}
