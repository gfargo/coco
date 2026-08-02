import { Arguments, Argv, Options } from 'yargs'
import { getCommandUsageHeader } from '../../lib/ui/helpers'
import { BaseCommandOptions } from '../types'

export interface DoctorOptions extends BaseCommandOptions {
  fix?: boolean
  cost?: boolean
  clear?: boolean
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
  clear: {
    description: 'Delete the local usage-stats ledger that `--cost` reads',
    type: 'boolean',
    default: false,
  },
  // `--json` is a global flag (see src/index.ts).
} as Record<string, Options>

export const builder = (yargs: Argv) => {
  return yargs
    .options(options)
    .check((argv) => {
      const a = argv as { clear?: boolean; cost?: boolean; fix?: boolean }
      const picked = [a.clear && '--clear', a.cost && '--cost', a.fix && '--fix'].filter(Boolean)
      if (picked.length > 1) {
        throw new Error(`Options ${picked.join(', ')} cannot be used together.`)
      }
      return true
    })
    .usage(getCommandUsageHeader(command))
}
