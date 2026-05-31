import { Argv, Arguments, Options } from 'yargs'
import { getCommandUsageHeader } from '../../lib/ui/helpers'
import { BaseCommandOptions } from '../types'

export type InstallationScope = 'global' | 'project'

export interface InitOptions extends BaseCommandOptions {
  scope?: InstallationScope
  dryRun?: boolean
}

export type InitArgv = Arguments<InitOptions>

export const command = 'init'

/**
 * Command line options via yargs
 */
export const options = {
  scope: {
    type: 'string',
    description: 'configure coco for the current user or project?',
    choices: ['global', 'project'],
  },
  dryRun: {
    type: 'boolean',
    description: 'validate init can run without prompts or filesystem writes',
    default: false,
  },
} as Record<string, Options>

export const builder = (yargs: Argv) => {
  return yargs.options(options).usage(getCommandUsageHeader(command))
}
