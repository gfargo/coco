import { Arguments, Argv, Options } from 'yargs'
import { getCommandUsageHeader } from '../../lib/ui/helpers'
import { BaseCommandOptions } from '../types'

export interface BlameOptions extends BaseCommandOptions {
  /** Positional: repo-relative path to blame. */
  file: string
  /** `a:b` (also `a:` open-ended, or a bare `a` for a single line) — 1-based inclusive. */
  lines?: string
  /** Resolve each blamed commit and ask an LLM why the range was introduced. */
  explain?: boolean
  // `repo`/`json` are inherited from BaseCommandOptions — declared globally.
}

export type BlameArgv = Arguments<BlameOptions>

export const command = 'blame <file>'

export const options = {
  lines: {
    description: 'Limit to a 1-based inclusive line range, e.g. "10:20", "10:", or "10"',
    type: 'string',
  },
  explain: {
    description: "Ask an LLM to explain why each blamed range was introduced, by reading the introducing commits",
    type: 'boolean',
    default: false,
  },
} as Record<string, Options>

export const builder = (yargs: Argv) => {
  return yargs
    .positional('file', {
      describe: 'Path to the file to blame',
      type: 'string',
    })
    .options(options)
    .usage(getCommandUsageHeader(command))
}
