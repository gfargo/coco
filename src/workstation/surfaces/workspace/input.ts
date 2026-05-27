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
  | { kind: 'request-delete' }
  | { kind: 'confirm-delete' }
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

  // Confirm-delete is modal: only `y` confirms, anything else cancels.
  if (state.focus === 'confirm-delete') {
    if (input === 'y' || input === 'Y') {
      return { kind: 'confirm-delete' }
    }
    return { kind: 'action', action: { type: 'cancel-delete' } }
  }

  // Escape clears a filter or closes overlays only — it MUST NOT quit
  // the app. Some terminals deliver arrow keys as separate bytes
  // (ESC + [ + letter) and Ink may surface the bare ESC as its own
  // keypress before the rest arrives. Treating that as quit caused
  // "any navigation key restarts the app" because the loop would
  // exit cleanly and tsx watch would relaunch the process.
  if (key.escape) {
    if (state.filter) {
      return { kind: 'action', action: { type: 'clear-filter' } }
    }
    return { kind: 'noop' }
  }

  // Quit is bound to `q` (or Ctrl+C, which Ink handles at the render
  // layer). Same shape as the existing `coco ui` keymap.
  if (input === 'q' && !key.ctrl && !key.meta) {
    return { kind: 'quit' }
  }

  // Tab / Shift+Tab cycles between sidebar and list focus. Always
  // available (in both list and sidebar modes) so the user can always
  // pop back to the panel they need.
  if (key.tab) {
    return {
      kind: 'action',
      action: { type: 'cycle-panel-focus', direction: key.shift ? 'previous' : 'next' },
    }
  }

  // Sidebar focus: j/k changes the active tab; Enter / l / →
  // commits the selection and jumps focus to the list.
  if (state.focus === 'sidebar') {
    if (key.downArrow || input === 'j') {
      return { kind: 'action', action: { type: 'cycle-tab', direction: 'next' } }
    }
    if (key.upArrow || input === 'k') {
      return { kind: 'action', action: { type: 'cycle-tab', direction: 'previous' } }
    }
    if (key.return || key.rightArrow || input === 'l') {
      return { kind: 'action', action: { type: 'set-focus', focus: 'list' } }
    }
    // Global keys (sort, filter, refresh, etc.) still work while
    // the sidebar has focus — fall through to the shared handlers
    // below.
  }

  // List focus: j/k moves the cursor; Enter drills in; h / ←
  // jumps focus to the sidebar.
  if (state.focus === 'list') {
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
    if (input === 'h' || key.leftArrow) {
      return { kind: 'action', action: { type: 'set-focus', focus: 'sidebar' } }
    }
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
  if (input === 'd') {
    return { kind: 'request-delete' }
  }
  if (input === '?') {
    return { kind: 'action', action: { type: 'toggle-help' } }
  }

  return { kind: 'noop' }
}
