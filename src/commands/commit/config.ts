import { Arguments, Argv, Options } from 'yargs'
import { getCommandUsageHeader } from '../../lib/ui/helpers'
import { BaseCommandOptions } from '../types'

export interface CommitOptions extends BaseCommandOptions {
  interactive: boolean
  openInEditor: boolean
  ignoredFiles: string[]
  ignoredExtensions: string[]
  withPreviousCommits: number
}

export type CommitArgv = Arguments<CommitOptions>

export interface CommitMessageResponse {
  title: string
  body: string
}

export const command = 'commit'

/**
 * Command line options via yargs
 */
export const options = {
  i: {
    alias: 'interactive',
    description: 'Toggle interactive mode',
    type: 'boolean',
  },
  ignoredFiles: {
    description: 'Ignored files',
    type: 'array',
  },
  ignoredExtensions: {
    description: 'Ignored extensions',
    type: 'array',
  },
  append: {
    description: 'Add content to the end of the generated commit message',
    type: 'string',
  },
  appendTicket: {
    description: 'Append ticket ID from branch name to the commit message',
    type: 'boolean',
    alias: 't',
  },
  additional: {
    description: 'Add extra contextual information to the prompt',
    type: 'string',
    alias: 'a',
  },
  withPreviousCommits: {
    description: 'Include previous commits as context (specify number of commits, 0 for none)',
    type: 'number',
    default: 0,
    alias: 'p',
  },
} as Record<string, Options>

export const builder = (yargs: Argv) => {
  return yargs.options(options).usage(getCommandUsageHeader(command))
}
