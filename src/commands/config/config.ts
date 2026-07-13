import { Arguments, Argv } from 'yargs'
import { getCommandUsageHeader } from '../../lib/ui/helpers'
import { BaseCommandOptions } from '../types'

export const CONFIG_ACTIONS = ['get', 'set', 'unset', 'list'] as const
export type ConfigAction = typeof CONFIG_ACTIONS[number]

export interface ConfigOptions extends BaseCommandOptions {
  action: ConfigAction
  key?: string
  value?: string
  scope?: 'global' | 'project'
}

export type ConfigArgv = Arguments<ConfigOptions>

export const command = 'config <action> [key] [value]'

export const builder = (yargs: Argv) => {
  return yargs
    .positional('action', {
      describe: 'Config action to run',
      type: 'string',
      choices: CONFIG_ACTIONS,
    })
    .positional('key', {
      describe: 'Dotted config key path (e.g. service.model, logTui.theme.preset)',
      type: 'string',
    })
    .positional('value', {
      describe: 'Value to write (for `set`) — booleans/numbers/JSON are coerced automatically',
      type: 'string',
    })
    .option('scope', {
      type: 'string',
      choices: ['global', 'project'],
      description: 'Which config file to write to (required for `set`/`unset`). `global` is ~/.config/coco/config.json; `project` is .coco.json.',
    })
    .check((argv) => {
      const rawArgv = argv as { action?: string; key?: string; value?: string; scope?: string }
      if ((rawArgv.action === 'get' || rawArgv.action === 'set' || rawArgv.action === 'unset') && !rawArgv.key) {
        throw new Error(`coco config ${rawArgv.action} requires a <key>.`)
      }
      if (rawArgv.action === 'set' && rawArgv.value === undefined) {
        throw new Error('coco config set requires a <value>.')
      }
      if ((rawArgv.action === 'set' || rawArgv.action === 'unset') && !rawArgv.scope) {
        throw new Error(`coco config ${rawArgv.action} requires --scope global|project.`)
      }
      return true
    })
    .usage(getCommandUsageHeader(command))
}
