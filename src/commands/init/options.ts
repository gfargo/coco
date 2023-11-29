import { Options, Argv } from 'yargs'
import { BaseArgvOptions } from '../types'

export interface InitOptions extends BaseArgvOptions {
  level?: 'global' | 'project'
}

export type InitArgv = Argv<InitOptions>['argv']

/**
 * Command line options via yargs
 */
export const options = {
  level: {
    type: 'string',
    alias: 'l',
    description: 'configure coco for the current user or project?',
    choices: ['global', 'project'],
  },
} as Record<string, Options>

export const builder = (yargs: Argv) => {
  return yargs.options(options)
}
