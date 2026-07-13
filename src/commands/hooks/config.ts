import { Arguments, Argv, Options } from 'yargs'
import { getCommandUsageHeader } from '../../lib/ui/helpers'
import { BaseCommandOptions } from '../types'

export interface HooksOptions extends BaseCommandOptions {
  action?: HooksAction
  /** Overwrite an existing (non-coco) hook backup instead of refusing. */
  force?: boolean
}

export type HooksArgv = Arguments<HooksOptions>

/**
 * `coco hooks <action>` manages the `prepare-commit-msg` git hook (#1591) so
 * a plain `git commit` gets an AI-generated message, without requiring
 * `coco commit`. Modeled after `cache <subcommand>`'s single-verb-many-
 * actions shape.
 */
export const HOOKS_ACTIONS = ['install', 'uninstall', 'status'] as const

export type HooksAction = typeof HOOKS_ACTIONS[number]

export const command = 'hooks <action>'

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
    .options(options)
    .usage(getCommandUsageHeader(command))
}
