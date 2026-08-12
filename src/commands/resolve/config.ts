import { Arguments, Argv, Options } from 'yargs'
import { getCommandUsageHeader } from '../../lib/ui/helpers'
import { BaseCommandOptions } from '../types'

export const CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const
export type ConfidenceLevel = typeof CONFIDENCE_LEVELS[number]

export interface ResolveOptions extends BaseCommandOptions {
  /** Resolve only this conflicted file instead of every conflicted file. */
  file?: string
  /** Preview proposals without applying or staging anything. */
  dryRun?: boolean
  /** Auto-apply proposals at/above --confidence instead of prompting per region. */
  apply?: boolean
  confidence?: ConfidenceLevel
}

export type ResolveArgv = Arguments<ResolveOptions>

export const command = 'resolve'

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
  return yargs.options(options).usage(getCommandUsageHeader(command))
}
