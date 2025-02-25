import { Arguments, Argv, Options } from 'yargs'
import { getCommandUsageHeader } from '../../lib/ui/helpers'
import { BaseCommandOptions } from '../types'
export interface ChangelogOptions extends BaseCommandOptions {
  range: string
  branch: string
  sinceLastTag: boolean
}

export type ChangelogArgv = Arguments<ChangelogOptions>

export interface ChangelogResponse {
  title: string
  content: string
}

export const command = 'changelog'

/**
 * Command line options via yargs
 */
export const options = {
  range: {
    type: 'string',
    alias: 'r',
    description: 'Commit range e.g `HEAD~2:HEAD`',
  },
  branch: {
    type: 'string',
    alias: 'b',
    description: 'Target branch to compare against',
  },
  sinceLastTag: {
    type: 'boolean',
    alias: 't',
    description: 'Generate changelog for all commits since the last tag',
    default: false,
  },
  i: {
    type: 'boolean',
    alias: 'interactive',
    description: 'Toggle interactive mode',
  },
} as Record<string, Options>

export const builder = (yargs: Argv) => {
  return yargs.options(options).usage(getCommandUsageHeader(command))
}
