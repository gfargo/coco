import {
  LogInkPaletteCommand,
  filterLogInkPaletteCommands,
  getLogInkPaletteCommands,
} from './inkKeymap'
import {
  LogInkAction,
  LogInkSidebarTab,
  LogInkState,
  parseLogInkHistoryFetchPrefix,
} from './inkViewModel'
import {
  getLogInkWorkflowActionById,
  getLogInkWorkflowActionByKey,
} from './inkWorkflows'
import { sidebarTabHasSelectableItems } from './inkSidebarSelection'

export type LogInkInputKey = {
  backspace?: boolean
  ctrl?: boolean
  delete?: boolean
  downArrow?: boolean
  escape?: boolean
  leftArrow?: boolean
  meta?: boolean
  pageDown?: boolean
  pageUp?: boolean
  return?: boolean
  rightArrow?: boolean
  shift?: boolean
  tab?: boolean
  upArrow?: boolean
}

export type LogInkInputEvent =
  | { type: 'action'; action: LogInkAction }
  | { type: 'exit' }
  | { type: 'refreshContext' }
  | { type: 'toggleSelectedFileStage' }
  | { type: 'toggleSelectedHunkStage' }
  | { type: 'revertSelectedFile' }
  | { type: 'revertSelectedHunk' }
  | { type: 'createManualCommit' }
  | { type: 'runAiCommitDraft' }
  | { type: 'runWorkflowAction'; id: string; payload?: string }
  | { type: 'openFileInEditor'; path: string }
  | { type: 'yankFromActiveView'; short?: boolean }

export type LogInkInputContext = {
  detailFileCount?: number
  worktreeHunkOffsets?: number[]
  previewLineCount?: number
  worktreeDiffLineCount?: number
  worktreeFileCount?: number
  /**
   * `@@` line offsets within `filePreview.hunks` for the selected commit's
   * file. Lets diff-view j/k/PageUp/PageDown navigate the commit's hunks when
   * no worktree file is in scope.
   */
  commitDiffHunkOffsets?: number[]
  branchCount?: number
  tagCount?: number
  stashCount?: number
  worktreeListCount?: number
  /** Ref of the stash currently under the cursor (e.g. `stash@{0}`). */
  stashSelectedRef?: string
  /**
   * Per-file `diff --git` line offsets inside the active stash diff.
   * Used by `]` / `[` to jump to next / previous file within a stash
   * patch.
   */
  stashDiffFileOffsets?: number[]
  /**
   * Path of the file currently under the diff-view cursor in a stash
   * patch. Used by `c` (cherry-pick) to know which path to materialize.
   */
  stashDiffSelectedPath?: string
  /**
   * Path of the cursored file in the worktree (status / worktree diff
   * views). Used by `o` (open in $EDITOR).
   */
  worktreeSelectedPath?: string
  /**
   * Path of the cursored file in a commit-diff explore. Used by `c`
   * (cherry-pick file from commit).
   */
  commitDiffSelectedPath?: string
  /**
   * Hash of the commit being explored — pairs with commitDiffSelectedPath
   * so the cherry-pick handler knows which sha to checkout from.
   */
  commitDiffSelectedSha?: string
  /**
   * True when the worktree has any staged, unstaged, or untracked changes.
   * Drives the synthetic "(+) new commit" row at the top of the history
   * list — pressing up at `selectedIndex === 0` transitions onto it; the
   * row is hidden entirely when the worktree is clean.
   */
  worktreeDirty?: boolean
}

function action(actionValue: LogInkAction): LogInkInputEvent {
  return {
    type: 'action',
    action: actionValue,
  }
}

/**
 * Per-entity action-target predicates. The promoted views (`branches`,
 * `tags`, `stash`, `worktrees`) each scope a set of ops to their
 * dedicated surface. The same ops also fire when the user has the
 * sidebar focused on the matching tab — that's how in-sidebar
 * selection (#791 follow-up) lets the user checkout / apply / drop
 * without leaving the workstation view.
 */
function isBranchActionTarget(state: LogInkState): boolean {
  return (state.activeView === 'branches' && state.focus === 'commits') ||
    (state.focus === 'sidebar' && state.sidebarTab === 'branches')
}

function isTagActionTarget(state: LogInkState): boolean {
  return (state.activeView === 'tags' && state.focus === 'commits') ||
    (state.focus === 'sidebar' && state.sidebarTab === 'tags')
}

function isStashActionTarget(state: LogInkState): boolean {
  return (state.activeView === 'stash' && state.focus === 'commits') ||
    (state.focus === 'sidebar' && state.sidebarTab === 'stashes')
}

function isWorktreeActionTarget(state: LogInkState): boolean {
  return (state.activeView === 'worktrees' && state.focus === 'commits') ||
    (state.focus === 'sidebar' && state.sidebarTab === 'worktrees')
}

/**
 * Item count for the active sidebar tab — used by the generic
 * sidebar-Enter handler to decide whether to defer to the per-entity
 * Enter (when items are present and the user is cursoring through
 * them) or to drill into the dedicated view (when the tab is empty
 * or has no per-entity Enter handler defined).
 */
function getSidebarItemCount(
  sidebarTab: LogInkSidebarTab,
  context: LogInkInputContext
): number | undefined {
  switch (sidebarTab) {
    case 'branches': return context.branchCount
    case 'tags': return context.tagCount
    case 'stashes': return context.stashCount
    case 'worktrees': return context.worktreeListCount
    default: return undefined
  }
}

/**
 * Translate a palette command into the same events its keystroke would have
 * produced. Phase 6 makes `:` a real launcher: this is the single mapping
 * from palette IDs to dispatchable behavior.
 */
