import { Arguments, Argv, Options } from 'yargs'
import { z } from 'zod'
import { getCommandUsageHeader } from '../../lib/ui/helpers'
import { BaseCommandOptions } from '../types'

export interface RecapOptions extends BaseCommandOptions {
  yesterday?: boolean
  'last-week'?: boolean
  'last-month'?: boolean
  'last-tag'?: boolean
}

export type RecapArgv = Arguments<RecapOptions>

export const RecapLlmResponseSchema = z.object({
  title: z.string().optional(),
  summary: z.string().optional(),
})

export const command = 'recap'

/**
 * Command line options via yargs
 */
export const options = {
  yesterday: {
    type: 'boolean',
    description: 'Recap for yesterday',
  },
  'last-week': {
    alias: 'week',
    type: 'boolean',
    description: 'Recap for last week',
  },
  'last-month': {
    alias: 'month',
    type: 'boolean',
    description: 'Recap for last month',
  },
  'last-tag': {
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

export const builder = (yargs: Argv) => {
  return yargs.options(options).usage(getCommandUsageHeader(command))
}
