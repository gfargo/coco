import { Arguments, Argv, Options } from 'yargs'
import { getCommandUsageHeader } from '../../lib/ui/helpers'
import { BaseCommandOptions } from '../types'

export interface AmendOptions extends BaseCommandOptions {
  interactive: boolean
  conventional: boolean
  additional?: string
  noVerify: boolean
  dryRun?: boolean
  apply?: boolean
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
    default: false,
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
  // `--json` is a global flag (see src/index.ts).
} as Record<string, Options>

export const builder = (yargs: Argv) => {
  return yargs.options(options).usage(getCommandUsageHeader(command))
}
