import yargs, { Arguments, Options } from 'yargs'
import recap from '.'
import { getCommandUsageHeader } from '../../lib/ui/helpers'
import { BaseCommandOptions } from '../types'

export interface RecapOptions extends BaseCommandOptions {
  yesterday?: boolean
  "last-week"?: boolean
  "last-month"?: boolean
  "last-tag"?: boolean
}

export type RecapArgv = Arguments<RecapOptions>

/**
 * Command line options via yargs
 */
export const options = {
  yesterday: {
    type: 'boolean',
    description: 'Recap for yesterday',
  },
  "last-week": {
    alias: 'week',
    type: 'boolean',
    description: 'Recap for last week',
  },
  "last-month": {
    alias: 'month',
    type: 'boolean',
    description: 'Recap for last month',
  },
  "last-tag": {
    alias: 'tag',
    type: 'boolean',
    description: 'Recap for last tag',
  },
  i: {
    type: 'boolean',
    alias: 'interactive',
    description: 'Toggle interactive mode',
  },
} as Record<string, Options>

export const builder = (yargsInstance: ReturnType<typeof yargs>) => {
  return yargsInstance.options(options).usage(getCommandUsageHeader(recap.command))
}
