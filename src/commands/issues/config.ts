import { Arguments, Argv, Options } from 'yargs'
import { getCommandUsageHeader } from '../../lib/ui/helpers'
import { BaseCommandOptions } from '../types'

export interface IssuesOptions extends BaseCommandOptions {
  state?: 'open' | 'closed' | 'all'
  assignee?: string
  author?: string
  label?: string
  search?: string
  /** Convenience flag → `--assignee @me`. */
  mine?: boolean
  limit?: number
  /** Print machine-readable JSON instead of the formatted table. */
  json?: boolean
  /**
   * Force a fresh `gh` call even if the cached entry is within
   * the TTL. The fresh result still gets written back to cache.
   */
  refresh?: boolean
  /**
   * Disable cache entirely — skip read AND write. Pass `--no-cache` on the
   * CLI (the boolean negation of the `cache` flag). Useful when piping into
   * tooling that manages its own freshness.
   */
  cache?: boolean
}

export type IssuesArgv = Arguments<IssuesOptions>

export const command = 'issues'

export const options = {
  state: {
    type: 'string',
    choices: ['open', 'closed', 'all'] as const,
    description: 'Filter by issue state.',
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
    description: 'Free-form GitHub issue search query.',
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
  refresh: {
    type: 'boolean',
    description: 'Force fresh `gh` call (writes through to cache).',
    default: false,
  },
  // Declared as `cache: boolean` (default true) so that the standard yargs
  // boolean-negation syntax `--no-cache` is recognised as the logical inverse
  // of a declared flag. Declaring it as `'no-cache'` would NOT be recognised
  // as a negation under .strictOptions() — yargs would treat --no-cache as
  // negating an undeclared `--cache` flag and emit "Unknown argument: cache".
  cache: {
    type: 'boolean',
    description: 'Skip the disk cache entirely (no read, no write). Pass --no-cache to disable.',
    default: true,
  },
} as Record<string, Options>

export const builder = (yargs: Argv) => {
  return yargs.options(options).usage(getCommandUsageHeader(command))
}
