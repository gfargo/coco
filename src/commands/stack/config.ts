import { Arguments, Argv, Options } from 'yargs'
import { getCommandUsageHeader } from '../../lib/ui/helpers'
import { BaseCommandOptions } from '../types'

export interface StackOptions extends BaseCommandOptions {
  /** Positional stack action. `choices` enforced natively by yargs. */
  action: 'create' | 'status' | 'restack' | 'submit'
  /** Branch to create (for `create`). */
  name?: string
  /** Branch to stack on top of (for `create`) — defaults to the current branch. */
  parent?: string
  /** Open pull requests as drafts (for `submit`). */
  draft?: boolean
}

export type StackArgv = Arguments<StackOptions>

/**
 * `create`, `status`, `restack`, and `submit` share one command string with a
 * positional `<action>` constrained by an explicit `choices` list —
 * mirroring `pr <action>` (`prCreate/config.ts`) and `cache <subcommand>`
 * (`cache/config.ts`) — so `coco stack rebase` fails with yargs' native
 * "Invalid values" error instead of silently falling through, and bare
 * `coco stack` fails with yargs' native "Not enough non-option arguments"
 * error.
 */
export const command = 'stack <action> [name]'

export const options = {
  parent: {
    type: 'string',
    description: 'Branch to stack the new branch on top of (defaults to the current branch)',
  },
  draft: {
    type: 'boolean',
    description: 'Open pull requests as drafts (for `submit`)',
  },
} as Record<string, Options>

export const builder = (yargs: Argv) => {
  return yargs
    .positional('action', {
      describe: 'Stack action to run',
      type: 'string',
      choices: ['create', 'status', 'restack', 'submit'] as const,
    })
    .positional('name', {
      describe: 'Branch name to create (for `create`)',
      type: 'string',
    })
    .options(options)
    .usage(getCommandUsageHeader(command))
}
