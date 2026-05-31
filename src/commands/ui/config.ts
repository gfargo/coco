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
  // `repo` (alias `cwd`) is inherited from BaseCommandOptions — declared
  // globally at the yargs root so every subcommand sees it.
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
    description:
      'Load commits from all local and remote refs in history mode. Defaults to true so the history view shows the full multi-ref graph (branches, tags, stashes) out of the box; pass `--no-all` to scope to the current branch only.',
    type: 'boolean',
    default: true,
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
    choices: ['default', 'monochrome', 'catppuccin', 'gruvbox', 'dracula', 'nord', 'solarized-dark', 'tokyo-night', 'one-dark', 'rose-pine', 'kanagawa', 'everforest', 'monokai', 'synthwave', 'ayu-dark', 'palenight', 'github-dark', 'horizon', 'nightfox', 'carbonfox', 'tokyonight-storm', 'catppuccin-latte', 'solarized-light', 'github-light', 'iceberg', 'material-ocean', 'moonlight', 'poimandres', 'vitesse-dark', 'vesper', 'flexoki', 'mellow', 'night-owl', 'cobalt2', 'oceanic-next', 'catppuccin-macchiato', 'gruvbox-light', 'tokyo-night-day', 'one-light', 'ayu-light', 'rose-pine-dawn', 'everforest-light', 'vitesse-light', 'dayfox', 'night-owl-light', 'flexoki-light', 'material-lighter', 'papercolor-light', 'modus-operandi', 'quiet-light'],
  },
} as Record<string, Options>

export const builder = (yargs: Argv) => {
  return yargs.options(options).usage(getCommandUsageHeader(command))
}
