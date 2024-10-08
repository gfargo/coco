import yargs, { Arguments, Options } from 'yargs'
import { BaseCommandOptions } from '../types'

export interface CommitOptions extends BaseCommandOptions {
  interactive: boolean
  prompt: string
  commit: boolean
  summarizePrompt: string
  openInEditor: boolean
  ignoredFiles: string[]
  ignoredExtensions: string[]
}

export type CommitArgv = Arguments<CommitOptions>

/**
 * Command line options via yargs
 */
export const options = {
  service: { type: 'string', description: 'LLM/Model-Name', choices: ['openai', 'ollama'] },
  openAIApiKey: {
    type: 'string',
    description: 'OpenAI API Key',
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

export const builder = (yargsInstance: ReturnType<typeof yargs>) => {
  return yargsInstance.options(options)
}
