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
  grep?: string
  message?: string
  limit?: number
  merges?: boolean
  noMerges?: boolean
  path?: string | string[]
  pickaxe?: string
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
  grep: {
    // `LogOptions.grep`/`buildLogArgs` (data.ts) already supported this
    // — it just wasn't reachable from the CLI, only from the TUI's `/G:`
    // filter prefix (#1361). Documented for parity with --author/--path.
    //
    // NOTE (#1618): despite the name, this searches DIFF CONTENT (git log
    // -G), not commit messages — twenty years of git convention expects
    // --grep to search messages. Kept as-is for backward compatibility;
    // use --message for message search.
    description: 'Filter commits by diff content matching a regex (git log -G) — NOT commit messages, see --message',
    type: 'string',
  },
  message: {
    // #1618 — the message-search flag `--grep`'s name implied but never
    // provided. Maps to git's own `--grep=`, so it composes with git's
    // usual conventions (regex, case sensitivity, etc.) rather than
    // reinventing message matching.
    description: 'Filter commits by commit message matching a regex (git log --grep)',
    type: 'string',
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
  pickaxe: {
    // Same story as --grep above — supported at the data layer, only
    // reachable via the TUI's `/S:` filter prefix until now (#1361).
    description: 'Filter commits that changed the occurrence count of a string (git log -S, pickaxe)',
    type: 'string',
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
    // No yargs `default` here (#1622): an explicit `--view` must be able
    // to win over `--all`'s full-view implication in `getLogView`, which
    // requires distinguishing "not passed" (undefined) from "passed the
    // same value as the default". The `compact` fallback still applies —
    // see `getLogView`.
    description: 'History view preset',
    choices: ['compact', 'graph', 'full'],
  },
} as Record<string, Options>

export const builder = (yargs: Argv) => {
  return yargs.options(options).usage(getCommandUsageHeader(command))
}