export function getLogInkPaletteExecuteEvents(
  command: LogInkPaletteCommand,
  state: LogInkState
): LogInkInputEvent[] {
  if (command.kind === 'workflow') {
    if (command.requiresConfirmation) {
      return [action({ type: 'setPendingConfirmation', value: command.id })]
    }
    // Non-confirm workflows are dispatched directly through the runtime
    // workflow runner — same path the keyboard takes. Previously this
    // emitted `setWorkflowAction` only, which set state but never fired
    // the action because nothing in the runtime consumes
    // `workflowActionId`.
    return [{ type: 'runWorkflowAction', id: command.id }]
  }

  // Binding-derived commands. Map each LogInkCommandId to the same events
  // the keystroke would emit. Order matches the keymap registry.
  switch (command.id) {
    case 'moveUp':
      return [action({ type: 'move', delta: -1 })]
    case 'moveDown':
      return [action({ type: 'move', delta: 1 })]
    case 'pageUp':
      return [action({ type: 'page', delta: -10 })]
    case 'pageDown':
      return [action({ type: 'page', delta: 10 })]
    case 'moveToTop':
      return [
        action({ type: 'moveToTop' }),
        action({ type: 'setStatus', value: 'jumped to first commit' }),
      ]
    case 'moveToBottom':
      return [
        action({ type: 'moveToBottom' }),
        action({ type: 'setStatus', value: 'jumped to last commit' }),
      ]
    case 'nextMatch':
      return [action({ type: 'move', delta: 1 })]
    case 'previousMatch':
      return [action({ type: 'move', delta: -1 })]
    case 'previousSidebarTab':
      return [action({ type: 'previousSidebarTab' })]
    case 'nextSidebarTab':
      return [action({ type: 'nextSidebarTab' })]
    case 'previousHunk':
    case 'nextHunk':
      // Palette execution can't reach the live worktree/commit hunk offsets
      // (those live in runtime state, not the reducer). Surface a hint and
      // let the user press the keystroke directly in diff view.
      return [action({
        type: 'setStatus',
        value: 'open the diff view and press [ or ] to jump hunks',
      })]
    case 'focusNext':
      return [action({ type: 'focusNext' })]
    case 'focusPrevious':
      return [action({ type: 'focusPrevious' })]
    case 'search':
      return [action({ type: 'toggleFilterMode' })]
    case 'toggleGraph':
      return [action({ type: 'toggleGraph' })]
    case 'navigateHome':
      return [action({ type: 'navigateHome' })]
    case 'navigateStatus':
      return [action({ type: 'pushView', value: 'status' })]
    case 'navigateDiff':
      return [action({ type: 'pushView', value: 'diff' })]
    case 'navigateCompose':
      return [action({ type: 'pushView', value: 'compose' })]
    case 'navigateBranches':
      return [action({ type: 'pushView', value: 'branches' })]
    case 'navigateTags':
      return [action({ type: 'pushView', value: 'tags' })]
    case 'navigateStash':
      return [action({ type: 'pushView', value: 'stash' })]
    case 'navigateWorktrees':
      return [action({ type: 'pushView', value: 'worktrees' })]
    case 'navigatePullRequest':
      return [action({ type: 'pushView', value: 'pull-request' })]
    case 'navigateBack':
      return [action({ type: 'popView' })]
    case 'openSelected': {
      // From history → diff for selected commit; from status → diff for
      // selected file. Mirrors the enter-key behavior.
      if (state.activeView === 'history' && state.filteredCommits.length > 0) {
        const selected = state.filteredCommits[state.selectedIndex]
        if (selected) {
          return [action({
            type: 'navigateOpenDiffForCommit',
            sha: selected.hash,
            commitIndex: state.selectedIndex,
          })]
        }
      }
      if (state.activeView === 'status') {
        return [action({
          type: 'navigateOpenDiffForWorktreeFile',
          fileIndex: state.selectedWorktreeFileIndex,
        })]
      }
      return []
    }
    case 'refresh':
      return [{ type: 'refreshContext' }]
    case 'revertSelection':
      return [action({ type: 'setPendingMutationConfirmation', value: 'revert-file' })]
    case 'editCommit':
      return [
        ...(state.activeView !== 'compose'
          ? [action({ type: 'pushView', value: 'compose' })]
          : []),
        action({ type: 'commitCompose', action: { type: 'setEditing', value: true } }),
      ]
    case 'commit':
      return [
        ...(state.activeView !== 'compose'
          ? [action({ type: 'pushView', value: 'compose' })]
          : []),
        { type: 'createManualCommit' },
      ]
    case 'help':
      return [action({ type: 'toggleHelp' })]
    case 'commandPalette':
      // Re-toggling closes; the dispatcher will close after execute anyway.
      return []
    case 'workflowActions':
      // Aggregate entry; individual workflows are surfaced separately.
      return []
    case 'quit':
      if (hasUnsavedComposeDraft(state)) {
        return [action({ type: 'setPendingMutationConfirmation', value: 'discard-draft' })]
      }
      return [{ type: 'exit' }]
    case 'clearSearch':
      return [action({ type: 'clearFilter' })]
    case 'cycleSort':
      if (isBranchActionTarget(state)) {
        return [action({ type: 'cycleBranchSort' })]
      }
      if (isTagActionTarget(state)) {
        return [action({ type: 'cycleTagSort' })]
      }
      return [action({
        type: 'setStatus',
        value: 'Sort cycle is available in the branches and tags views',
      })]
    case 'yankClipboard':
      // The runtime resolves the value/label against the live filtered
      // list — palette execute simply fires the same event the keystroke
      // would. Empty active views (no commits / no branches / etc.) are
      // surfaced by the runtime as a "Nothing to yank" status.
      return [{ type: 'yankFromActiveView' }]
    default:
      return []
  }
}

const SIDEBAR_TAB_BY_NUMBER: Record<string, LogInkSidebarTab> = {
  '1': 'status',
  '2': 'branches',
  '3': 'tags',
  '4': 'stashes',
  '5': 'worktrees',
}

/**
 * Returns true when the compose surface holds an unsaved commit message
 * (any text in summary or body and no in-flight AI draft). Used by the
 * quit confirmation flow (P2.3) so users can't lose drafts via a stray
 * `q` / Ctrl+C.
 */
function hasUnsavedComposeDraft(state: LogInkState): boolean {
  const compose = state.commitCompose
  if (compose.loading) {
    return false
  }
  return Boolean(compose.summary.trim() || compose.body.trim())
}

