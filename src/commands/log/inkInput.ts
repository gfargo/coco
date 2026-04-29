import { LogInkAction, LogInkState } from './inkViewModel'
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

function action(actionValue: LogInkAction): LogInkInputEvent {
  return {
    type: 'action',
    action: actionValue,
  }
}

export function getLogInkInputEvents(
  state: LogInkState,
  inputValue: string,
  key: LogInkInputKey = {}
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

  if (key.escape && state.showHelp) {
    return [action({ type: 'toggleHelp' })]
  }

  if (key.escape && state.showCommandPalette) {
    return [action({ type: 'toggleCommandPalette' })]
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
    return [action({ type: 'toggleGraph' })]
  }

  if (inputValue === 'r') {
    return [{ type: 'refreshContext' }]
  }

  if (inputValue === ':') {
    return [action({ type: 'toggleCommandPalette' })]
  }

  if (key.tab) {
    return [action({ type: key.shift ? 'focusPrevious' : 'focusNext' })]
  }

  if (key.upArrow || inputValue === 'k') {
    return [
      action(state.focus === 'sidebar'
        ? { type: 'previousSidebarTab' }
        : { type: 'move', delta: -1 }),
    ]
  }

  if (key.downArrow || inputValue === 'j') {
    return [
      action(state.focus === 'sidebar'
        ? { type: 'nextSidebarTab' }
        : { type: 'move', delta: 1 }),
    ]
  }

  if (key.pageUp) {
    return [action({ type: 'page', delta: -10 })]
  }

  if (key.pageDown) {
    return [action({ type: 'page', delta: 10 })]
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
