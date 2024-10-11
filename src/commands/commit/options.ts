import yargs, { Arguments, Options } from 'yargs'
import commit from '.'
import { getCommandUsageHeader } from '../../lib/ui/helpers'
import { BaseCommandOptions } from '../types'

export interface CommitOptions extends BaseCommandOptions {
  interactive: boolean
  openInEditor: boolean
  ignoredFiles: string[]
  ignoredExtensions: string[]
}

export type CommitArgv = Arguments<CommitOptions>

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
  },
  additional: {
    description: 'Add extra contextual information to the prompt',
    type: 'string',
  },
} as Record<string, Options>

export const builder = (yargsInstance: ReturnType<typeof yargs>) => {
  return yargsInstance.options(options).usage(getCommandUsageHeader(commit.command))
}
