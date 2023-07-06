import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import { Config } from '../types'
import { Options } from 'yargs'

/**
 * Command line options via yargs
 */
export const options = {
  openAIApiKey: { type: 'string', description: 'OpenAI API Key' },
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

/**
 * Load command line flags via yargs
 *
 * @returns {Partial<Config>} Updated config
 */
export const loadArgv = () => {
  return yargs(hideBin(process.argv)).options(options).parseSync()
}

/**
 * Load command line flags
 *
 * Note: Arugments are parsed using yargs.
 *
 * @param {Config} config
 * @returns {Config} Updated config
 **/
export function loadCmdLineFlags(config: Config): Config {
  const argv = loadArgv()
  config = { ...config, ...argv }
  return config
}
