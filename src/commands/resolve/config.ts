import { Arguments, Argv, Options } from 'yargs'
import { getCommandUsageHeader } from '../../lib/ui/helpers'
import { BaseCommandOptions } from '../types'

export interface ResolveOptions extends BaseCommandOptions {
  subcommand?: string
  file?: string
  apply?: boolean
  dryRun?: boolean
  confidence?: number
}

export type ResolveArgv = Arguments<ResolveOptions>

/**
 * Subcommand vocabulary for `coco resolve`. A bare `coco resolve` (no
 * subcommand) runs default resolve mode — the positional stays optional
 * (unlike `cache <subcommand>`) so that mode has a spelling.
 */
export const RESOLVE_SUBCOMMANDS = ['status', 'explain'] as const

export type ResolveSubcommand = typeof RESOLVE_SUBCOMMANDS[number]

export const command = 'resolve [subcommand]'

/**
 * Command line options via yargs
 */
export const options = {
  file: {
    type: 'string',
    description: 'Target a specific conflicted file instead of all of them.',
  },
  apply: {
    type: 'boolean',
    description: 'Apply the AI-proposed resolution instead of previewing it.',
  },
  'dry-run': {
    type: 'boolean',
    description: 'Preview the proposed resolution without writing changes.',
  },
  confidence: {
    type: 'number',
    description: 'Minimum confidence (0-1) required to auto-apply a resolution.',
  },
  // `--json` is a global flag (see src/index.ts).
} as Record<string, Options>

export const builder = (yargs: Argv) => {
  return yargs
    .positional('subcommand', {
      describe: 'Resolve action to run (status, explain). Omit to resolve conflicts directly.',
      type: 'string',
      choices: RESOLVE_SUBCOMMANDS,
    })
    .options(options)
    .usage(getCommandUsageHeader(command))
}
