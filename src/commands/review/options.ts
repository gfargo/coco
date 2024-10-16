import { Arguments, Argv, Options } from 'yargs'
import recap from '.'
import { getCommandUsageHeader } from '../../lib/ui/helpers'
import { BaseCommandOptions } from '../types'

export interface ReviewOptions extends BaseCommandOptions {}

export type ReviewArgv = Arguments<ReviewOptions>

/**
 * Command line options via yargs
 */
export const options = { 
  i: {
    type: 'boolean',
    alias: 'interactive',
    description: 'Toggle interactive mode',
  },
} as Record<string, Options>

export const builder = (yargs: Argv) => {
  return yargs.options(options).usage(getCommandUsageHeader(recap.command))
}
