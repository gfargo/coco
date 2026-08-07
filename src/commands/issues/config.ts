import { Arguments, Argv, Options } from 'yargs'
import { getCommandUsageHeader } from '../../lib/ui/helpers'
import { BaseCommandOptions } from '../types'
import commandExecutor from '../../lib/utils/commandExecutor'
import { builder as createBuilder, command as createCommand, IssuesCreateOptions } from './createConfig'
import { handler as createHandler } from './createHandler'

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

// `global: false` on every list-only option (#1945): yargs otherwise treats
// `.options()` declared on the `issues` builder as inherited by every nested
// subcommand, which would leak `--state`/`--assignee`/etc. into `issues
// create`'s own (unrelated) `--title`/`--body`/`--from-review` option set.
export const options = {
  state: {
    type: 'string',
    choices: ['open', 'closed', 'all'] as const,
    description: 'Filter by issue state.',
    default: 'open',
    global: false,
  },
  assignee: {
    type: 'string',
    description: 'Filter by assignee GitHub login (or `@me`).',
    global: false,
  },
  author: {
    type: 'string',
    description: 'Filter by author GitHub login.',
    global: false,
  },
  label: {
    type: 'string',
    description: 'Filter by label name (comma-separated for AND).',
    global: false,
  },
  search: {
    type: 'string',
    description: 'Free-form GitHub issue search query.',
    global: false,
  },
  mine: {
    type: 'boolean',
    description: 'Shorthand for `--assignee @me`.',
    default: false,
    global: false,
  },
  limit: {
    type: 'number',
    description: 'Maximum rows to fetch. Defaults to `gh`\'s own default.',
    global: false,
  },
  // Not marked `global: false` — unlike the list-only filters below, `--json`
  // is meaningful on `issues create` too (it emits the drafted title/body),
  // so it should keep cascading into the nested subcommand.
  json: {
    type: 'boolean',
    description: 'Print machine-readable JSON instead of a formatted table.',
    default: false,
  },
  refresh: {
    type: 'boolean',
    description: 'Force fresh `gh` call (writes through to cache).',
    default: false,
    global: false,
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
    global: false,
  },
} as Record<string, Options>

export const builder = (yargs: Argv) => {
  return yargs
    .command<IssuesCreateOptions>(
      createCommand,
      'Create an issue, optionally AI-drafted from a review finding',
      createBuilder,
      commandExecutor(createHandler)
    )
    .options(options)
    .check((argv) => {
      // yargs coerces an unparseable --limit value to NaN, and
      // `typeof NaN === 'number'` — so a typo produced a confusing
      // `gh issue list --limit NaN` subprocess error instead of a clear
      // CLI-level one (#1893). Reject up front instead.
      const limit = (argv as { limit?: number }).limit
      if (limit !== undefined && !(Number.isInteger(limit) && limit >= 1)) {
        throw new Error('--limit must be a positive integer')
      }
      return true
    })
    .usage(getCommandUsageHeader(command))
}
