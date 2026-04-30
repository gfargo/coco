import { LogInkFocus } from './inkViewModel'

export type LogInkCommandId =
  | 'clearSearch'
  | 'commandPalette'
  | 'focusNext'
  | 'focusPrevious'
  | 'help'
  | 'moveDown'
  | 'moveToBottom'
  | 'moveToTop'
  | 'nextMatch'
  | 'nextSidebarTab'
  | 'moveUp'
  | 'pageDown'
  | 'pageUp'
  | 'previousMatch'
  | 'previousSidebarTab'
  | 'quit'
  | 'refresh'
  | 'search'
  | 'toggleGraph'
  | 'workflowActions'

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
    id: 'moveToTop',
    keys: ['gg'],
    label: 'top',
    description: 'Jump to the first visible commit.',
    contexts: ['commits'],
  },
  {
    id: 'moveToBottom',
    keys: ['G'],
    label: 'bottom',
    description: 'Jump to the last visible commit.',
    contexts: ['commits'],
  },
  {
    id: 'nextMatch',
    keys: ['n'],
    label: 'next match',
    description: 'Move to the next visible search result.',
    contexts: ['commits'],
  },
  {
    id: 'previousMatch',
    keys: ['N'],
    label: 'previous match',
    description: 'Move to the previous visible search result.',
    contexts: ['commits'],
  },
  {
    id: 'previousSidebarTab',
    keys: ['['],
    label: 'previous tab',
    description: 'Move to the previous repository sidebar tab.',
    contexts: ['sidebar'],
  },
  {
    id: 'nextSidebarTab',
    keys: [']'],
    label: 'next tab',
    description: 'Move to the next repository sidebar tab.',
    contexts: ['sidebar'],
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
    id: 'workflowActions',
    keys: ['D', 'T', 'X', 'W', 'A', 'I', 'M'],
    label: 'workflows',
    description: 'Open workflow actions with confirmation for destructive or AI operations.',
    contexts: ['normal', 'sidebar', 'detail'],
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
    return [': close', 'D/T/X confirm', 'I/M AI', '? help', 'q quit']
  }

  if (options.focus === 'sidebar') {
    return ['[/] tab', '1-5 jump', 'tab focus', '/ search', '? help']
  }

  if (options.focus === 'detail') {
    return ['↑/↓ files', 'pgup/pgdn diff', 'tab focus', '? help', 'q quit']
  }

  return ['↑/↓ move', '/ search', 'gg/G top/bottom', 'n/N next', '? help']
}

export function getLogInkHelpSections(): LogInkHelpSection[] {
  return [
    {
      title: 'Navigation',
      bindings: LOG_INK_KEY_BINDINGS.filter((binding) =>
        [
          'moveUp',
          'moveDown',
          'pageUp',
          'pageDown',
          'moveToTop',
          'moveToBottom',
          'nextMatch',
          'previousMatch',
          'focusNext',
          'focusPrevious',
          'previousSidebarTab',
          'nextSidebarTab',
        ].includes(binding.id)
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
        ['help', 'commandPalette', 'workflowActions', 'quit'].includes(binding.id)
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
