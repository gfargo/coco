import { Arguments, Argv, Options } from 'yargs'
import { getCommandUsageHeader } from '../../lib/ui/helpers'
import { BaseCommandOptions } from '../types'

export type LogFormat = 'table' | 'json'
export type LogView = 'compact' | 'graph' | 'full'

export interface LogOptions extends BaseCommandOptions {
  all?: boolean
  author?: string
  branch?: string
  commit?: string
  format?: LogFormat
  limit?: number
  merges?: boolean
  noMerges?: boolean
  path?: string | string[]
  since?: string
  until?: string
  view?: LogView
  // `repo` (alias `cwd`) is inherited from BaseCommandOptions — declared
  // globally at the yargs root so every subcommand sees it.
}

export type LogArgv = Arguments<LogOptions>

export const command = 'log'

export const options = {
  i: {
    description: 'Open the interactive terminal log UI',
    type: 'boolean',
    alias: 'interactive',
  },
  all: {
    description: 'Show commits from all local and remote refs',
    type: 'boolean',
    default: false,
  },
  author: {
    description: 'Filter commits by author',
    type: 'string',
  },
  branch: {
    description: 'Show commits reachable from a branch or ref',
    type: 'string',
    alias: 'b',
  },
  commit: {
    // No short alias: `-c` is reserved for `--conventional` (commit) to keep
    // the letter consistent across commands (#1245).
    description: 'Show details and changed files for a single commit',
    type: 'string',
  },
  format: {
    description: 'Output format',
    choices: ['table', 'json'],
    default: 'table',
  },
  limit: {
    description: 'Maximum number of commits to show (defaults to 30, or 300 in interactive mode)',
    type: 'number',
    alias: 'n',
  },
  merges: {
    description: 'Include merge commits in compact view',
    type: 'boolean',
    default: false,
  },
  noMerges: {
    description: 'Exclude merge commits',
    type: 'boolean',
    default: false,
  },
  path: {
    description: 'Filter commits by changed path',
    type: 'array',
  },
  since: {
    description: 'Show commits more recent than a date',
    type: 'string',
  },
  until: {
    description: 'Show commits older than a date',
    type: 'string',
  },
  view: {
    description: 'History view preset',
    choices: ['compact', 'graph', 'full'],
    default: 'compact',
  },
} as Record<string, Options>

export const builder = (yargs: Argv) => {
  return yargs.options(options).usage(getCommandUsageHeader(command))
}
