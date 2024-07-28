import { Options, Argv } from 'yargs'
import { BaseArgvOptions } from '../types'

export type InstallationScope = 'global' | 'project'

export interface InitOptions extends BaseArgvOptions {
  scope?: InstallationScope
}

export type InitArgv = Argv<InitOptions>['argv']

/**
 * Command line options via yargs
 */
export const options = {
  scope: {
    type: 'string',
    description: 'configure coco for the current user or project?',
    choices: ['global', 'project'],
  },
} as Record<string, Options>

export const builder = (yargs: Argv) => {
  return yargs.options(options)
}
