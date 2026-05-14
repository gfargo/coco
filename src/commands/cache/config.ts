import { Arguments, Argv } from 'yargs'
import { getCommandUsageHeader } from '../../lib/ui/helpers'
import { BaseCommandOptions } from '../types'

export interface CacheOptions extends BaseCommandOptions {
  /**
   * Positional list of language identifiers / aliases for the
   * `prefetch` subcommand. Empty → interactive checkbox picker.
   * Recognized values mirror the `COCO_PREFETCH` env-var grammar:
   * `py`, `python`, `rs`, `rust`, `go`, `golang`, `all`.
   */
  languages?: string[]
}

export type CacheArgv = Arguments<CacheOptions>

/**
 * Subcommand vocabulary. Two cache layers coexist under one command:
 *
 *   - **Diff-summary cache** (#845) — `info` / `clear`. Caches LLM-
 *     produced file summaries keyed on diff content; clearing
 *     forces fresh summaries on the next commit run.
 *   - **Tree-sitter parser cache** (#933) — `parsers` / `prefetch` /
 *     `clear-parsers`. Manages the lazy-loaded `.wasm` parser files
 *     under `~/.cache/coco/tree-sitter/`.
 *
 * Kept under one verb because users think of "cache" as a single
 * concept; the subcommand discriminator makes the scope unambiguous.
 */
export const CACHE_SUBCOMMANDS = [
  'clear',
  'info',
  'parsers',
  'prefetch',
  'clear-parsers',
  'clear-github',
] as const

export type CacheSubcommand = typeof CACHE_SUBCOMMANDS[number]

export const command = 'cache <subcommand> [languages..]'

export const builder = (yargs: Argv) => {
  return yargs
    .positional('subcommand', {
      describe: 'Cache action to run',
      type: 'string',
      choices: CACHE_SUBCOMMANDS,
    })
    .positional('languages', {
      describe: 'Languages to act on (for `prefetch`). Empty → interactive picker.',
      type: 'string',
      array: true,
    })
    .usage(getCommandUsageHeader(command))
}
