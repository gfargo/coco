import { Arguments, Argv, Options } from 'yargs'
import { getCommandUsageHeader } from '../../lib/ui/helpers'
import { BaseCommandOptions } from '../types'

export interface DoctorOptions extends BaseCommandOptions {
  fix?: boolean
}

export type DoctorArgv = Arguments<DoctorOptions>

export const command = 'doctor'

export const options = {
  fix: {
    description: 'Attempt to auto-fix detected issues and write the updated config',
    type: 'boolean',
    default: false,
  },
} as Record<string, Options>

export const builder = (yargs: Argv) => {
  return yargs.options(options).usage(getCommandUsageHeader(command))
}
