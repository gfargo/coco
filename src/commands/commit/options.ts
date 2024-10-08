import yargs, { Arguments, Options } from 'yargs'
import { BaseCommandOptions } from '../types'

export interface CommitOptions extends BaseCommandOptions {
  interactive: boolean
  commit: boolean
  openInEditor: boolean
  ignoredFiles: string[]
  ignoredExtensions: string[]
}

export type CommitArgv = Arguments<CommitOptions>

/**
 * Command line options via yargs
 */
export const options = {
  tokenLimit: { type: 'number', description: 'Token limit' },
  i: {
    alias: 'interactive',
    description: 'Toggle interactive mode',
    type: 'boolean',
  },
  e: {
    alias: 'edit',
    description: 'Open commit message in editor before proceeding',
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
} as Record<string, Options>

export const builder = (yargsInstance: ReturnType<typeof yargs>) => {
  return yargsInstance.options(options)
}
