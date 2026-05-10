import { Arguments, Argv, Options } from 'yargs'
import { getCommandUsageHeader } from '../../lib/ui/helpers'
import { LogInkThemePreset } from '../../workstation/chrome/theme'
import { BaseCommandOptions } from '../types'

export type UiView = 'history' | 'status' | 'diff'

export interface UiOptions extends BaseCommandOptions {
  all?: boolean
  branch?: string
  limit?: number
  path?: string | string[]
  theme?: LogInkThemePreset
  view?: UiView
}

export type UiArgv = Arguments<UiOptions>

export const command = 'ui'

export const options = {
  view: {
    description: 'Initial TUI surface',
    choices: ['history', 'status', 'diff'],
    default: 'history',
  },
  all: {
    description: 'Load commits from all local and remote refs in history mode',
    type: 'boolean',
    default: false,
  },
  branch: {
    description: 'Load history reachable from a branch or ref',
    type: 'string',
    alias: 'b',
  },
  limit: {
    description: 'Maximum number of history commits to load initially',
    type: 'number',
    alias: 'n',
  },
  path: {
    description: 'Filter history by changed path',
    type: 'array',
  },
  theme: {
    description: 'TUI theme preset',
    choices: ['default', 'monochrome', 'catppuccin', 'gruvbox'],
  },
} as Record<string, Options>

export const builder = (yargs: Argv) => {
  return yargs.options(options).usage(getCommandUsageHeader(command))
}