export function getLogInkInputEvents(
  state: LogInkState,
  inputValue: string,
  key: LogInkInputKey = {},
  context: LogInkInputContext = {}
): LogInkInputEvent[] {
  if (key.ctrl && inputValue === 'c') {
    if (hasUnsavedComposeDraft(state) && !state.pendingMutationConfirmation) {
      return [action({ type: 'setPendingMutationConfirmation', value: 'discard-draft' })]
    }
    return [{ type: 'exit' }]
  }

  // Input prompt is the most modal — when active, every keystroke routes
  // into the prompt until Enter (submit) or Esc (cancel). Sits above the
  // filter/confirmation/compose handlers so a prompt opened from inside
  // any of those still captures focus cleanly.
  if (state.inputPrompt) {
    if (key.escape) {
      return [
        action({ type: 'closeInputPrompt' }),
        action({ type: 'setStatus', value: 'cancelled' }),
      ]
    }
    if (key.return) {
      const value = state.inputPrompt.value.trim()
      if (!value) {
        return [action({ type: 'setStatus', value: 'enter a value or press esc to cancel' })]
      }
      // Most prompt kinds dispatch a workflow whose id matches the
      // kind. PR-related prompts forward to a workflow id distinct
      // from the prompt name so the panel can keep its keys
      // mnemonic-friendly while the workflow ids stay descriptive.
      // pr-merge-strategy validates the strategy at the input layer
      // so a typo doesn't surface as a "workflow not yet wired"
      // status downstream.
      if (state.inputPrompt.kind === 'pr-merge-strategy') {
        const strategy = value.toLowerCase()
        if (strategy !== 'merge' && strategy !== 'squash' && strategy !== 'rebase') {
          return [action({
            type: 'setStatus',
            value: `Unknown merge strategy: ${value}. Use merge, squash, or rebase.`,
          })]
        }
        return [
          action({ type: 'setPendingConfirmation', value: 'merge-pr', payload: strategy }),
          action({ type: 'closeInputPrompt' }),
        ]
      }
      if (state.inputPrompt.kind === 'pr-comment') {
        return [
          { type: 'runWorkflowAction', id: 'comment-pr', payload: value },
          action({ type: 'closeInputPrompt' }),
        ]
      }
      if (state.inputPrompt.kind === 'pr-request-changes') {
        return [
          action({ type: 'setPendingConfirmation', value: 'request-changes-pr', payload: value }),
          action({ type: 'closeInputPrompt' }),
        ]
      }
      const id = state.inputPrompt.kind
      return [
        { type: 'runWorkflowAction', id, payload: value },
        action({ type: 'closeInputPrompt' }),
      ]
    }
    if (key.backspace || key.delete) {
      return [action({ type: 'backspaceInputPrompt' })]
    }
    if (key.ctrl && inputValue === 'u') {
      return [action({ type: 'clearInputPromptText' })]
    }
    if (inputValue && !key.ctrl && !key.meta) {
      return [action({ type: 'appendInputPrompt', value: inputValue })]
    }
    return []
  }

  if (state.commitCompose.editing) {
    if (key.escape) {
      return [action({ type: 'commitCompose', action: { type: 'setEditing', value: false } })]
    }

    if (key.tab) {
      return [action({ type: 'commitCompose', action: { type: 'toggleField' } })]
    }

    if (key.return) {
      return [
        action({
          type: 'commitCompose',
          action: state.commitCompose.field === 'summary'
            ? { type: 'setField', value: 'body' }
            : { type: 'setEditing', value: false },
        }),
      ]
    }

    if (key.backspace || key.delete) {
      return [action({ type: 'commitCompose', action: { type: 'backspace' } })]
    }

    if (key.ctrl && inputValue === 'u') {
      return [action({ type: 'commitCompose', action: { type: 'clearField' } })]
    }

    if (inputValue && !key.ctrl && !key.meta) {
      return [action({ type: 'commitCompose', action: { type: 'append', value: inputValue } })]
    }

    return []
  }

  if (state.filterMode) {
    if (key.return) {
      // History server-side filter prefixes (#776): on Enter, if the
      // active view is history and the filter matches `path:<value>`
      // or `author:<value>`, hand the parsed args to the runtime
      // (which re-runs `getLogRows`) and clear the textual filter.
      // For any other view or any non-prefix filter, Enter just exits
      // filter mode like before.
      if (state.activeView === 'history') {
        const fetchArgs = parseLogInkHistoryFetchPrefix(state.filter)
        if (fetchArgs) {
          return [
            action({ type: 'setHistoryFetchArgs', value: fetchArgs }),
            action({ type: 'clearFilter' }),
          ]
        }
      }
      return [action({ type: 'toggleFilterMode' })]
    }

    // Two-stage Esc (P2.4 / P4.4): first Esc with a non-empty filter
    // clears the input but keeps filterMode active so the user can keep
    // typing; second Esc exits filterMode entirely. Matches vim and
    // most modal TUIs.
    if (key.escape) {
      if (state.filter.length > 0) {
        return [action({ type: 'clearFilterText' })]
      }
      return [action({ type: 'toggleFilterMode' })]
    }

    if (key.backspace || key.delete) {
      return [action({ type: 'backspaceFilter' })]
    }

    if (key.ctrl && inputValue === 'u') {
      // Ctrl+U is the canonical "blow away the filter" key. When the
      // history view also has server-side fetch args active (#776),
      // drop those too — otherwise the user has no obvious way to
      // unwind a `path:` / `author:` fetch and the visible filter
      // appears stuck.
      return state.historyFetchArgs
        ? [
          action({ type: 'clearFilter' }),
          action({ type: 'setHistoryFetchArgs', value: undefined }),
        ]
        : [action({ type: 'clearFilter' })]
    }

    if (inputValue && !key.ctrl && !key.meta) {
      return [action({ type: 'appendFilter', value: inputValue })]
    }

    return []
  }

  if (state.pendingConfirmationId) {
    if (inputValue === 'y') {
      const workflowAction = getLogInkWorkflowActionById(state.pendingConfirmationId)

      if (workflowAction?.id === 'ai-commit-summary') {
        return [
          { type: 'runAiCommitDraft' },
          action({ type: 'setPendingConfirmation', value: undefined }),
        ]
      }

      // Destructive + provider workflow actions (delete-branch, delete-tag,
      // drop-stash, remove-worktree, abort-operation, create-pr, …) defer
      // to the runtime — it has the live context needed to identify the
      // selected item and run the right action function.
      if (workflowAction) {
        return [
          { type: 'runWorkflowAction', id: workflowAction.id, payload: state.pendingConfirmationPayload },
          action({ type: 'setPendingConfirmation', value: undefined }),
        ]
      }

      return [
        action({ type: 'setPendingConfirmation', value: undefined }),
        action({ type: 'setStatus', value: 'workflow action queued' }),
      ]
    }

    if (inputValue === 'n' || key.escape) {
      return [
        action({ type: 'setPendingConfirmation', value: undefined }),
        action({ type: 'setStatus', value: 'workflow action cancelled' }),
      ]
    }

    return []
  }

  if (state.pendingMutationConfirmation) {
    if (inputValue === 'y') {
      if (state.pendingMutationConfirmation === 'discard-draft') {
        return [
          action({ type: 'setPendingMutationConfirmation', value: undefined }),
          { type: 'exit' },
        ]
      }
      return [
        state.pendingMutationConfirmation === 'revert-hunk'
          ? { type: 'revertSelectedHunk' }
          : { type: 'revertSelectedFile' },
        action({ type: 'setPendingMutationConfirmation', value: undefined }),
      ]
    }

    if (inputValue === 'n' || key.escape) {
      const cancelMessage = state.pendingMutationConfirmation === 'discard-draft'
        ? 'kept draft — press q again to quit without saving'
        : 'revert cancelled'
      return [
        action({ type: 'setPendingMutationConfirmation', value: undefined }),
        action({ type: 'setStatus', value: cancelMessage }),
      ]
    }

    return []
  }

  if (state.showCommandPalette) {
    const filtered = filterLogInkPaletteCommands(
      getLogInkPaletteCommands(),
      state.paletteFilter,
      state.paletteRecent
    )

    if (key.escape) {
      // Two-stage Esc inside the palette: first Esc with non-empty
      // input clears the filter; second Esc closes the palette. P2.4.
      if (state.paletteFilter.length > 0) {
        return [action({ type: 'clearPaletteFilter' })]
      }
      return [action({ type: 'toggleCommandPalette' })]
    }

    if (key.return) {
      const index = Math.max(0, Math.min(state.paletteSelectedIndex, filtered.length - 1))
      const selected = filtered[index]
      if (!selected) {
        return [action({ type: 'toggleCommandPalette' })]
      }
      return [
        action({ type: 'recordPaletteRecent', value: selected.id }),
        action({ type: 'toggleCommandPalette' }),
        ...getLogInkPaletteExecuteEvents(selected, state),
      ]
    }

    if (key.upArrow || (key.ctrl && inputValue === 'p')) {
      return [action({
        type: 'movePaletteSelection',
        delta: -1,
        commandCount: filtered.length,
      })]
    }

    if (key.downArrow || (key.ctrl && inputValue === 'n')) {
      return [action({
        type: 'movePaletteSelection',
        delta: 1,
        commandCount: filtered.length,
      })]
    }

    if (key.backspace || key.delete) {
      return [action({ type: 'backspacePaletteFilter' })]
    }

    if (key.ctrl && inputValue === 'u') {
      return [action({ type: 'clearPaletteFilter' })]
    }

    if (inputValue && !key.ctrl && !key.meta) {
      return [action({ type: 'appendPaletteFilter', value: inputValue })]
    }

    return []
  }

  if (key.escape && state.showHelp) {
    return [action({ type: 'toggleHelp' })]
  }

  if (key.escape && state.viewStack.length > 1) {
    return [action({ type: 'popView' })]
  }

  if (inputValue === 'q') {
    if (hasUnsavedComposeDraft(state)) {
      return [action({ type: 'setPendingMutationConfirmation', value: 'discard-draft' })]
    }
    return [{ type: 'exit' }]
  }

  if (inputValue === '?') {
    return [action({ type: 'toggleHelp' })]
  }

  if (inputValue === '/') {
    return [action({ type: 'toggleFilterMode' })]
  }

  if (state.pendingKey === 'g' && inputValue === 'h') {
    return [
      action({ type: 'navigateHome' }),
      action({ type: 'setStatus', value: 'jumped to history' }),
    ]
  }

  if (state.pendingKey === 'g' && inputValue === 's') {
    return [
      action({ type: 'pushView', value: 'status' }),
      action({ type: 'setStatus', value: 'jumped to status' }),
    ]
  }

  if (state.pendingKey === 'g' && inputValue === 'd') {
    return [
      action({ type: 'pushView', value: 'diff' }),
      action({ type: 'setStatus', value: 'jumped to diff' }),
    ]
  }

  if (state.pendingKey === 'g' && inputValue === 'c') {
    return [
      action({ type: 'pushView', value: 'compose' }),
      action({ type: 'setStatus', value: 'jumped to compose' }),
    ]
  }

  if (state.pendingKey === 'g' && inputValue === 'b') {
    return [
      action({ type: 'pushView', value: 'branches' }),
      action({ type: 'setStatus', value: 'jumped to branches' }),
    ]
  }

  if (state.pendingKey === 'g' && inputValue === 't') {
    return [
      action({ type: 'pushView', value: 'tags' }),
      action({ type: 'setStatus', value: 'jumped to tags' }),
    ]
  }

  if (state.pendingKey === 'g' && inputValue === 'z') {
    return [
      action({ type: 'pushView', value: 'stash' }),
      action({ type: 'setStatus', value: 'jumped to stash' }),
    ]
  }

  if (state.pendingKey === 'g' && inputValue === 'w') {
    return [
      action({ type: 'pushView', value: 'worktrees' }),
      action({ type: 'setStatus', value: 'jumped to worktrees' }),
    ]
  }

  // `gp` jumps to the dedicated pull-request action panel (#783).
  // Lowercase `p` matches the pattern of other navigation chords
  // (gh / gs / gd / gc / gb / gt / gz / gw). The panel renders the
  // current branch's PR via `gh pr view --json` enriched fields and
  // exposes m / x / a / R / c action keys scoped to the view.
  if (state.pendingKey === 'g' && inputValue === 'p') {
    return [
      action({ type: 'pushView', value: 'pull-request' }),
      action({ type: 'setStatus', value: 'jumped to pull request' }),
    ]
  }

  if (inputValue === 'g') {
    if (state.pendingKey === 'g') {
      return [
        action({ type: 'moveToTop' }),
        action({ type: 'setStatus', value: 'jumped to first commit' }),
      ]
    }

    return [action({ type: 'setPendingKey', value: 'g' })]
  }

  if (inputValue === '\\') {
    return [action({ type: 'toggleGraph' })]
  }

  if (inputValue === '<') {
    return [action({ type: 'popView' })]
  }

  if (inputValue === 'G') {
    return [
      action({ type: 'moveToBottom' }),
      action({ type: 'setStatus', value: 'jumped to last commit' }),
    ]
  }

  if (inputValue === 'n') {
    return [action({ type: 'move', delta: 1 })]
  }

  if (inputValue === 'N') {
    return [action({ type: 'move', delta: -1 })]
  }

  if (inputValue === 'r') {
    return [{ type: 'refreshContext' }]
  }

  if (inputValue === 's') {
    if (isBranchActionTarget(state)) {
      return [action({ type: 'cycleBranchSort' })]
    }
    if (isTagActionTarget(state)) {
      return [action({ type: 'cycleTagSort' })]
    }
    // Falls through so other views (history/status/diff/compose/stash) still
    // see the literal `s` for whatever per-view bindings they may grow.
  }

  if (inputValue === ':') {
    return [action({ type: 'toggleCommandPalette' })]
  }

  if (inputValue === '[') {
    if (state.activeView === 'diff' && context.worktreeHunkOffsets?.length) {
      return [action({
        type: 'jumpWorktreeHunk',
        delta: -1,
        hunkOffsets: context.worktreeHunkOffsets,
      })]
    }
    if (state.activeView === 'diff' && state.diffSource === 'stash' && context.stashDiffFileOffsets?.length) {
      return [action({
        type: 'jumpCommitDiffHunk',
        delta: -1,
        hunkOffsets: context.stashDiffFileOffsets,
      })]
    }
    if (state.activeView === 'diff' && context.commitDiffHunkOffsets?.length) {
      return [action({
        type: 'jumpCommitDiffHunk',
        delta: -1,
        hunkOffsets: context.commitDiffHunkOffsets,
      })]
    }
    return [action({ type: 'previousSidebarTab' })]
  }

  if (inputValue === ']') {
    if (state.activeView === 'diff' && context.worktreeHunkOffsets?.length) {
      return [action({
        type: 'jumpWorktreeHunk',
        delta: 1,
        hunkOffsets: context.worktreeHunkOffsets,
      })]
    }
    if (state.activeView === 'diff' && state.diffSource === 'stash' && context.stashDiffFileOffsets?.length) {
      return [action({
        type: 'jumpCommitDiffHunk',
        delta: 1,
        hunkOffsets: context.stashDiffFileOffsets,
      })]
    }
    if (state.activeView === 'diff' && context.commitDiffHunkOffsets?.length) {
      return [action({
        type: 'jumpCommitDiffHunk',
        delta: 1,
        hunkOffsets: context.commitDiffHunkOffsets,
      })]
    }
    return [action({ type: 'nextSidebarTab' })]
  }

  // Status surface intercepts 1/2/3 before the sidebar-tab numeric
  // jump (#776): each key toggles a staging-category bit on the
  // visibility mask. The reducer snaps back to all-on if all three
  // bits go off so the user always has rendered files.
  if (state.activeView === 'status' && (inputValue === '1' || inputValue === '2' || inputValue === '3')) {
    const kind: 'staged' | 'unstaged' | 'untracked' =
      inputValue === '1' ? 'staged' : inputValue === '2' ? 'unstaged' : 'untracked'
    return [action({ type: 'toggleStatusFilterMask', kind })]
  }

  if (SIDEBAR_TAB_BY_NUMBER[inputValue]) {
    return [action({ type: 'setSidebarTab', value: SIDEBAR_TAB_BY_NUMBER[inputValue] })]
  }

  if (key.tab) {
    return [action({ type: key.shift ? 'focusPrevious' : 'focusNext' })]
  }

  // ←/→ on the sidebar switch tabs (Status ↔ Branches ↔ Tags ↔
  // Stashes ↔ Worktrees) — the horizontal axis is "between tabs", the
  // vertical axis (↑/↓ below) is "within the active tab's items".
  // [/] still works as a keyboard alternative for users who prefer
  // non-arrow keys.
  if (key.leftArrow && state.focus === 'sidebar') {
    return [action({ type: 'previousSidebarTab' })]
  }
  if (key.rightArrow && state.focus === 'sidebar') {
    return [action({ type: 'nextSidebarTab' })]
  }

  if (key.upArrow || inputValue === 'k') {
    if (state.focus === 'detail' && context.detailFileCount) {
      return [action({ type: 'moveDetailFile', delta: -1, fileCount: context.detailFileCount })]
    }

    if (state.activeView === 'status' && context.worktreeFileCount) {
      return [action({
        type: 'moveWorktreeFile',
        delta: -1,
        fileCount: context.worktreeFileCount,
      })]
    }

    // Diff view: j/k scrolls the visible diff one line. Hunk navigation
    // moved to ]/[ so single-hunk files (longer than the preview pane)
    // can scroll bidirectionally instead of getting pinned to a hunk
    // anchor.
    if (state.activeView === 'diff' && context.worktreeDiffLineCount) {
      return [action({
        type: 'pageWorktreeDiff',
        delta: -1,
        lineCount: context.worktreeDiffLineCount,
      })]
    }

    if (state.activeView === 'diff' && context.previewLineCount) {
      return [action({
        type: 'pageDetailPreview',
        delta: -1,
        previewLineCount: context.previewLineCount,
      })]
    }

    if (isBranchActionTarget(state) && context.branchCount) {
      return [action({ type: 'moveBranch', delta: -1, count: context.branchCount })]
    }

    if (isTagActionTarget(state) && context.tagCount) {
      return [action({ type: 'moveTag', delta: -1, count: context.tagCount })]
    }

    if (isStashActionTarget(state) && context.stashCount) {
      return [action({ type: 'moveStash', delta: -1, count: context.stashCount })]
    }

    if (isWorktreeActionTarget(state) && context.worktreeListCount) {
      return [action({ type: 'moveWorktreeListEntry', delta: -1, count: context.worktreeListCount })]
    }

    if (
      state.activeView === 'history' &&
      state.focus === 'commits' &&
      state.selectedIndex === 0 &&
      !state.pendingCommitFocused &&
      context.worktreeDirty
    ) {
      return [action({ type: 'focusPendingCommit' })]
    }

    // Sidebar fallback: when no entity claim above succeeds (status
    // tab or empty content tab), ↑ falls through to cycling sidebar
    // tabs so the user always has a way to navigate. With ←/→ above
    // already handling tab switching, this is mostly a vim-style
    // safety net for `k`.
    return [
      action(state.focus === 'sidebar'
        ? { type: 'previousSidebarTab' }
        : { type: 'move', delta: -1 }),
    ]
  }

  if (key.downArrow || inputValue === 'j') {
    if (state.activeView === 'history' && state.pendingCommitFocused) {
      return [action({ type: 'unfocusPendingCommit' })]
    }

    if (state.focus === 'detail' && context.detailFileCount) {
      return [action({ type: 'moveDetailFile', delta: 1, fileCount: context.detailFileCount })]
    }

    if (state.activeView === 'status' && context.worktreeFileCount) {
      return [action({
        type: 'moveWorktreeFile',
        delta: 1,
        fileCount: context.worktreeFileCount,
      })]
    }

    if (state.activeView === 'diff' && context.worktreeDiffLineCount) {
      return [action({
        type: 'pageWorktreeDiff',
        delta: 1,
        lineCount: context.worktreeDiffLineCount,
      })]
    }

    if (state.activeView === 'diff' && context.previewLineCount) {
      return [action({
        type: 'pageDetailPreview',
        delta: 1,
        previewLineCount: context.previewLineCount,
      })]
    }

    if (isBranchActionTarget(state) && context.branchCount) {
      return [action({ type: 'moveBranch', delta: 1, count: context.branchCount })]
    }

    if (isTagActionTarget(state) && context.tagCount) {
      return [action({ type: 'moveTag', delta: 1, count: context.tagCount })]
    }

    if (isStashActionTarget(state) && context.stashCount) {
      return [action({ type: 'moveStash', delta: 1, count: context.stashCount })]
    }

    if (isWorktreeActionTarget(state) && context.worktreeListCount) {
      return [action({ type: 'moveWorktreeListEntry', delta: 1, count: context.worktreeListCount })]
    }

    return [
      action(state.focus === 'sidebar'
        ? { type: 'nextSidebarTab' }
        : { type: 'move', delta: 1 }),
    ]
  }

  if (key.pageUp) {
    if (state.activeView === 'diff' && context.worktreeDiffLineCount) {
      return [action({
        type: 'pageWorktreeDiff',
        delta: -8,
        lineCount: context.worktreeDiffLineCount,
      })]
    }

    if (state.activeView === 'diff' && context.previewLineCount) {
      return [action({
        type: 'pageDetailPreview',
        delta: -8,
        previewLineCount: context.previewLineCount,
      })]
    }

    if (state.focus === 'detail' && context.previewLineCount) {
      return [action({
        type: 'pageDetailPreview',
        delta: -8,
        previewLineCount: context.previewLineCount,
      })]
    }

    return [action({ type: 'page', delta: -10 })]
  }

  if (key.pageDown) {
    if (state.activeView === 'diff' && context.worktreeDiffLineCount) {
      return [action({
        type: 'pageWorktreeDiff',
        delta: 8,
        lineCount: context.worktreeDiffLineCount,
      })]
    }

    if (state.activeView === 'diff' && context.previewLineCount) {
      return [action({
        type: 'pageDetailPreview',
        delta: 8,
        previewLineCount: context.previewLineCount,
      })]
    }

    if (state.focus === 'detail' && context.previewLineCount) {
      return [action({
        type: 'pageDetailPreview',
        delta: 8,
        previewLineCount: context.previewLineCount,
      })]
    }

    return [action({ type: 'page', delta: 10 })]
  }

  // Enter on the synthetic "(+) new commit" row pushes the status view so
  // the user can stage/commit. The pending flag is cleared on view push so
  // popping back lands on the real commit at index 0.
  if (
    key.return &&
    state.activeView === 'history' &&
    state.pendingCommitFocused
  ) {
    return [
      action({ type: 'pushView', value: 'status' }),
      action({ type: 'setStatus', value: 'staging worktree changes' }),
    ]
  }

  if (
    key.return &&
    state.activeView === 'history' &&
    state.focus === 'commits' &&
    state.filteredCommits.length > 0
  ) {
    const selected = state.filteredCommits[state.selectedIndex]
    if (selected) {
      return [
        action({
          type: 'navigateOpenDiffForCommit',
          sha: selected.hash,
          commitIndex: state.selectedIndex,
        }),
        action({ type: 'setStatus', value: `viewing diff for ${selected.shortHash}` }),
      ]
    }
  }

  // From the inspector / commit-diff detail panel, Enter opens (or refocuses)
  // the diff view scoped to the currently-selected commit and file. Lets the
  // user drive the explore flow entirely from the right panel: j/k picks a
  // file, Enter opens the diff for it.
  if (
    key.return &&
    state.focus === 'detail' &&
    (state.activeView === 'history' || state.activeView === 'diff') &&
    context.detailFileCount &&
    state.filteredCommits.length > 0
  ) {
    const selected = state.filteredCommits[state.selectedIndex]
    if (selected) {
      return [action({
        type: 'navigateOpenDiffForCommit',
        sha: selected.hash,
        commitIndex: state.selectedIndex,
        fileIndex: state.selectedFileIndex,
      })]
    }
  }

  // Enter on a sidebar tab drills into the corresponding promoted view
  // (status / branches / tags / stash) — but only when the sidebar tab
  // either has no per-entity Enter handler defined (status, tags,
  // worktrees) or has zero items (so the dedicated view's empty-state
  // tells the user what to do next).
  //
  // When the sidebar IS focused on a content tab WITH items, this
  // handler defers to the per-entity Enter below (checkout-branch for
  // branches, navigateOpenDiffForStash for stashes) so the user can
  // act on the cursored item without leaving the workstation view —
  // the in-sidebar selection win from #791 follow-up.
  //
  // The drill-in moves focus out of the sidebar into the newly opened
  // list — otherwise ↑/↓ keep navigating the sidebar instead of the
  // just-opened view, which made the drill-in feel half-done.
  if (key.return && state.focus === 'sidebar') {
    const sidebarItemCount = getSidebarItemCount(state.sidebarTab, context)
    const hasInSidebarPrimaryAction =
      (state.sidebarTab === 'branches' || state.sidebarTab === 'stashes') &&
      sidebarTabHasSelectableItems(state.sidebarTab, sidebarItemCount)

    if (!hasInSidebarPrimaryAction) {
      const tabToView: Partial<Record<LogInkSidebarTab, 'status' | 'branches' | 'tags' | 'stash' | 'worktrees'>> = {
        status: 'status',
        branches: 'branches',
        tags: 'tags',
        stashes: 'stash',
        worktrees: 'worktrees',
      }
      const target = tabToView[state.sidebarTab]
      if (target) {
        return [
          action({ type: 'pushView', value: target }),
          action({ type: 'setFocus', value: 'commits' }),
        ]
      }
      return [action({ type: 'setStatus', value: 'no detail view for this tab' })]
    }
    // Fall through — per-entity Enter handler below claims the keystroke.
  }

  if (key.return && state.activeView === 'status' && state.focus === 'commits' && context.worktreeFileCount) {
    return [action({
      type: 'navigateOpenDiffForWorktreeFile',
      fileIndex: state.selectedWorktreeFileIndex,
    })]
  }

  // Enter on a branch row checks the branch out. Non-destructive workflow
  // action — no confirmation prompt. Fires from either the dedicated
  // branches view or from the sidebar when the branches tab is focused
  // with items.
  if (key.return && isBranchActionTarget(state) && context.branchCount) {
    return [{ type: 'runWorkflowAction', id: 'checkout-branch' }]
  }

  // `+` opens a create-branch / create-tag prompt depending on context.
  // Works from either the matching promoted view (active branches /
  // tags surface) or from the sidebar when the corresponding tab is
  // active — saves a drill-in for "I just want to make a new branch".
  const wantsCreateBranch = inputValue === '+' && (
    state.activeView === 'branches' ||
    (state.focus === 'sidebar' && state.sidebarTab === 'branches')
  )
  const wantsCreateTag = inputValue === '+' && (
    state.activeView === 'tags' ||
    (state.focus === 'sidebar' && state.sidebarTab === 'tags')
  )
  if (wantsCreateBranch) {
    return [action({
      type: 'openInputPrompt',
      kind: 'create-branch',
      label: 'New branch name',
    })]
  }
  if (wantsCreateTag) {
    return [action({
      type: 'openInputPrompt',
      kind: 'create-tag',
      label: 'New tag name',
    })]
  }

  // Per-view stash actions: `a` apply (keep the stash), `p` pop (apply
  // then drop). Drop is the existing destructive `X` workflow which
  // routes through the y-confirm path. Scoped to the stash target so
  // the letters stay free elsewhere — the target predicate also fires
  // when the sidebar's stashes tab is focused with items.
  if (inputValue === 'a' && isStashActionTarget(state) && context.stashCount) {
    return [{ type: 'runWorkflowAction', id: 'apply-stash' }]
  }
  if (inputValue === 'p' && isStashActionTarget(state) && context.stashCount) {
    return [{ type: 'runWorkflowAction', id: 'pop-stash' }]
  }
  // Per-view tag action: `P` pushes the selected tag to origin. Letter
  // is scoped to the tags target so it doesn't collide with `p` for
  // pop-stash. Note: this also takes precedence over the global
  // push-current-branch workflow's `P` key.
  if (inputValue === 'P' && isTagActionTarget(state) && context.tagCount) {
    return [{ type: 'runWorkflowAction', id: 'push-tag' }]
  }

  // Per-view branches actions: `R` renames the selected branch, `u`
  // sets its upstream. Both open the input prompt so the user can type
  // the new value. Pre-fills are handled by the prompt's `initial`.
  if (inputValue === 'R' && isBranchActionTarget(state) && context.branchCount) {
    return [action({
      type: 'openInputPrompt',
      kind: 'rename-branch',
      label: 'Rename branch to',
    })]
  }
  if (inputValue === 'u' && isBranchActionTarget(state) && context.branchCount) {
    return [action({
      type: 'openInputPrompt',
      kind: 'set-upstream',
      label: 'Upstream ref (e.g. origin/main)',
    })]
  }

  // Per-view tag action: `R` deletes the tag from the remote (after
  // confirmation). Scoped per-target so this letter is free elsewhere
  // (especially the `R` rename binding on the branches target).
  if (inputValue === 'R' && isTagActionTarget(state) && context.tagCount) {
    return [action({ type: 'setPendingConfirmation', value: 'delete-remote-tag' })]
  }

  // #783 — full PR action panel keys, scoped to the pull-request view.
  // All five wrap a `gh pr <verb>` invocation; merge / request-changes /
  // comment open prompts first, the rest route through the y-confirm
  // path because they're irreversible (or near-irreversible).
  if (inputValue === 'm' && state.activeView === 'pull-request') {
    return [action({
      type: 'openInputPrompt',
      kind: 'pr-merge-strategy',
      label: 'Merge strategy (merge / squash / rebase)',
    })]
  }
  if (inputValue === 'x' && state.activeView === 'pull-request') {
    return [action({ type: 'setPendingConfirmation', value: 'close-pr' })]
  }
  if (inputValue === 'a' && state.activeView === 'pull-request') {
    return [action({ type: 'setPendingConfirmation', value: 'approve-pr' })]
  }
  if (inputValue === 'R' && state.activeView === 'pull-request') {
    return [action({
      type: 'openInputPrompt',
      kind: 'pr-request-changes',
      label: 'Request changes — review body',
    })]
  }
  if (inputValue === 'c' && state.activeView === 'pull-request') {
    return [action({
      type: 'openInputPrompt',
      kind: 'pr-comment',
      label: 'Comment body',
    })]
  }

  // Global stash hotkey: `S` opens a stash-message prompt and
  // `createStash` runs once submitted. Available everywhere there's
  // not a more modal handler in front of it.
  if (inputValue === 'S') {
    return [action({
      type: 'openInputPrompt',
      kind: 'create-stash',
      label: 'Stash message',
    })]
  }

  // `o` opens the file under the cursor in $EDITOR. Available on the
  // status surface (worktree files), the worktree diff (the file being
  // diffed), and the stash diff (the file the cursor sits in inside
  // the patch). The runtime suspends Ink, spawns the editor sync, then
  // re-renders.
  if (inputValue === 'o' && state.activeView === 'status' && context.worktreeFileCount && context.worktreeSelectedPath) {
    return [{ type: 'openFileInEditor', path: context.worktreeSelectedPath }]
  }
  if (inputValue === 'o' && state.activeView === 'diff' && state.diffSource === 'worktree' && context.worktreeSelectedPath) {
    return [{ type: 'openFileInEditor', path: context.worktreeSelectedPath }]
  }
  if (inputValue === 'o' && state.activeView === 'diff' && state.diffSource === 'stash' && context.stashDiffSelectedPath) {
    return [{ type: 'openFileInEditor', path: context.stashDiffSelectedPath }]
  }

  // `c` on a stash diff cherry-picks the file under the cursor —
  // materializes that single path from the stash into the working tree
  // (`git checkout <stashRef> -- <path>`). Routed through the y-confirm
  // path because the checkout overwrites the worktree file
  // unconditionally; the prompt is the user's chance to abort if they
  // have unsaved edits at that path.
  if (
    inputValue === 'c' &&
    state.activeView === 'diff' &&
    state.diffSource === 'stash' &&
    context.stashDiffSelectedPath &&
    state.stashDiffRef
  ) {
    return [action({
      type: 'setPendingConfirmation',
      value: 'checkout-file-from-stash',
      payload: context.stashDiffSelectedPath,
    })]
  }

  // `c` on a commit-diff explore cherry-picks the cursored file from
  // that historical commit — `git checkout <sha> -- <path>`. Same
  // confirmation rationale as the stash variant. The payload encodes
  // both the sha and the path so the runtime handler doesn't have to
  // re-resolve either.
  if (
    inputValue === 'c' &&
    state.activeView === 'diff' &&
    state.diffSource === 'commit' &&
    context.commitDiffSelectedPath &&
    context.commitDiffSelectedSha
  ) {
    return [action({
      type: 'setPendingConfirmation',
      value: 'checkout-file-from-commit',
      payload: `${context.commitDiffSelectedSha} ${context.commitDiffSelectedPath}`,
    })]
  }

  // `c` on the history view cherry-picks the full selected commit on
  // top of the current branch. Routed through the y-confirm flow since
  // it can produce conflicts and is a real working-tree mutation.
  if (
    inputValue === 'c' &&
    state.activeView === 'history' &&
    state.focus === 'commits' &&
    state.filteredCommits.length > 0 &&
    !state.pendingCommitFocused
  ) {
    return [action({ type: 'setPendingConfirmation', value: 'cherry-pick-commit' })]
  }

  // `y` / `Y` yank the contextually relevant identifier from the active
  // view to the system clipboard:
  //   history    → cursored commit hash (Y for short hash)
  //   branches   → cursored branch shortName
  //   tags       → cursored tag name
  //   stash      → cursored stash ref
  //   status     → cursored worktree file path
  //   diff       → cursored file path (Y on a commit-diff yanks the sha instead)
  // The runtime resolves the actual value/label against live filtered
  // lists; the dispatcher only decides whether the keystroke applies.
  if (inputValue === 'y' || inputValue === 'Y') {
    const short = inputValue === 'Y'
    if (state.activeView === 'history' && state.filteredCommits.length > 0) {
      return [{ type: 'yankFromActiveView', short }]
    }
    if (isBranchActionTarget(state) && context.branchCount) {
      return [{ type: 'yankFromActiveView' }]
    }
    if (isTagActionTarget(state) && context.tagCount) {
      return [{ type: 'yankFromActiveView' }]
    }
    if (isStashActionTarget(state) && context.stashCount && context.stashSelectedRef) {
      return [{ type: 'yankFromActiveView' }]
    }
    if (state.activeView === 'status' && context.worktreeSelectedPath) {
      return [{ type: 'yankFromActiveView' }]
    }
    if (state.activeView === 'diff') {
      if (
        context.worktreeSelectedPath ||
        context.stashDiffSelectedPath ||
        context.commitDiffSelectedPath ||
        context.commitDiffSelectedSha
      ) {
        return [{ type: 'yankFromActiveView', short }]
      }
    }
  }

  // Enter on a stash row pushes the diff view scoped to that stash.
  // The runtime loads `git stash show -p <ref>` once the view is
  // active. The stash ref is passed via the action so we don't need a
  // context lookup here. Fires from either the dedicated stash view or
  // from the sidebar when the stashes tab is focused with items.
  if (key.return && isStashActionTarget(state) && context.stashCount && context.stashSelectedRef) {
    return [action({
      type: 'navigateOpenDiffForStash',
      ref: context.stashSelectedRef,
      stashIndex: state.selectedStashIndex,
    })]
  }

  if (inputValue === ' ' && state.activeView === 'status' && context.worktreeFileCount) {
    return [{ type: 'toggleSelectedFileStage' }]
  }

  if (inputValue === ' ' && state.activeView === 'diff' && context.worktreeHunkOffsets?.length) {
    return [{ type: 'toggleSelectedHunkStage' }]
  }

  if (inputValue === 'z' && state.activeView === 'status' && context.worktreeFileCount) {
    return [action({ type: 'setPendingMutationConfirmation', value: 'revert-file' })]
  }

  if (inputValue === 'z' && state.activeView === 'diff' && context.worktreeHunkOffsets?.length) {
    return [action({ type: 'setPendingMutationConfirmation', value: 'revert-hunk' })]
  }

  if (
    inputValue === 'e' &&
    (state.activeView === 'status' || state.activeView === 'diff' || state.activeView === 'compose')
  ) {
    const events: LogInkInputEvent[] = []
    if (state.activeView !== 'compose') {
      events.push(action({ type: 'pushView', value: 'compose' }))
    }
    events.push(action({ type: 'commitCompose', action: { type: 'setEditing', value: true } }))
    return events
  }

  if (
    inputValue === 'c' &&
    (state.activeView === 'status' || state.activeView === 'diff' || state.activeView === 'compose')
  ) {
    const events: LogInkInputEvent[] = []
    if (state.activeView !== 'compose') {
      events.push(action({ type: 'pushView', value: 'compose' }))
    }
    events.push({ type: 'createManualCommit' })
    return events
  }

  const workflowAction = getLogInkWorkflowActionByKey(inputValue)

  if (workflowAction?.requiresConfirmation) {
    return [action({ type: 'setPendingConfirmation', value: workflowAction.id })]
  }

  if (workflowAction) {
    // Non-destructive workflow — fire it directly via the runtime
    // handler. The handler surfaces success/failure on the status line
    // and silently refreshes context so the list updates.
    return [{ type: 'runWorkflowAction', id: workflowAction.id }]
  }

  return []
}
