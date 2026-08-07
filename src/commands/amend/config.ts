import { Arguments, Argv, Options } from 'yargs'
import { getCommandUsageHeader } from '../../lib/ui/helpers'
import { BaseCommandOptions } from '../types'

export interface AmendOptions extends BaseCommandOptions {
  interactive: boolean
  conventional: boolean
  additional?: string
  noVerify?: boolean
  dryRun?: boolean
  apply?: boolean
  /** Overrides the configured `language` for this invocation only. */
  language?: string
}

export type AmendArgv = Arguments<AmendOptions>

export const command = 'amend'

/**
 * Command line options via yargs
 */
export const options = {
  i: {
    type: 'boolean',
    alias: 'interactive',
    description: 'Review the regenerated message before amending',
  },
  c: {
    type: 'boolean',
    alias: 'conventional',
    description: 'Generate a Conventional Commits formatted message',
    default: false,
  },
  a: {
    type: 'string',
    alias: 'additional',
    description: 'Add extra contextual information to the prompt',
  },
  n: {
    type: 'boolean',
    alias: 'noVerify',
    description: 'Skip git hooks (passes --no-verify to the amend commit)',
  },
  dryRun: {
    type: 'boolean',
    description: 'Print the regenerated message without amending the commit',
    default: false,
  },
  apply: {
    type: 'boolean',
    description:
      'Apply the regenerated message and amend the commit without confirmation (default in stdout mode is preview-only). Ignored when -i is also passed — the interactive prompt still confirms.',
    default: false,
  },
  language: {
    type: 'string',
    description: 'Write the amended commit message in this language, overriding the configured `language`.',
  },
  // `--json` is a global flag (see src/index.ts).
} as Record<string, Options>

export const builder = (yargs: Argv) => {
  return yargs
    .options(options)
    .check((argv) => {
      const a = argv as { dryRun?: boolean; apply?: boolean }
      if (a.dryRun && a.apply) {
        throw new Error('--dry-run and --apply cannot be combined — --dry-run previews, --apply amends.')
      }
      return true
    })
    .usage(getCommandUsageHeader(command))
}
