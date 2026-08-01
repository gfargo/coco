import { Arguments, Argv, Options } from 'yargs'
import { getCommandUsageHeader } from '../../lib/ui/helpers'
import { BaseCommandOptions } from '../types'

export interface IssuesCreateOptions extends BaseCommandOptions {
  title?: string
  body?: string
  /** Draft the issue from `coco review --json` findings piped on stdin. */
  fromReview?: boolean
  interactive: boolean
  dryRun?: boolean
}

export type IssuesCreateArgv = Arguments<IssuesCreateOptions>

export const command = 'create'

export const options = {
  title: {
    type: 'string',
    description: 'Issue title (skips generation).',
  },
  body: {
    type: 'string',
    description: 'Issue body (skips generation).',
  },
  fromReview: {
    type: 'boolean',
    description: 'Draft the issue from `coco review --json` findings piped on stdin.',
    default: false,
  },
  i: {
    type: 'boolean',
    alias: 'interactive',
    description: 'Review (and optionally edit) the issue before creating it',
  },
  dryRun: {
    type: 'boolean',
    description: 'Print the generated title/body without creating the issue',
    default: false,
  },
  // `--json` is a global flag (see src/index.ts).
} as Record<string, Options>

export const builder = (yargs: Argv) => {
  return yargs.options(options).usage(getCommandUsageHeader('issues create'))
}
