import { Arguments, Argv, Options } from 'yargs'
import { z } from 'zod'
import { getCommandUsageHeader } from '../../lib/ui/helpers'
import { BaseCommandOptions } from '../types'

export interface RecapOptions extends BaseCommandOptions {
  yesterday?: boolean
  'last-week'?: boolean
  'last-month'?: boolean
  'last-tag'?: boolean
  currentBranch?: boolean
  timeframe?: 'current' | 'yesterday' | 'last-week' | 'last-month' | 'last-tag' | 'currentBranch'
  json?: boolean
}

export type RecapArgv = Arguments<RecapOptions>

export const RecapLlmResponseSchema = z.object({
  title: z.string(),
  summary: z.string(),
})

export const command = 'recap'

/**
 * Command line options via yargs
 */
export const options = {
  yesterday: {
    type: 'boolean',
    description: 'Recap for yesterday',
  },
  'last-week': {
    alias: 'week',
    type: 'boolean',
    description: 'Recap for last week',
  },
  'last-month': {
    alias: 'month',
    type: 'boolean',
    description: 'Recap for last month',
  },
  'last-tag': {
    alias: 'tag',
    type: 'boolean',
    // NOTE: `--tag` is a boolean alias for `--last-tag` here (means "since the
    // last tag"). This diverges from `coco changelog --tag <name>` where `--tag`
    // is a STRING pointing to a specific tag. Passing `coco recap --tag v1.0.0`
    // therefore treats `v1.0.0` as a positional and silently recaps since the
    // last tag instead. Reconciling this semantic divergence is tracked as a
    // follow-up task (#1438).
    description: 'Recap for last tag',
  },
  currentBranch: {
    type: 'boolean',
    description: 'Recap for the current branch',
  },
  timeframe: {
    type: 'string',
    choices: ['current', 'yesterday', 'last-week', 'last-month', 'last-tag', 'currentBranch'],
    description: 'Recap timeframe (canonical form of the shortcut flags above)',
  },
  i: {
    type: 'boolean',
    alias: 'interactive',
    description: 'Toggle interactive mode',
  },
  // `--json` is a global flag (see src/index.ts).
} as Record<string, Options>

export const builder = (yargs: Argv) => {
  return yargs
    .options(options)
    .check((argv) => {
      // `--tag` is a boolean alias for `--last-tag` here, unlike
      // `coco changelog --tag <name>` where it takes a string. Passing a
      // value (`coco recap --tag v1.0.0`) used to silently drop it as a
      // stray positional and recap since the *latest* tag instead (#1613).
      // Reject up front so the value is never silently discarded.
      const rawArgv = argv as { tag?: boolean; 'last-tag'?: boolean; _: (string | number)[] }
      const tagRequested = Boolean(rawArgv.tag ?? rawArgv['last-tag'])
      if (tagRequested && rawArgv._.length > 0) {
        throw new Error(
          `--tag on recap takes no value (it means "since the last tag") — unexpected argument '${rawArgv._[0]}'. Did you mean 'coco changelog --tag ${rawArgv._[0]}'?`
        )
      }
      return true
    })
    .usage(getCommandUsageHeader(command))
}
