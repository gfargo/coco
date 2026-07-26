import { Arguments, Argv, Options } from 'yargs'
import { z } from 'zod'
import { getCommandUsageHeader } from '../../lib/ui/helpers'
import { BaseCommandOptions } from '../types'

export interface LintOptions extends BaseCommandOptions {
  since?: string
  range?: string
  fix?: boolean
  force?: boolean
  severity?: 'error' | 'warning'
  /** Overrides the configured `language` for this invocation only. */
  language?: string
}

export type LintArgv = Arguments<LintOptions>

export const LintRewordResponseSchema = z.object({
  subject: z.string(),
})

export const command = 'lint'

/**
 * Command line options via yargs
 */
export const options = {
  since: {
    type: 'string',
    description: 'Lint commits in <ref>..HEAD instead of comparing against the default branch.',
  },
  range: {
    type: 'string',
    description: 'Lint an explicit commit range (e.g. "abc123..def456").',
  },
  fix: {
    type: 'boolean',
    default: false,
    description: 'Reword non-conforming commit subjects via an interactive rebase. Mutates history — off by default.',
  },
  force: {
    type: 'boolean',
    default: false,
    description: '--fix only: proceed despite merges in range, an already-pushed range, or a dirty worktree.',
  },
  severity: {
    type: 'string',
    choices: ['error', 'warning'],
    default: 'error',
    description: 'Exit non-zero when a commit has a violation at/above this level. For CI gating.',
  },
  language: {
    type: 'string',
    description: 'Write reworded commit subjects in this language, overriding the configured `language`.',
  },
  // `--json` is a global flag (see src/index.ts).
} as Record<string, Options>

export const builder = (yargs: Argv) => {
  return yargs
    .options(options)
    .check((argv) => {
      const rawArgv = argv as { since?: string; range?: string; fix?: boolean; force?: boolean }
      if (rawArgv.since && rawArgv.range) {
        throw new Error('--since and --range are mutually exclusive — pass one or the other.')
      }
      if (rawArgv.force && !rawArgv.fix) {
        throw new Error('--force has no effect without --fix.')
      }
      return true
    })
    .usage(getCommandUsageHeader(command))
}
