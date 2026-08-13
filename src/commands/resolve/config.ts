import { Arguments, Argv, Options } from 'yargs'
import { getCommandUsageHeader } from '../../lib/ui/helpers'
import { BaseCommandOptions } from '../types'

export const CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const
export type ConfidenceLevel = typeof CONFIDENCE_LEVELS[number]

export const RESOLVE_SUBCOMMANDS = ['status', 'explain'] as const
export type ResolveSubcommand = typeof RESOLVE_SUBCOMMANDS[number]

export interface ResolveOptions extends BaseCommandOptions {
  /** `status` | `explain`, or omitted for the default AI-resolution flow. */
  subcommand?: ResolveSubcommand
  /** Resolve only this conflicted file instead of every conflicted file. */
  file?: string
  /** Preview proposals without applying or staging anything. */
  dryRun?: boolean
  /** Auto-apply proposals at/above --confidence instead of prompting per region. */
  apply?: boolean
  confidence?: ConfidenceLevel
}

export type ResolveArgv = Arguments<ResolveOptions>

export const command = 'resolve [subcommand]'

export const options = {
  file: {
    type: 'string',
    description: 'Resolve only this conflicted file instead of all of them.',
  },
  'dry-run': {
    type: 'boolean',
    description: 'Preview AI-proposed resolutions without applying or staging anything.',
    default: false,
  },
  apply: {
    type: 'boolean',
    description: 'Auto-apply AI-proposed resolutions at/above --confidence instead of prompting per region.',
    default: false,
  },
  confidence: {
    type: 'string',
    choices: CONFIDENCE_LEVELS,
    description: 'Minimum confidence required to auto-apply a resolution with --apply.',
    default: 'medium',
  },
} as Record<string, Options>

export const builder = (yargs: Argv) => {
  return yargs
    .positional('subcommand', {
      describe: 'Subcommand to run: `status` (report conflict state) or `explain` (describe a conflict). Omit for the default AI-resolution flow.',
      type: 'string',
      choices: RESOLVE_SUBCOMMANDS,
    })
    .options(options)
    .usage(getCommandUsageHeader(command))
}
