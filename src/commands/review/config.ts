import { Arguments, Argv, Options } from 'yargs'
import { getCommandUsageHeader } from '../../lib/ui/helpers'
import { BaseCommandOptions } from '../types'

export interface ReviewOptions extends BaseCommandOptions {
  interactive: boolean
  branch: string
}

export type ReviewArgv = Arguments<ReviewOptions>

export type ReviewFeedbackItem = {
  title: string
  summary: string
  severity: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10
  category: string
  filePath: string
}

export const command = 'review'

/**
 * Command line options via yargs 
 */
export const options = { 
  i: {
    type: 'boolean',
    alias: 'interactive',
    description: 'Toggle interactive mode',
  },
  'b': {
    type: 'string',
    alias: 'branch',
    description: 'Branch to review',
  },
} as Record<string, Options>  

export const builder = (yargs: Argv) => {
  return yargs.options(options).usage(getCommandUsageHeader(command))
}  

