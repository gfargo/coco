import { Arguments, Argv, Options } from 'yargs'
import { z } from 'zod'
import { getCommandUsageHeader } from '../../lib/ui/helpers'
import { BaseCommandOptions } from '../types'
export interface ChangelogOptions extends BaseCommandOptions {
  range: string
  branch: string
  tag: string
  sinceLastTag: boolean
  withDiff?: boolean
  onlyDiff?: boolean
  additional?: string
  author?: boolean
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
  tag: {
    type: 'string',
    alias: 't',
    description: 'Target tag to compare against',
  },
  sinceLastTag: {
    type: 'boolean',
    description: 'Generate changelog for all commits since the last tag',
    default: false,
  },
  withDiff: {
    type: 'boolean',
    description: 'Include the diff for each commit in the prompt',
    default: false,
  },
  onlyDiff: {
    type: 'boolean',
    description: 'Generate a changelog based only on the diff of the entire branch',
    default: false,
  },
  additional: {
    type: 'string',
    alias: 'a',
    description: 'Add extra contextual information to the prompt',
  },
  author: {
    type: 'boolean',
    description: 'Include author attribution in the changelog',
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
