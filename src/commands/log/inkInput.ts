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

export type LogInkInputContext = {
  detailFileCount?: number
  worktreeHunkOffsets?: number[]
  previewLineCount?: number
  worktreeDiffLineCount?: number
  worktreeFileCount?: number
}

function action(actionValue: LogInkAction): LogInkInputEvent {
  return {
    type: 'action',
    action: actionValue,
  }
}

const SIDEBAR_TAB_BY_NUMBER: Record<string, LogInkSidebarTab> = {
  '1': 'status',
  '2': 'branches',
  '3': 'tags',
  '4': 'stashes',
  '5': 'worktrees',
}

export function getLogInkInputEvents(
  state: LogInkState,
  inputValue: string,
  key: LogInkInputKey = {},
  context: LogInkInputContext = {}
): LogInkInputEvent[] {
  if (key.ctrl && inputValue === 'c') {
    return [{ type: 'exit' }]
  }

  if (state.filterMode) {
    if (key.return || key.escape) {
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
      return [
        state.pendingMutationConfirmation === 'revert-hunk'
          ? { type: 'revertSelectedHunk' }
          : { type: 'revertSelectedFile' },
        action({ type: 'setPendingMutationConfirmation', value: undefined }),
      ]
    }

    if (inputValue === 'n' || key.escape) {
      return [
        action({ type: 'setPendingMutationConfirmation', value: undefined }),
        action({ type: 'setStatus', value: 'revert cancelled' }),
      ]
    }

    return []
  }

  if (key.escape && state.showHelp) {
    return [action({ type: 'toggleHelp' })]
  }

  if (key.escape && state.showCommandPalette) {
    return [action({ type: 'toggleCommandPalette' })]
  }

  if (key.escape && state.activeView === 'diff') {
    return [action({ type: 'setActiveView', value: 'status' })]
  }

  if (inputValue === 'q') {
    return [{ type: 'exit' }]
  }

  if (inputValue === '?') {
    return [action({ type: 'toggleHelp' })]
  }

  if (inputValue === '/') {
    return [action({ type: 'toggleFilterMode' })]
  }

  if (inputValue === 'g') {
    if (state.pendingKey === 'g') {
      return [
        action({ type: 'moveToTop' }),
        action({ type: 'setStatus', value: 'jumped to first commit' }),
      ]
    }

    return [
      action({ type: 'toggleGraph' }),
      action({ type: 'setPendingKey', value: 'g' }),
    ]
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
    return [action({ type: 'previousSidebarTab' })]
  }

  if (inputValue === ']') {
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

    if (state.activeView === 'diff' && context.worktreeDiffLineCount) {
      return [action({
        type: 'jumpWorktreeHunk',
        delta: -1,
        hunkOffsets: context.worktreeHunkOffsets || [],
      })]
    }

    return [
      action(state.focus === 'sidebar'
        ? { type: 'previousSidebarTab' }
        : { type: 'move', delta: -1 }),
    ]
  }

  if (key.downArrow || inputValue === 'j') {
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
        type: 'jumpWorktreeHunk',
        delta: 1,
        hunkOffsets: context.worktreeHunkOffsets || [],
      })]
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

    if (state.focus === 'detail' && context.previewLineCount) {
      return [action({
        type: 'pageDetailPreview',
        delta: 8,
        previewLineCount: context.previewLineCount,
      })]
    }

    return [action({ type: 'page', delta: 10 })]
  }

  if (key.return && state.activeView === 'status' && context.worktreeFileCount) {
    return [action({ type: 'setActiveView', value: 'diff' })]
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
