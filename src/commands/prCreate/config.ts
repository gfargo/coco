import { Arguments, Argv, Options } from 'yargs'
import { getCommandUsageHeader } from '../../lib/ui/helpers'
import { BaseCommandOptions } from '../types'

export interface PrCreateOptions extends BaseCommandOptions {
  base?: string
  draft?: boolean
  title?: string
  body?: string
  web?: boolean
  interactive: boolean
  dryRun?: boolean
}

export type PrCreateArgv = Arguments<PrCreateOptions>

export const command = 'pr create'

/**
 * Command line options via yargs
 */
export const options = {
  b: {
    type: 'string',
    alias: 'base',
    description: 'Base branch to open the PR against (defaults to the repo default branch)',
  },
  d: {
    type: 'boolean',
    alias: 'draft',
    description: 'Open the pull request as a draft',
    default: false,
  },
  title: {
    type: 'string',
    description: 'Use this PR title instead of generating one',
  },
  body: {
    type: 'string',
    description: 'Use this PR body instead of generating one',
  },
  w: {
    type: 'boolean',
    alias: 'web',
    description: 'Open the created pull request in the browser',
    default: false,
  },
  i: {
    type: 'boolean',
    alias: 'interactive',
    description: 'Review (and optionally edit) the generated title/body before creating',
  },
  dryRun: {
    type: 'boolean',
    description: 'Print the generated title/body without creating the pull request',
    default: false,
  },
  // `--json` is a global flag (see src/index.ts).
} as Record<string, Options>

export const builder = (yargs: Argv) => {
  return yargs.options(options).usage(getCommandUsageHeader(command))
}
