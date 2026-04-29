import { LogInkFocus } from './inkViewModel'

export type LogInkCommandId =
  | 'clearSearch'
  | 'commandPalette'
  | 'focusNext'
  | 'focusPrevious'
  | 'help'
  | 'moveDown'
  | 'moveUp'
  | 'pageDown'
  | 'pageUp'
  | 'quit'
  | 'refresh'
  | 'search'
  | 'toggleGraph'

export type LogInkKeyBinding = {
  id: LogInkCommandId
  keys: string[]
  label: string
  description: string
  contexts: Array<'normal' | 'search' | LogInkFocus>
}

export type LogInkHelpSection = {
  title: string
  bindings: LogInkKeyBinding[]
}

export type LogInkCommandPaletteItem = {
  id: LogInkCommandId
  keys: string
  label: string
  description: string
}

export const LOG_INK_KEY_BINDINGS: LogInkKeyBinding[] = [
  {
    id: 'moveUp',
    keys: ['up', 'k'],
    label: 'move up',
    description: 'Move the current selection up.',
    contexts: ['normal', 'commits', 'sidebar'],
  },
  {
    id: 'moveDown',
    keys: ['down', 'j'],
    label: 'move down',
    description: 'Move the current selection down.',
    contexts: ['normal', 'commits', 'sidebar'],
  },
  {
    id: 'pageUp',
    keys: ['page up'],
    label: 'page up',
    description: 'Move a page up in the commit list.',
    contexts: ['commits'],
  },
  {
    id: 'pageDown',
    keys: ['page down'],
    label: 'page down',
    description: 'Move a page down in the commit list.',
    contexts: ['commits'],
  },
  {
    id: 'focusNext',
    keys: ['tab'],
    label: 'focus',
    description: 'Move focus to the next panel.',
    contexts: ['normal'],
  },
  {
    id: 'focusPrevious',
    keys: ['shift+tab'],
    label: 'focus back',
    description: 'Move focus to the previous panel.',
    contexts: ['normal'],
  },
  {
    id: 'search',
    keys: ['/'],
    label: 'search',
    description: 'Filter commits by hash, author, ref, or message.',
    contexts: ['normal'],
  },
  {
    id: 'clearSearch',
    keys: ['ctrl+u'],
    label: 'clear',
    description: 'Clear the active search filter.',
    contexts: ['search'],
  },
  {
    id: 'toggleGraph',
    keys: ['g'],
    label: 'graph',
    description: 'Toggle compact and full graph display.',
    contexts: ['normal', 'commits'],
  },
  {
    id: 'refresh',
    keys: ['r'],
    label: 'refresh',
    description: 'Refresh repository context and selected commit details.',
    contexts: ['normal'],
  },
  {
    id: 'help',
    keys: ['?'],
    label: 'help',
    description: 'Open or close the help panel.',
    contexts: ['normal'],
  },
  {
    id: 'commandPalette',
    keys: [':'],
    label: 'commands',
    description: 'Open the command palette for less common actions.',
    contexts: ['normal'],
  },
  {
    id: 'quit',
    keys: ['q', 'ctrl+c'],
    label: 'quit',
    description: 'Quit the interactive log.',
    contexts: ['normal', 'search'],
  },
]

export type GetLogInkFooterHintsOptions = {
  filterMode: boolean
  focus: LogInkFocus
  showHelp: boolean
  showCommandPalette?: boolean
}

export function formatBindingKeys(binding: LogInkKeyBinding): string {
  return binding.keys.join('/')
}

export function getLogInkFooterHints(options: GetLogInkFooterHintsOptions): string[] {
  if (options.filterMode) {
    return ['enter apply', 'esc cancel', 'ctrl+u clear', 'q quit']
  }

  if (options.showHelp) {
    return ['? close', 'tab focus', '/ search', 'q quit']
  }

  if (options.showCommandPalette) {
    return [': close', 'r refresh', 'g graph', '? help', 'q quit']
  }

  if (options.focus === 'sidebar') {
    return ['↑/↓ tab', 'tab focus', '/ search', '? help', 'q quit']
  }

  if (options.focus === 'detail') {
    return ['tab focus', 'g graph', 'r refresh', '? help', 'q quit']
  }

  return ['↑/↓ move', '/ search', 'tab focus', 'g graph', '? help']
}

export function getLogInkHelpSections(): LogInkHelpSection[] {
  return [
    {
      title: 'Navigation',
      bindings: LOG_INK_KEY_BINDINGS.filter((binding) =>
        ['moveUp', 'moveDown', 'pageUp', 'pageDown', 'focusNext', 'focusPrevious'].includes(binding.id)
      ),
    },
    {
      title: 'Browsing',
      bindings: LOG_INK_KEY_BINDINGS.filter((binding) =>
        ['search', 'clearSearch', 'toggleGraph', 'refresh'].includes(binding.id)
      ),
    },
    {
      title: 'Global',
      bindings: LOG_INK_KEY_BINDINGS.filter((binding) =>
        ['help', 'commandPalette', 'quit'].includes(binding.id)
      ),
    },
  ]
}

export function getLogInkCommandPaletteItems(): LogInkCommandPaletteItem[] {
  return LOG_INK_KEY_BINDINGS.map((binding) => ({
    id: binding.id,
    keys: formatBindingKeys(binding),
    label: binding.label,
    description: binding.description,
  }))
}
