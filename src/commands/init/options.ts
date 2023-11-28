import { Options, Argv } from 'yargs'
import { BaseArgvOptions } from '../types'

export type InitOptions = BaseArgvOptions

export type InitArgv = Argv<InitOptions>['argv']

/**
 * Command line options via yargs
 */
export const options = {} as Record<string, Options>

export const builder = (yargs: Argv) => {
  return yargs.options(options)
}
