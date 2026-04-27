import { Arguments, Argv, Options } from 'yargs'
import { getCommandUsageHeader } from '../../lib/ui/helpers'
import { BaseCommandOptions } from '../types'

export type LogFormat = 'table' | 'json'

export interface LogOptions extends BaseCommandOptions {
  all?: boolean
  author?: string
  branch?: string
  commit?: string
  format?: LogFormat
  limit?: number
  noMerges?: boolean
  path?: string | string[]
  since?: string
  until?: string
}

export type LogArgv = Arguments<LogOptions>

export const command = 'log'

export const options = {
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
    description: 'Show details and changed files for a single commit',
    type: 'string',
    alias: 'c',
  },
  format: {
    description: 'Output format',
    choices: ['table', 'json'],
    default: 'table',
  },
  limit: {
    description: 'Maximum number of commits to show',
    type: 'number',
    default: 30,
    alias: 'n',
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
} as Record<string, Options>

export const builder = (yargs: Argv) => {
  return yargs.options(options).usage(getCommandUsageHeader(command))
}
