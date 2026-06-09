import { Arguments, Argv, Options } from 'yargs'
import { getCommandUsageHeader } from '../../lib/ui/helpers'
import { BaseCommandOptions } from '../types'

export interface DoctorOptions extends BaseCommandOptions {
  fix?: boolean
  cost?: boolean
}

export type DoctorArgv = Arguments<DoctorOptions>

export const command = 'doctor'

export const options = {
  fix: {
    description: 'Attempt to auto-fix detected issues and write the updated config',
    type: 'boolean',
    default: false,
  },
  cost: {
    description:
      'Show the per-task model routing cost profile and (if recorded) aggregated LLM usage',
    type: 'boolean',
    default: false,
  },
  // `--json` is a global flag (see src/index.ts).
} as Record<string, Options>

export const builder = (yargs: Argv) => {
  return yargs.options(options).usage(getCommandUsageHeader(command))
}
