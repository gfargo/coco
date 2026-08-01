import { Arguments, Argv, Options } from 'yargs'
import { getCommandUsageHeader } from '../../lib/ui/helpers'
import { BaseCommandOptions } from '../types'

export interface WatchOptions extends BaseCommandOptions {
  review?: boolean
  draft?: boolean
  staged?: boolean
  conventional?: boolean
  language?: string
  interval?: number
  debounce?: number
  once?: boolean
}

export type WatchArgv = Arguments<WatchOptions>

export const command = 'watch'

/**
 * Command line options via yargs
 */
export const options = {
  review: {
    type: 'boolean',
    default: false,
    description: 'Re-run a code review each time the watched change set settles. Default mode when neither --review nor --draft is given.',
  },
  draft: {
    type: 'boolean',
    default: false,
    description: 'Keep a commit-message draft current as you stage changes.',
  },
  staged: {
    type: 'boolean',
    default: false,
    description: 'Only watch staged changes (git diff --cached) instead of the full working tree.',
  },
  conventional: {
    type: 'boolean',
    default: false,
    description: 'Constrain --draft output to the Conventional Commits specification.',
  },
  language: {
    type: 'string',
    description: 'Write generated output in this language, overriding the configured `language`.',
  },
  interval: {
    type: 'number',
    default: 15000,
    description: 'Minimum milliseconds between LLM calls, regardless of how often the tree changes (cost control).',
  },
  debounce: {
    type: 'number',
    default: 500,
    description: 'Milliseconds to wait after the last filesystem event before treating the change set as settled.',
  },
  once: {
    type: 'boolean',
    default: false,
    description: 'Run a single settle-triggered pass immediately and exit, instead of watching indefinitely.',
  },
} as Record<string, Options>

export const builder = (yargs: Argv) =>
  yargs
    .options(options)
    .check((argv) => {
      const typed = argv as { interval?: number; debounce?: number }
      if (typed.interval !== undefined && !(Number.isFinite(typed.interval) && typed.interval >= 0)) {
        throw new Error('--interval must be a non-negative number of milliseconds.')
      }
      if (typed.debounce !== undefined && !(Number.isFinite(typed.debounce) && typed.debounce >= 0)) {
        throw new Error('--debounce must be a non-negative number of milliseconds.')
      }
      return true
    })
    .usage(getCommandUsageHeader(command))
    .epilogue(
      'Defaults to --review when neither --review nor --draft is given. Combine both to run ' +
      'each on every settled change set. An unchanged diff (by content hash) never triggers an ' +
      'LLM call, and calls are floored to one per --interval regardless of edit frequency. ' +
      'Emits line-delimited JSON events with --json, one per state change, for editor integration.'
    )
