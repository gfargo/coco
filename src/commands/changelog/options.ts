import { Options, Argv } from 'yargs'
import { BaseCommandOptions } from '../types'

export interface ChangelogOptions extends BaseCommandOptions {
  range: string
  prompt: string
  commit: boolean
  summarizePrompt: string
  openInEditor: boolean

}

export type ChangelogArgv = Argv<ChangelogOptions>['argv']

/**
 * Command line options via yargs
 */
export const options = {
  range: {
    type: 'string',
    alias: 'r',
    description: 'Commit range e.g `HEAD~2:HEAD`',
  },
  tokenLimit: { type: 'number', description: 'Token limit' },
  prompt: {
    type: 'string',
    alias: 'p',
    description: 'Prompt for llm',
  },
  i: {
    type: 'boolean',
    alias: 'interactive',
    description: 'Toggle interactive mode',
  },
  e: {
    type: 'boolean',
    alias: 'edit',
    description: 'Open generated changelog message in editor before proceeding',
  },
  summarizePrompt: {
    type: 'string',
    description: 'Prompt for summarizing large files',
  },

} as Record<string, Options>

export const builder = (yargs: Argv) => {
  return yargs.options(options)
}
