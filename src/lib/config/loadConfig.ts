import { loadEnvConfig } from './services/env'
import { loadGitConfig } from './services/git'
import { loadGitignore, loadIgnore } from './services/ignore'
import { loadProjectConfig } from './services/project'
import { loadXDGConfig } from './services/xdg'
import { Config } from './types'

import { SUMMARIZE_PROMPT } from '../langchain/prompts/summarize'

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
} as Config

/**
 * Load application config
 *
 * Merge config from multiple sources.
 *
 * \* Order of precedence:
 * \* 1. Command line flags
 * \* 2. Environment variables
 * \* 3. Project config
 * \* 4. Git config
 * \* 5. XDG config
 * \* 6. .gitignore
 * \* 7. .ignore
 * \* 8. Default config
 *
 * @returns {Config} application config
 **/
export function loadConfig(argv = {}): Config {
  // Default config
  let config = DEFAULT_CONFIG
  config = loadGitignore(config)
  config = loadIgnore(config)
  config = loadXDGConfig(config)
  config = loadGitConfig(config)
  config = loadProjectConfig(config)
  config = loadEnvConfig(config)

  return { ...config, ...argv }
}
