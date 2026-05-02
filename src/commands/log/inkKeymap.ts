import { LogInkFocus, LogInkView } from './inkViewModel'
import {
  LogInkWorkflowAction,
  LogInkWorkflowActionKind,
  getLogInkWorkflowActions,
} from './inkWorkflows'

export type LogInkCommandId =
  | 'clearSearch'
  | 'commandPalette'
  | 'commit'
  | 'cycleSort'
  | 'editCommit'
  | 'focusNext'
  | 'focusPrevious'
  | 'help'
  | 'moveDown'
  | 'moveToBottom'
  | 'moveToTop'
  | 'navigateBack'
  | 'navigateBranches'
  | 'navigateCompose'
  | 'navigateDiff'
  | 'navigateHome'
  | 'navigateStash'
  | 'navigateWorktrees'
  | 'navigateStatus'
  | 'navigateTags'
  | 'nextHunk'
  | 'nextMatch'
  | 'nextSidebarTab'
  | 'moveUp'
  | 'openSelected'
  | 'pageDown'
  | 'pageUp'
  | 'previousHunk'
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
    description: 'Move to the previous repository sidebar tab (outside diff view).',
    contexts: ['sidebar'],
  },
  {
    id: 'nextSidebarTab',
    keys: [']'],
    label: 'next tab',
    description: 'Move to the next repository sidebar tab (outside diff view).',
    contexts: ['sidebar'],
  },
  {
    id: 'previousHunk',
    keys: ['['],
    label: 'previous hunk',
    description: 'Jump to the previous diff hunk in the current diff view.',
    contexts: ['commits'],
  },
  {
    id: 'nextHunk',
    keys: [']'],
    label: 'next hunk',
    description: 'Jump to the next diff hunk in the current diff view.',
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
    keys: ['\\'],
    label: 'graph',
    description: 'Toggle compact and full graph display.',
    contexts: ['normal', 'commits'],
  },
  {
    id: 'navigateHome',
    keys: ['gh'],
    label: 'home',
    description: 'Jump to the history root view (clears the navigation stack).',
    contexts: ['normal'],
  },
  {
    id: 'navigateStatus',
    keys: ['gs'],
    label: 'status',
    description: 'Push the working-tree status view onto the navigation stack.',
    contexts: ['normal'],
  },
  {
    id: 'navigateDiff',
    keys: ['gd'],
    label: 'diff',
    description: 'Push the diff view for the selected commit or file.',
    contexts: ['normal'],
  },
  {
    id: 'navigateCompose',
    keys: ['gc'],
    label: 'compose',
    description: 'Push the commit-compose view (draft + staged-files summary).',
    contexts: ['normal'],
  },
  {
    id: 'navigateBranches',
    keys: ['gb'],
    label: 'branches',
    description: 'Push the branches view (local branches with divergence info).',
    contexts: ['normal'],
  },
  {
    id: 'navigateTags',
    keys: ['gt'],
    label: 'tags',
    description: 'Push the tags view.',
    contexts: ['normal'],
  },
  {
    id: 'navigateStash',
    keys: ['gz'],
    label: 'stash',
    description: 'Push the stash view (gz; gs is reserved for status).',
    contexts: ['normal'],
  },
  {
    id: 'navigateWorktrees',
    keys: ['gw'],
    label: 'worktrees',
    description: 'Push the linked worktrees view.',
    contexts: ['normal'],
  },
  {
    id: 'navigateBack',
    keys: ['<', 'esc'],
    label: 'back',
    description: 'Pop the navigation stack and return to the previous view.',
    contexts: ['normal'],
  },
  {
    id: 'openSelected',
    keys: ['enter'],
    label: 'open',
    description: 'Open the diff for the selected commit (history) or file (status).',
    contexts: ['commits'],
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
    id: 'cycleSort',
    keys: ['s'],
    label: 'sort',
    description: 'Cycle the sort mode in branches (name/recent/ahead) or tags (recent/name).',
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
  /** Used to differentiate the diff-view hints between commit / worktree
   *  / stash sources without reaching into runtime state. */
  diffSource?: 'commit' | 'worktree' | 'stash'
  filterMode: boolean
  focus: LogInkFocus
  showHelp: boolean
  showCommandPalette?: boolean
  /** Set when the user has pressed a chord prefix (e.g. `g`) and the
   * dispatcher is waiting for the second key. The footer surfaces the
   * available continuations inline as a fallback for the popup overlay. */
  pendingKey?: string
}

