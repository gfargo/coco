import { Arguments, Argv, Options } from 'yargs'
import { z } from 'zod'
import { getCommandUsageHeader } from '../../lib/ui/helpers'
import { BaseCommandOptions } from '../types'
export interface ChangelogOptions extends BaseCommandOptions {
  range: string
  branch: string
  sinceLastTag: boolean
}

export type ChangelogArgv = Arguments<ChangelogOptions>

export const ChangelogResponseSchema = z.object({
  title: z.string(),
  content: z.string(),
})

export type ChangelogResponse = z.infer<typeof ChangelogResponseSchema>

export const command = 'changelog'

/**
 * Command line options via yargs
 */
export const options = {
  range: {
    type: 'string',
    alias: 'r',
    description: 'Commit range e.g `HEAD~2:HEAD^1` or `abc1234:def5678` (commit hashes)',
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
