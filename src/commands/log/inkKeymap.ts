import { LogInkFocus, LogInkView } from './inkViewModel'

export type LogInkCommandId =
  | 'clearSearch'
  | 'commandPalette'
  | 'commit'
  | 'editCommit'
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
  | 'revertSelection'
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
    id: 'revertSelection',
    keys: ['z'],
    label: 'revert',
    description: 'Ask to revert the selected file or hunk.',
    contexts: ['commits'],
  },
  {
    id: 'editCommit',
    keys: ['e'],
    label: 'edit commit',
    description: 'Edit the manual commit summary or body.',
    contexts: ['commits'],
  },
  {
    id: 'commit',
    keys: ['c'],
    label: 'commit',
    description: 'Create a commit from staged changes with the current draft.',
    contexts: ['commits'],
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
  activeView?: LogInkView
  filterMode: boolean
  focus: LogInkFocus
  showHelp: boolean
  showCommandPalette?: boolean
}

/**
 * Footer hints split into two slots so the chrome can render them in
 * separate spans:
 *   `contextual` — what changes with mode, view, or focus.
 *   `global`     — persistent affordances (help · commands · quit).
 */
export type LogInkFooterHints = {
  contextual: string[]
  global: string[]
}

/**
 * Bindings considered "global" — always available regardless of which view
 * or pane has focus. Surfaced as a separate group in the help overlay and
 * always rendered in the footer's global slot.
 */
const GLOBAL_BINDING_IDS: LogInkCommandId[] = [
  'help',
  'commandPalette',
  'workflowActions',
  'focusNext',
  'focusPrevious',
  'refresh',
  'quit',
]

const NORMAL_GLOBAL_HINTS = ['? help', ': cmds', 'q quit']

export function formatBindingKeys(binding: LogInkKeyBinding): string {
  return binding.keys.join('/')
}

/**
 * Render the navigation `viewStack` as a breadcrumb suitable for the
 * chrome header. A single-frame stack at the root view returns an empty
 * string so the header stays compact when nothing has been pushed.
 *
 * Examples:
 *   `[history]`             → ''
 *   `[history, diff]`       → 'history › diff'
 *   `[status, diff]`        → 'status › diff'
 *   `[history, diff, status]` → 'history › diff › status'
 */
export function formatLogInkBreadcrumb(viewStack: LogInkView[]): string {
  if (viewStack.length === 0) {
    return ''
  }

  if (viewStack.length === 1 && viewStack[0] === 'history') {
    return ''
  }

  return viewStack.join(' › ')
}

export function getLogInkFooterHints(options: GetLogInkFooterHintsOptions): LogInkFooterHints {
  if (options.filterMode) {
    return {
      contextual: ['enter apply', 'esc cancel', 'ctrl+u clear'],
      global: ['q quit'],
    }
  }

  if (options.showHelp) {
    return {
      contextual: ['? close', 'tab focus', '/ search'],
      global: ['q quit'],
    }
  }

  if (options.showCommandPalette) {
    return {
      contextual: [': close', 'D/T/X confirm', 'I/M AI'],
      global: ['? help', 'q quit'],
    }
  }

  if (options.focus === 'sidebar') {
    return {
      contextual: ['[/] tab', '1-5 jump', 'tab focus'],
      global: NORMAL_GLOBAL_HINTS,
    }
  }

  if (options.focus === 'detail') {
    return {
      contextual: ['↑/↓ files', 'pgup/pgdn diff', 'tab focus'],
      global: NORMAL_GLOBAL_HINTS,
    }
  }

  if (options.activeView === 'status') {
    return {
      contextual: ['↑/↓ files', 'enter diff', 'space stage', 'z revert', 'e/c compose'],
      global: NORMAL_GLOBAL_HINTS,
    }
  }

  if (options.activeView === 'diff') {
    return {
      contextual: ['j/k hunks', 'space stage', 'z revert', 'e/c compose', 'esc files'],
      global: NORMAL_GLOBAL_HINTS,
    }
  }

  return {
    contextual: ['↑/↓ move', '/ search', 'gg/G top/bottom', 'n/N next'],
    global: NORMAL_GLOBAL_HINTS,
  }
}

export type GetLogInkHelpSectionsOptions = {
  activeView: LogInkView
  focus: LogInkFocus
}

function bindingMatchesViewContext(
  binding: LogInkKeyBinding,
  options: GetLogInkHelpSectionsOptions
): boolean {
  if (binding.contexts.includes(options.focus)) {
    return true
  }

  if (binding.contexts.includes('normal')) {
    return true
  }

  return false
}

/**
 * Help bindings grouped for the persistent help overlay.
 *
 * Returns two top-level groups:
 *   - `Global` — bindings that work from any view or focus.
 *   - `This view (...)` — bindings relevant to the current view + focus.
 *
 * The active-view label is appended so users always know which section
 * applies to where they currently are.
 */
export function getLogInkHelpSections(
  options: GetLogInkHelpSectionsOptions
): LogInkHelpSection[] {
  const globals = LOG_INK_KEY_BINDINGS.filter((binding) =>
    GLOBAL_BINDING_IDS.includes(binding.id)
  )

  const viewBindings = LOG_INK_KEY_BINDINGS.filter((binding) =>
    !GLOBAL_BINDING_IDS.includes(binding.id) && bindingMatchesViewContext(binding, options)
  )

  return [
    { title: 'Global', bindings: globals },
    { title: `This view (${options.activeView})`, bindings: viewBindings },
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
