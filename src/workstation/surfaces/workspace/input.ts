import type { WorkspaceAction, WorkspaceState } from './state'

/**
 * Key descriptor for the workspace surface. Mirrors the structural
 * type from `LogInkInputKey` so we don't pull React/Ink into the pure
 * input layer — the runtime hands the same shape into both surfaces.
 */
export type WorkspaceInputKey = {
  upArrow?: boolean
  downArrow?: boolean
  leftArrow?: boolean
  rightArrow?: boolean
  return?: boolean
  escape?: boolean
  tab?: boolean
  shift?: boolean
  ctrl?: boolean
  meta?: boolean
  pageDown?: boolean
  pageUp?: boolean
  delete?: boolean
  backspace?: boolean
}

export type WorkspaceInputIntent =
  | { kind: 'action'; action: WorkspaceAction }
  | { kind: 'quit' }
  | { kind: 'drill-in' }
  | { kind: 'refresh' }
  | { kind: 'add-repo' }
  | { kind: 'noop' }

/**
 * Pure key → intent mapping. The runtime decides what to do with the
 * intent (dispatch an action, exit Ink, kick off a refresh
 * workflow). Keeps testability tight: the reducer takes actions,
 * the runtime takes intents, neither one ever needs to mock keypress
 * machinery.
 *
 * Keymap:
 *   j / ↓             move cursor down
 *   k / ↑             move cursor up
 *   g                 jump to top
 *   G                 jump to bottom
 *   tab / shift-tab   cycle sidebar tab forward / backward
 *   s                 cycle sort mode
 *   /                 enter filter prompt
 *   esc               clear filter / quit when no filter
 *   q                 quit
 *   r                 refresh (rescan roots)
 *   a                 add-repo prompt (PR4 wires this up)
 *   enter             drill into the cursored repo (PR3 wires this up)
 *
 * The filter-input mode is owned by the runtime (Ink's TextInput-style
 * shim is hard to model in a pure unit) — when state.focus === 'filter'
 * this handler returns `noop` for non-escape keys so the runtime can
 * route them into the prompt. Escape always returns to list focus.
 */
export function resolveWorkspaceInput(
  input: string,
  key: WorkspaceInputKey,
  state: WorkspaceState
): WorkspaceInputIntent {
  // Help overlay is modal — Esc / `?` close it, every other key is
  // dropped so the underlying state doesn't move while the user is
  // reading the keymap.
  if (state.showHelp) {
    if (key.escape || input === '?' || input === 'q') {
      return { kind: 'action', action: { type: 'close-help' } }
    }
    return { kind: 'noop' }
  }

  if (state.focus === 'filter') {
    if (key.escape) {
      return { kind: 'action', action: { type: 'clear-filter' } }
    }
    if (key.return) {
      return { kind: 'action', action: { type: 'set-focus', focus: 'list' } }
    }
    return { kind: 'noop' }
  }

  if (state.focus === 'add-repo') {
    if (key.escape) {
      return { kind: 'action', action: { type: 'set-focus', focus: 'list' } }
    }
    // Enter, Tab, and printable keys are owned by the runtime so it
    // can drive the path-completion prompt.
    return { kind: 'noop' }
  }

  if (key.escape) {
    if (state.filter) {
      return { kind: 'action', action: { type: 'clear-filter' } }
    }
    return { kind: 'quit' }
  }

  if (input === 'q' && !key.ctrl && !key.meta) {
    return { kind: 'quit' }
  }

  if (key.return) {
    return { kind: 'drill-in' }
  }

  if (key.downArrow || input === 'j') {
    return { kind: 'action', action: { type: 'move-cursor', delta: 1 } }
  }
  if (key.upArrow || input === 'k') {
    return { kind: 'action', action: { type: 'move-cursor', delta: -1 } }
  }
  if (key.pageDown) {
    return { kind: 'action', action: { type: 'move-cursor', delta: 10 } }
  }
  if (key.pageUp) {
    return { kind: 'action', action: { type: 'move-cursor', delta: -10 } }
  }
  if (input === 'g' && !key.shift) {
    return { kind: 'action', action: { type: 'set-cursor', index: 0 } }
  }
  if (input === 'G' || (input === 'g' && key.shift)) {
    return { kind: 'action', action: { type: 'set-cursor', index: Number.MAX_SAFE_INTEGER } }
  }

  if (key.tab) {
    return {
      kind: 'action',
      action: { type: 'cycle-tab', direction: key.shift ? 'previous' : 'next' },
    }
  }
  if (input === 'h' || key.leftArrow) {
    return { kind: 'action', action: { type: 'cycle-tab', direction: 'previous' } }
  }
  if (input === 'l' || key.rightArrow) {
    return { kind: 'action', action: { type: 'cycle-tab', direction: 'next' } }
  }

  if (input === 's') {
    return { kind: 'action', action: { type: 'cycle-sort' } }
  }
  if (input === '/') {
    return { kind: 'action', action: { type: 'set-focus', focus: 'filter' } }
  }
  if (input === 'r') {
    return { kind: 'refresh' }
  }
  if (input === 'a') {
    return { kind: 'add-repo' }
  }
  if (input === '?') {
    return { kind: 'action', action: { type: 'toggle-help' } }
  }

  return { kind: 'noop' }
}
