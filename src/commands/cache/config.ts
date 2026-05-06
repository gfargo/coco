import { Arguments, Argv } from 'yargs'
import { getCommandUsageHeader } from '../../lib/ui/helpers'
import { BaseCommandOptions } from '../types'

export interface CacheOptions extends BaseCommandOptions {}

export type CacheArgv = Arguments<CacheOptions>

export const command = 'cache <subcommand>'

export const builder = (yargs: Argv) => {
  return yargs
    .positional('subcommand', {
      describe: 'Cache action to run (clear, info)',
      type: 'string',
      choices: ['clear', 'info'] as const,
    })
    .usage(getCommandUsageHeader(command))
}
