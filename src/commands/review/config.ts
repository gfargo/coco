import { Arguments, Argv, Options } from 'yargs'
import { z } from 'zod'
import { getCommandUsageHeader } from '../../lib/ui/helpers'
import { BaseCommandOptions } from '../types'

export interface ReviewOptions extends BaseCommandOptions {
  interactive: boolean
  branch: string
}

export type ReviewArgv = Arguments<ReviewOptions>
export const ReviewFeedbackItemSchema = z.object({
  title: z.string(),
  summary: z.string(),
  severity: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
    z.literal(6),
    z.literal(7),
    z.literal(8),
    z.literal(9),
    z.literal(10),
  ]),
  category: z.string(),
  filePath: z.string(),
})

// Array schema for review feedback items
export const ReviewFeedbackItemArraySchema = z.array(ReviewFeedbackItemSchema)

export type ReviewFeedbackItem = z.infer<typeof ReviewFeedbackItemSchema>

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
  b: {
    type: 'string',
    alias: 'branch',
    description: 'Branch to review',
  },
} as Record<string, Options>

export const builder = (yargs: Argv) => { 
  return yargs.options(options).usage(getCommandUsageHeader(command))
}
