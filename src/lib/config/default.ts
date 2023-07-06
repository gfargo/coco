import { COMMIT_PROMPT } from '../langchain/prompts/commitDefault'
import { SUMMARIZE_PROMPT as SUMMARIZE_PROMPT } from '../langchain/prompts/summarize'
import { Config } from './types'

/**
 * Default Config
 * 
 * @type {Config}
 */
export const DEFAULT_CONFIG = {
  openAIApiKey: '',
  verbose: false,
  tokenLimit: 1024,
  prompt: COMMIT_PROMPT.template,
  summarizePrompt: SUMMARIZE_PROMPT.template,
  temperature: 0.4,
  mode: 'stdout',
  
  ignoredFiles: ['package-lock.json'],
  ignoredExtensions: ['.map', '.lock'],
} as Config
