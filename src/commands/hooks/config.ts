import { Arguments, Argv, Options } from 'yargs'
import { getCommandUsageHeader } from '../../lib/ui/helpers'
import { BaseCommandOptions } from '../types'

export interface HooksOptions extends BaseCommandOptions {
  action?: HooksAction
  /** Overwrite an existing (non-coco) hook backup instead of refusing. */
  force?: boolean
  /**
   * Commit-message file path for `run` (#2460) — the contract the
   * `pre-commit` framework's `prepare-commit-msg`/`commit-msg` hook stages
   * use when invoking `entry`.
   */
  messageFile?: string
}

export type HooksArgv = Arguments<HooksOptions>

/**
 * `coco hooks <action>` manages the `prepare-commit-msg` git hook (#1591) so
 * a plain `git commit` gets an AI-generated message, without requiring
 * `coco commit`. Modeled after `cache <subcommand>`'s single-verb-many-
 * actions shape. `run` (#2460) is the thin entry point the `pre-commit`
 * framework invokes directly, rather than through a native git hook.
 */
export const HOOKS_ACTIONS = ['install', 'uninstall', 'status', 'run'] as const

export type HooksAction = typeof HOOKS_ACTIONS[number]

export const command = 'hooks <action> [messageFile]'

export const options = {
  force: {
    type: 'boolean',
    default: false,
    description: 'Overwrite an existing hook backup instead of refusing (install only).',
  },
} as Record<string, Options>

export const builder = (yargs: Argv) => {
  return yargs
    .positional('action', {
      describe: 'Hook action to run',
      type: 'string',
      choices: HOOKS_ACTIONS,
    })
    .positional('messageFile', {
      describe: 'Commit-message file to populate (used by `run`, e.g. from the pre-commit framework).',
      type: 'string',
    })
    .options(options)
    .usage(getCommandUsageHeader(command))
}
