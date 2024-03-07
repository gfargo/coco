import { SUMMARIZE_PROMPT } from '../langchain/prompts/summarize'
import { Config, OpenAIAliasConfig } from './types'

export const DEFAULT_IGNORED_FILES = ['package-lock.json']
export const DEFAULT_IGNORED_EXTENSIONS = ['.map', '.lock']

/**
 * Default Config
 *
 * @type {Config}
 */
export const DEFAULT_CONFIG = {
  service: 'openai',
  verbose: false,
  tokenLimit: 1024,
  summarizePrompt: SUMMARIZE_PROMPT.template,
  temperature: 0.4,
  mode: 'stdout',
  ignoredFiles: DEFAULT_IGNORED_FILES,
  ignoredExtensions: DEFAULT_IGNORED_EXTENSIONS,
  defaultBranch: 'main',
} as Partial<OpenAIAliasConfig>

/**
 * Create a named export of all config keys for use in other modules.
 *
 * @see Used in `src/lib/config/services/env.ts` to validate all env vars.
 *
 * @type {string[]}
 */
export const CONFIG_KEYS = Object.keys({
  ...DEFAULT_CONFIG,
  endpoint: '',
  prompt: '',
} as Config) as (keyof Config)[]

export const COCO_CONFIG_START_COMMENT = '# -- start coco config --'
export const COCO_CONFIG_END_COMMENT = '# -- end coco config --'
