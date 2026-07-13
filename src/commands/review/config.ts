import { Arguments, Argv, Options } from 'yargs'
import { z } from 'zod'
import { getCommandUsageHeader } from '../../lib/ui/helpers'
import { BaseCommandOptions } from '../types'

export interface ReviewOptions extends BaseCommandOptions {
  interactive: boolean
  branch: string
  json?: boolean
  staged?: boolean
  severity?: number
  /** Overrides the configured `language` for this invocation only. */
  language?: string
  /** Review an existing forge PR/MR by number instead of local changes. */
  pr?: number
  /** Post the findings summary (or request-changes above --severity) to the PR/MR. */
  comment?: boolean
}

export type ReviewArgv = Arguments<ReviewOptions>
export const ReviewFeedbackItemSchema = z.object({
  title: z.string(),
  summary: z.string(),
  severity: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
    z.literal(6),
    z.literal(7),
    z.literal(8),
    z.literal(9),
    z.literal(10),
  ]),
  category: z.string(),
  filePath: z.string(),
})

// Array schema for review feedback items
export const ReviewFeedbackItemArraySchema = z.array(ReviewFeedbackItemSchema)

export type ReviewFeedbackItem = z.infer<typeof ReviewFeedbackItemSchema>

export const command = 'review'

/**
 * Command line options via yargs
 */
export const options = {
  i: {
    type: 'boolean',
    alias: 'interactive',
    description: 'Toggle interactive mode',
  },
  b: {
    type: 'string',
    alias: 'branch',
    description: 'Branch to review',
  },
  // `--json` is a global flag (see src/index.ts).
  staged: {
    type: 'boolean',
    default: false,
    description: 'Review only staged changes (instead of the full working tree)',
  },
  severity: {
    type: 'number',
    alias: 's',
    description: 'Exit non-zero if any finding has severity >= this threshold (1-10). For CI gating.',
  },
  language: {
    type: 'string',
    description: 'Write review feedback in this language, overriding the configured `language`.',
  },
  pr: {
    type: 'number',
    alias: 'mr',
    description: 'Review a forge pull/merge request by number instead of local changes.',
  },
  comment: {
    type: 'boolean',
    default: false,
    description: 'Post the findings to the PR/MR (requires --pr). Findings meeting --severity request changes instead of a plain comment.',
  },
} as Record<string, Options>

export const builder = (yargs: Argv) => {
  return yargs
    .options(options)
    .check((argv) => {
      // yargs coerces an unparseable --severity value to NaN, and
      // `typeof NaN === 'number'` — so a typo silently disabled the CI
      // gate instead of failing loudly (#1599). Reject up front instead.
      const severity = (argv as { severity?: number }).severity
      if (
        severity !== undefined &&
        !(Number.isInteger(severity) && severity >= 1 && severity <= 10)
      ) {
        throw new Error('--severity must be an integer between 1 and 10')
      }
      const rawArgv = argv as { pr?: number; comment?: boolean; branch?: string; staged?: boolean }
      if (rawArgv.comment && rawArgv.pr === undefined) {
        throw new Error('--comment requires --pr <number>.')
      }
      if (rawArgv.pr !== undefined && (rawArgv.branch || rawArgv.staged)) {
        throw new Error('--pr cannot be combined with --branch or --staged.')
      }
      return true
    })
    .usage(getCommandUsageHeader(command))
}
