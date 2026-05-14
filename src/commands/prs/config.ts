import { Arguments, Argv, Options } from 'yargs'
import { getCommandUsageHeader } from '../../lib/ui/helpers'
import { BaseCommandOptions } from '../types'

export interface PrsOptions extends BaseCommandOptions {
  state?: 'open' | 'closed' | 'merged' | 'all'
  assignee?: string
  author?: string
  label?: string
  search?: string
  base?: string
  head?: string
  draft?: boolean
  /** Convenience flag → `--assignee @me`. */
  mine?: boolean
  limit?: number
  /** Print machine-readable JSON instead of the formatted table. */
  json?: boolean
}

export type PrsArgv = Arguments<PrsOptions>

export const command = 'prs'

export const options = {
  state: {
    type: 'string',
    choices: ['open', 'closed', 'merged', 'all'] as const,
    description: 'Filter by PR state.',
    default: 'open',
  },
  assignee: {
    type: 'string',
    description: 'Filter by assignee GitHub login (or `@me`).',
  },
  author: {
    type: 'string',
    description: 'Filter by author GitHub login.',
  },
  label: {
    type: 'string',
    description: 'Filter by label name (comma-separated for AND).',
  },
  search: {
    type: 'string',
    description: 'Free-form GitHub PR search query.',
  },
  base: {
    type: 'string',
    description: 'Filter to PRs targeting a specific base branch.',
  },
  head: {
    type: 'string',
    description: 'Filter to PRs originating from a specific head branch.',
  },
  draft: {
    type: 'boolean',
    description: 'Limit to draft PRs only.',
    default: false,
  },
  mine: {
    type: 'boolean',
    description: 'Shorthand for `--assignee @me`.',
    default: false,
  },
  limit: {
    type: 'number',
    description: 'Maximum rows to fetch. Defaults to `gh`\'s own default.',
  },
  json: {
    type: 'boolean',
    description: 'Print machine-readable JSON instead of a formatted table.',
    default: false,
  },
} as Record<string, Options>

export const builder = (yargs: Argv) => {
  return yargs.options(options).usage(getCommandUsageHeader(command))
}
