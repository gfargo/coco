import { Options, Argv } from 'yargs'

export interface CommitOptions {
  [x: string]: unknown
  model: string
  openAIApiKey: string
  huggingFaceHubApiKey: string
  tokenLimit: number
  prompt: string
  interactive: boolean
  commit: boolean
  openInEditor: boolean
  verbose: boolean
  summarizePrompt: string
  ignoredFiles: string[]
  ignoredExtensions: string[]
}

/**
 * Command line options via yargs
 */
export const options = {
  model: { type: 'string', description: 'LLM/Model-Name' },
  openAIApiKey: { type: 'string', description: 'OpenAI API Key' },
  huggingFaceHubApiKey: { type: 'string', description: 'HuggingFace Hub API Key' },
  tokenLimit: { type: 'number', description: 'Token limit' },
  prompt: {
    type: 'string',
    alias: 'p',
    description: 'Commit message prompt',
  },
  interactive: {
    type: 'boolean',
    alias: 'i',
    description: 'Toggle interactive mode',
  },
  commit: {
    type: 'boolean',
    alias: 's',
    description: 'Commit staged changes with generated commit message',
    default: false,
  },
  openInEditor: {
    type: 'boolean',
    alias: 'e',
    description: 'Open commit message in editor before proceeding',
  },
  verbose: {
    type: 'boolean',
    description: 'Enable verbose logging',
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