export type LogInkChordContinuation = {
  /** Single character — the second key in the chord (e.g. `h` for `gh`). */
  key: string
  label: string
  description: string
}

/**
 * Surface the second-key continuations for a chord prefix (e.g. `g`)
 * as a flat list, sourced from the canonical keymap so the help, footer
 * hint, and which-key overlay all stay in sync. Continuations are sorted
 * by key for stable, scannable output.
 */
export function getLogInkChordContinuations(prefix: string): LogInkChordContinuation[] {
  const continuations: LogInkChordContinuation[] = []
  for (const binding of LOG_INK_KEY_BINDINGS) {
    for (const keys of binding.keys) {
      if (keys.length === 2 && keys.startsWith(prefix)) {
        continuations.push({
          key: keys.charAt(1),
          label: binding.label,
          description: binding.description,
        })
        break
      }
    }
  }
  return continuations.sort((a, b) => a.key.localeCompare(b.key))
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
  'navigateHome',
  'navigateStatus',
  'navigateDiff',
  'navigateCompose',
  'navigateBranches',
  'navigateTags',
  'navigateStash',
  'navigateWorktrees',
  'navigateBack',
]

const NORMAL_GLOBAL_HINTS = ['g jump', '< back', '? help', ': cmds', 'q quit']

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

  // Trailing back-hint (P2.5) reminds the user how to walk back when
  // they're nested deeper than the root view.
  return `${viewStack.join(' › ')}   ← <`
}

