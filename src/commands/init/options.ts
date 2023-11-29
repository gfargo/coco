import { Options, Argv } from 'yargs'
import { BaseArgvOptions } from '../types'

export interface InitOptions extends BaseArgvOptions {
  level?: 'system' | 'project'
}

export type InitArgv = Argv<InitOptions>['argv']

/**
 * Command line options via yargs
 */
export const options = {
  level: {
    type: 'string',
    alias: 'l',
    description: 'Configure coco at the system or project level',
    choices: ['system', 'project'],
  },
  
} as Record<string, Options>

export const builder = (yargs: Argv) => {
  return yargs.options(options)
}
