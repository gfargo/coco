import { SUMMARIZE_PROMPT } from '../langchain/chains/summarize/prompt'
import { getDefaultServiceConfigFromAlias } from '../langchain/utils'
import { Config } from './types'

export const DEFAULT_IGNORED_FILES = ['package-lock.json']
export const DEFAULT_IGNORED_EXTENSIONS = ['.map', '.lock']

export const COCO_CONFIG_START_COMMENT = '# -- start coco config --'
export const COCO_CONFIG_END_COMMENT = '# -- end coco config --'

/**
 * Default Config
 *
 * @type {Config}
 */
export const DEFAULT_CONFIG: Config = {
  mode: 'stdout',
  verbose: false,
  defaultBranch: 'main',
  service: getDefaultServiceConfigFromAlias('openai'),
  summarizePrompt: SUMMARIZE_PROMPT.template as string,
  ignoredFiles: DEFAULT_IGNORED_FILES,
  ignoredExtensions: DEFAULT_IGNORED_EXTENSIONS,
}

/**
 * Create a named export of all config keys for use in other modules.
 *
 * @see Used in `src/lib/config/services/env.ts` to validate all env vars.
 *
 * @type {string[]}
 */
export const CONFIG_KEYS = Object.keys({
  ...DEFAULT_CONFIG,
  prompt: '',
} as Config) as (keyof Config)[]
