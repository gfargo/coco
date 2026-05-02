import {
  LogInkPaletteCommand,
  filterLogInkPaletteCommands,
  getLogInkPaletteCommands,
} from './inkKeymap'
import { LogInkAction, LogInkSidebarTab, LogInkState } from './inkViewModel'
import {
  getLogInkWorkflowActionById,
  getLogInkWorkflowActionByKey,
} from './inkWorkflows'

export type LogInkInputKey = {
  backspace?: boolean
  ctrl?: boolean
  delete?: boolean
  downArrow?: boolean
  escape?: boolean
  meta?: boolean
  pageDown?: boolean
  pageUp?: boolean
  return?: boolean
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
    return [
      action({ type: 'setWorkflowAction', value: command.id }),
      action({ type: 'setStatus', value: `${command.label} selected` }),
    ]
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
      if (state.activeView === 'branches') {
        return [action({ type: 'cycleBranchSort' })]
      }
      if (state.activeView === 'tags') {
        return [action({ type: 'cycleTagSort' })]
      }
      return [action({
        type: 'setStatus',
        value: 'Sort cycle is available in the branches and tags views',
      })]
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
      return [action({ type: 'clearFilter' })]
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
          { type: 'runWorkflowAction', id: workflowAction.id },
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
    if (state.activeView === 'branches') {
      return [action({ type: 'cycleBranchSort' })]
    }
    if (state.activeView === 'tags') {
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

  if (SIDEBAR_TAB_BY_NUMBER[inputValue]) {
    return [action({ type: 'setSidebarTab', value: SIDEBAR_TAB_BY_NUMBER[inputValue] })]
  }

  if (key.tab) {
    return [action({ type: key.shift ? 'focusPrevious' : 'focusNext' })]
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

    if (state.activeView === 'branches' && context.branchCount) {
      return [action({ type: 'moveBranch', delta: -1, count: context.branchCount })]
    }

    if (state.activeView === 'tags' && context.tagCount) {
      return [action({ type: 'moveTag', delta: -1, count: context.tagCount })]
    }

    if (state.activeView === 'stash' && context.stashCount) {
      return [action({ type: 'moveStash', delta: -1, count: context.stashCount })]
    }

    if (state.activeView === 'worktrees' && context.worktreeListCount) {
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

    if (state.activeView === 'branches' && context.branchCount) {
      return [action({ type: 'moveBranch', delta: 1, count: context.branchCount })]
    }

    if (state.activeView === 'tags' && context.tagCount) {
      return [action({ type: 'moveTag', delta: 1, count: context.tagCount })]
    }

    if (state.activeView === 'stash' && context.stashCount) {
      return [action({ type: 'moveStash', delta: 1, count: context.stashCount })]
    }

    if (state.activeView === 'worktrees' && context.worktreeListCount) {
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
  // (status / branches / tags / stash). Sits above the per-view Enter
  // handlers so a sidebar-focused Enter never fires checkout-branch /
  // navigateOpenDiffForCommit / etc. against the (hidden) selection in
  // the active tab.
  if (key.return && state.focus === 'sidebar') {
    const tabToView: Partial<Record<LogInkSidebarTab, 'status' | 'branches' | 'tags' | 'stash' | 'worktrees'>> = {
      status: 'status',
      branches: 'branches',
      tags: 'tags',
      stashes: 'stash',
      worktrees: 'worktrees',
    }
    const target = tabToView[state.sidebarTab]
    if (target) {
      return [action({ type: 'pushView', value: target })]
    }
    return [action({ type: 'setStatus', value: 'no detail view for this tab' })]
  }

  if (key.return && state.activeView === 'status' && state.focus === 'commits' && context.worktreeFileCount) {
    return [action({
      type: 'navigateOpenDiffForWorktreeFile',
      fileIndex: state.selectedWorktreeFileIndex,
    })]
  }

  // Enter on a branch row checks the branch out. Non-destructive workflow
  // action — no confirmation prompt.
  if (key.return && state.activeView === 'branches' && state.focus === 'commits' && context.branchCount) {
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
  // routes through the y-confirm path. Scoped to the stash view so the
  // letters stay free elsewhere.
  if (inputValue === 'a' && state.activeView === 'stash' && context.stashCount) {
    return [{ type: 'runWorkflowAction', id: 'apply-stash' }]
  }
  if (inputValue === 'p' && state.activeView === 'stash' && context.stashCount) {
    return [{ type: 'runWorkflowAction', id: 'pop-stash' }]
  }
  // Per-view tag action: `P` pushes the selected tag to origin. Letter
  // is scoped to the tags surface so it doesn't collide with `p` for
  // pop-stash. Note: this also takes precedence over the global
  // push-current-branch workflow's `P` key.
  if (inputValue === 'P' && state.activeView === 'tags' && context.tagCount) {
    return [{ type: 'runWorkflowAction', id: 'push-tag' }]
  }

  // Per-view branches actions: `R` renames the selected branch, `u`
  // sets its upstream. Both open the input prompt so the user can type
  // the new value. Pre-fills are handled by the prompt's `initial`.
  if (inputValue === 'R' && state.activeView === 'branches' && context.branchCount) {
    return [action({
      type: 'openInputPrompt',
      kind: 'rename-branch',
      label: 'Rename branch to',
    })]
  }
  if (inputValue === 'u' && state.activeView === 'branches' && context.branchCount) {
    return [action({
      type: 'openInputPrompt',
      kind: 'set-upstream',
      label: 'Upstream ref (e.g. origin/main)',
    })]
  }

  // Per-view tag action: `R` deletes the tag from the remote (after
  // confirmation). Scoped per-view so this letter is free elsewhere
  // (especially the `R` rename binding on the branches view).
  if (inputValue === 'R' && state.activeView === 'tags' && context.tagCount) {
    return [action({ type: 'setPendingConfirmation', value: 'delete-remote-tag' })]
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
  // (`git checkout <stashRef> -- <path>`). Scoped to the stash diff
  // surface so the letter is free elsewhere.
  if (
    inputValue === 'c' &&
    state.activeView === 'diff' &&
    state.diffSource === 'stash' &&
    context.stashDiffSelectedPath &&
    state.stashDiffRef
  ) {
    return [{
      type: 'runWorkflowAction',
      id: 'checkout-file-from-stash',
      payload: context.stashDiffSelectedPath,
    }]
  }
  // Enter on a stash row pushes the diff view scoped to that stash.
  // The runtime loads `git stash show -p <ref>` once the view is
  // active. The stash ref is passed via the action so we don't need a
  // context lookup here.
  if (key.return && state.activeView === 'stash' && state.focus === 'commits' && context.stashCount && context.stashSelectedRef) {
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
