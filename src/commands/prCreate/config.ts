import { Arguments, Argv, Options } from 'yargs'
import { getCommandUsageHeader } from '../../lib/ui/helpers'
import { BaseCommandOptions } from '../types'

export interface PrCreateOptions extends BaseCommandOptions {
  /** Positional pr action. Only `'create'` is valid, enforced via yargs' native `choices`. */
  action: 'create'
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
 * Only `create` is a valid `pr` action today. The command string declares a
 * required positional (`<action>`) constrained by an explicit `choices`
 * list — mirroring `cache <subcommand>` (`cache/config.ts`) — rather than
 * the bare literal `'pr create'`, which yargs parses as `pr` plus an
 * unconstrained positional named `create` that matches ANY value (#1580).
 * `coco pr close`/`list`/`view` fail with yargs' native "Invalid values"
 * error instead of silently creating a pull request, and bare `coco pr`
 * fails with yargs' native "Not enough non-option arguments" error — no
 * hand-rolled `.check()` needed for either case.
 */
export const command = 'pr <action>'

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
    .options(options)
    .usage(getCommandUsageHeader(command))
}
