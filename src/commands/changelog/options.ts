import yargs, { Arguments, Options } from 'yargs'
import { BaseCommandOptions } from '../types'

export interface ChangelogOptions extends BaseCommandOptions {
  range: string
  branch: string
  edit: boolean
}

export type ChangelogArgv = Arguments<ChangelogOptions>

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
  tokenLimit: { type: 'number', description: 'Token limit' },
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
} as Record<string, Options>

export const builder = (yargsInstance: ReturnType<typeof yargs>) => {
  return yargsInstance.options(options)
}
