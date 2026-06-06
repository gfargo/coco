import { Arguments, Argv, Options } from 'yargs'

import { getCommandUsageHeader } from '../../lib/ui/helpers'
import { getLogInkThemePresets, LogInkThemePreset } from '../../workstation/chrome/theme'
import { BaseCommandOptions } from '../types'

export interface WorkspaceOptions extends BaseCommandOptions {
  /**
   * Override `workspace.roots` from config. Repeatable.
   */
  root?: string | string[]
  /** Recursion depth into each root. */
  maxDepth?: number
  /** TUI theme preset. */
  theme?: LogInkThemePreset
}

export type WorkspaceArgv = Arguments<WorkspaceOptions>

export const command = ['workspace', 'ws']

export const options = {
  root: {
    description:
      'Directory to scan for repositories. Overrides `workspace.roots` from config. Repeatable.',
    type: 'array',
    alias: 'r',
  },
  maxDepth: {
    description: 'Maximum recursion depth into each root. Defaults to 3.',
    type: 'number',
  },
  theme: {
    description: 'TUI theme preset',
    // Derived from the single source of truth (`THEME_PRESET_COLORS`) so the
    // workspace CLI choices stay in sync with the themes the picker offers.
    choices: getLogInkThemePresets(),
  },
} as Record<string, Options>

export const builder = (yargs: Argv): Argv => {
  return yargs.options(options).usage(getCommandUsageHeader('workspace'))
}
