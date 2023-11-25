import { SUMMARIZE_PROMPT } from '../langchain/prompts/summarize';
import { Config } from './types';

/**
 * Default Config
 *
 * @type {Config}
 */

export const DEFAULT_CONFIG = {
  model: 'openai/gpt-4',
  verbose: false,
  tokenLimit: 1024,
  summarizePrompt: SUMMARIZE_PROMPT.template,
  temperature: 0.4,
  mode: 'stdout',
  ignoredFiles: ['package-lock.json'],
  ignoredExtensions: ['.map', '.lock'],
  defaultBranch: 'main',
} as Config

/**
 * Config keys
 *
 * @type {string[]}
 */
export const CONFIG_KEYS = Object.keys({
  ...DEFAULT_CONFIG,
  huggingFaceHubApiKey: '',
  openAIApiKey: '',
  prompt: '',
} as Config) as (keyof Config)[]