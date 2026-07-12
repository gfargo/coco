import { Arguments, Argv, Options } from 'yargs'
import { getCommandUsageHeader } from '../../lib/ui/helpers'
import { BaseCommandOptions } from '../types'

export interface PrCreateOptions extends BaseCommandOptions {
  /** Positional pr action. Only `'create'` is valid; enforced via `.check()` in the builder. */
  action?: 'create'
  base?: string
  draft?: boolean
  title?: string
  body?: string
  web?: boolean
  interactive: boolean
  dryRun?: boolean
}

export type PrCreateArgv = Arguments<PrCreateOptions>

/**
 * Only `create` is a valid `pr` action today. The command string declares an
 * optional positional (`[action]`, validated below via `.check()`) with an
 * explicit `choices` list on top of it — rather than the bare literal
 * `'pr create'`, which yargs parses as `pr` plus an unconstrained *required*
 * positional named `create` that matches ANY value (#1580). `coco pr
 * close`/`list`/`view` now fail with an "Invalid values" error instead of
 * silently creating a pull request, and bare `coco pr` names the valid
 * action instead of yargs' generic arity error.
 */
export const command = 'pr [action]'

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
  return yargs
    .positional('action', {
      describe: 'Pull request action to run',
      type: 'string',
      choices: ['create'] as const,
    })
    .check((argv) => {
      if (!argv.action) {
        throw new Error('Missing required pr action. Valid actions: create')
      }
      return true
    })
    .options(options)
    .usage(getCommandUsageHeader(command))
}
