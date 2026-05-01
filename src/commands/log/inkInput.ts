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

      return [
        action({ type: 'setPendingConfirmation', value: undefined }),
        action({
          type: 'setStatus',
          value: workflowAction
            ? `${workflowAction.label} queued for workflow execution`
            : 'workflow action queued',
        }),
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

  if (key.return && state.activeView === 'status' && context.worktreeFileCount) {
    return [action({
      type: 'navigateOpenDiffForWorktreeFile',
      fileIndex: state.selectedWorktreeFileIndex,
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
    return [
      action({ type: 'setWorkflowAction', value: workflowAction.id }),
      action({ type: 'setStatus', value: `${workflowAction.label} selected` }),
    ]
  }

  return []
}