export function getLogInkFooterHints(options: GetLogInkFooterHintsOptions): LogInkFooterHints {
  if (options.pendingKey) {
    const continuations = getLogInkChordContinuations(options.pendingKey)
    if (continuations.length > 0) {
      return {
        contextual: [
          `${options.pendingKey} …`,
          ...continuations.map((entry) => `${entry.key} ${entry.label}`),
        ],
        global: ['esc cancel'],
      }
    }
  }

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
    if (options.diffSource === 'stash') {
      return {
        contextual: ['j/k lines', '[/] file', 'c cherry-pick', 'o edit', 'esc back'],
        global: NORMAL_GLOBAL_HINTS,
      }
    }
    if (options.diffSource === 'commit') {
      // Commit-diff explore: read-only diff, but `c` cherry-picks the
      // cursored file from the commit into the worktree.
      return {
        contextual: ['j/k hunks', '[/] file', 'c cherry-pick', 'esc back'],
        global: NORMAL_GLOBAL_HINTS,
      }
    }
    return {
      contextual: ['j/k hunks', 'space stage', 'z revert', 'o edit', 'e/c compose', 'esc files'],
      global: NORMAL_GLOBAL_HINTS,
    }
  }

  if (options.activeView === 'compose') {
    return {
      contextual: ['e edit', 'c commit', 'I AI draft', 'gs hunks', 'esc back'],
      global: NORMAL_GLOBAL_HINTS,
    }
  }

  if (options.activeView === 'branches') {
    return {
      contextual: ['↑/↓ branches', 'enter checkout', '+ new', 'D delete', 's sort'],
      global: NORMAL_GLOBAL_HINTS,
    }
  }

  if (options.activeView === 'tags') {
    return {
      contextual: ['↑/↓ tags', '+ new', 'P push', 'T delete', 's sort'],
      global: NORMAL_GLOBAL_HINTS,
    }
  }

  if (options.activeView === 'stash') {
    return {
      contextual: ['↑/↓ stashes', 'enter diff', 'a apply', 'p pop', 'X drop'],
      global: NORMAL_GLOBAL_HINTS,
    }
  }

  if (options.activeView === 'worktrees') {
    return {
      contextual: ['↑/↓ worktrees', 'W remove', 'esc back'],
      global: NORMAL_GLOBAL_HINTS,
    }
  }

  return {
    contextual: ['↑/↓ move', 'enter diff', 'c cherry-pick', '/ search', 'gg/G top/bottom'],
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

/**
 * Unified palette command type — covers both keybinding-derived commands
 * (`'binding'`) and workflow actions (`'workflow'`). The palette renderer
 * iterates these and the executor dispatches the right events for each.
 */
export type LogInkPaletteCommandKind = 'binding' | 'workflow'

export type LogInkPaletteCommand = {
  id: string
  kind: LogInkPaletteCommandKind
  keys: string
  label: string
  description: string
  workflowKind?: LogInkWorkflowActionKind
  requiresConfirmation?: boolean
}

function bindingToPaletteCommand(binding: LogInkKeyBinding): LogInkPaletteCommand {
  return {
    id: binding.id,
    kind: 'binding',
    keys: formatBindingKeys(binding),
    label: binding.label,
    description: binding.description,
  }
}

function workflowToPaletteCommand(action: LogInkWorkflowAction): LogInkPaletteCommand {
  return {
    id: action.id,
    kind: 'workflow',
    keys: action.key,
    label: action.label,
    description: action.description,
    workflowKind: action.kind,
    requiresConfirmation: action.requiresConfirmation,
  }
}

/**
 * The full palette command set: every keybinding plus every workflow
 * action. Phase 6 onwards, both surfaces are filterable and executable
 * from `:`.
 */
export function getLogInkPaletteCommands(): LogInkPaletteCommand[] {
  return [
    ...LOG_INK_KEY_BINDINGS.map(bindingToPaletteCommand),
    ...getLogInkWorkflowActions().map(workflowToPaletteCommand),
  ]
}

function paletteSearchableFields(command: LogInkPaletteCommand): string[] {
  return [command.label, command.description, command.keys, command.id]
}

function scorePaletteCommand(command: LogInkPaletteCommand, term: string): number | undefined {
  const normalized = term.trim().toLowerCase()
  if (!normalized) {
    return 0
  }

  let best: number | undefined
  for (const raw of paletteSearchableFields(command)) {
    const value = raw.toLowerCase()

    if (value === normalized) {
      return 1000
    }

    if (value.startsWith(normalized)) {
      const fieldScore = 800 - Math.min(value.length - normalized.length, 200)
      best = best === undefined ? fieldScore : Math.max(best, fieldScore)
      continue
    }

    const substringIndex = value.indexOf(normalized)
    if (substringIndex >= 0) {
      const fieldScore = 600 - Math.min(substringIndex, 200)
      best = best === undefined ? fieldScore : Math.max(best, fieldScore)
      continue
    }

    let searchIndex = 0
    let distance = 0
    let matched = true

    for (const character of normalized) {
      const nextIndex = value.indexOf(character, searchIndex)
      if (nextIndex < 0) {
        matched = false
        break
      }
      distance += nextIndex - searchIndex
      searchIndex = nextIndex + 1
    }

    if (matched) {
      const fieldScore = 300 - Math.min(distance, 200)
      best = best === undefined ? fieldScore : Math.max(best, fieldScore)
    }
  }

  return best
}

/**
 * Filter and sort the palette command list by user query.
 *   - Empty filter: float `recent` IDs to the top, preserve registry order
 *     for everything else.
 *   - Non-empty filter: fuzzy score, descending; ties broken by registry
 *     order. Commands that don't match are dropped.
 */
export function filterLogInkPaletteCommands(
  commands: LogInkPaletteCommand[],
  filter: string,
  recent: string[]
): LogInkPaletteCommand[] {
  if (!filter.trim()) {
    if (recent.length === 0) {
      return [...commands]
    }
    const recentIndex = new Map(recent.map((id, index) => [id, index]))
    const recentCommands: LogInkPaletteCommand[] = []
    const others: LogInkPaletteCommand[] = []
    for (const command of commands) {
      if (recentIndex.has(command.id)) {
        recentCommands.push(command)
      } else {
        others.push(command)
      }
    }
    recentCommands.sort((a, b) => (recentIndex.get(a.id) || 0) - (recentIndex.get(b.id) || 0))
    return [...recentCommands, ...others]
  }

  return commands
    .map((command, index) => ({
      command,
      index,
      score: scorePaletteCommand(command, filter),
    }))
    .filter((entry): entry is { command: LogInkPaletteCommand; index: number; score: number } =>
      entry.score !== undefined
    )
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.command)
}
