/**
 * Command palette interaction state — sliced out of `inkViewModel.ts`'s
 * monolith (#1723), following the `themePicker.ts` pattern: state
 * fragment + action union + a pure `reduce(state, action)`.
 *
 * These fields stay flat on `LogInkState` rather than nested under a
 * `commandPalette` sub-object — renderers and the input router read
 * `state.paletteFilter` / `paletteSelectedIndex` / `paletteRecent`
 * directly, and nesting would churn those call sites for no behavior
 * change. `showCommandPalette` deliberately stays OUT of this module
 * and in the composition root: `toggleCommandPalette` closes help /
 * view-keys the same way `toggleHelp`/`toggleThemePicker` close their
 * siblings — that cross-overlay exclusivity is genuinely global state.
 */
export type CommandPaletteFields = {
  paletteFilter: string
  paletteSelectedIndex: number
  paletteRecent: string[]
}

export type CommandPaletteAction =
  | { type: 'toggleCommandPalette' }
  | { type: 'appendPaletteFilter'; value: string }
  | { type: 'backspacePaletteFilter' }
  | { type: 'clearPaletteFilter' }
  | { type: 'movePaletteSelection'; delta: number; commandCount: number }
  | { type: 'recordPaletteRecent'; value: string }

export function createCommandPaletteState(): CommandPaletteFields {
  return {
    paletteFilter: '',
    paletteSelectedIndex: 0,
    paletteRecent: [],
  }
}

function clampIndex(index: number, length: number): number {
  if (length === 0) {
    return 0
  }

  return Math.max(0, Math.min(index, length - 1))
}

/**
 * Reduces the palette's own three fields. `'toggleCommandPalette'` here
 * only resets `paletteFilter`/`paletteSelectedIndex` on open/close — the
 * composition root additionally flips `showCommandPalette` and closes
 * sibling overlays on the same action before merging this result back in.
 */
export function applyCommandPaletteAction(
  state: CommandPaletteFields,
  action: CommandPaletteAction
): CommandPaletteFields {
  switch (action.type) {
    case 'toggleCommandPalette':
      // Reset palette interaction state on every open/close so the next
      // session starts from a clean slate.
      return { ...state, paletteFilter: '', paletteSelectedIndex: 0 }
    case 'appendPaletteFilter':
      return {
        ...state,
        paletteFilter: `${state.paletteFilter}${action.value}`,
        paletteSelectedIndex: 0,
      }
    case 'backspacePaletteFilter':
      return {
        ...state,
        paletteFilter: state.paletteFilter.slice(0, -1),
        paletteSelectedIndex: 0,
      }
    case 'clearPaletteFilter':
      return { ...state, paletteFilter: '', paletteSelectedIndex: 0 }
    case 'movePaletteSelection':
      return {
        ...state,
        paletteSelectedIndex: clampIndex(state.paletteSelectedIndex + action.delta, action.commandCount),
      }
    case 'recordPaletteRecent': {
      const next = [action.value, ...state.paletteRecent.filter((id) => id !== action.value)]
      return { ...state, paletteRecent: next.slice(0, 8) }
    }
    default:
      return state
  }
}
