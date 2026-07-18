/**
 * Help overlay interaction state (#1137, #1355) — sliced out of
 * `inkViewModel.ts`'s monolith (#1723), following the `themePicker.ts`
 * pattern: state fragment + action union + a pure `reduce(state, action)`.
 *
 * These fields stay flat on `LogInkState` — renderers, the input router,
 * and `setPendingConfirmation`/`setPendingChoice`'s overlay-precedence
 * fix (#1429) all read `state.showHelp` / `helpScrollOffset` /
 * `helpFilter` / `helpFilterMode` directly, and nesting would churn all
 * of those for no behavior change.
 *
 * `showViewKeys` deliberately stays OUT of this module and in the
 * composition root: it's the which-key strip, a sibling overlay to
 * help rather than one of help's own fields, and `toggleViewKeys`
 * closes help the same way `toggleHelp` closes the strip — that
 * cross-overlay exclusivity is genuinely global state (mirrors
 * `toggleThemePicker`'s sibling-closes).
 */
export type HelpOverlayFields = {
  showHelp: boolean
  helpScrollOffset: number
  helpFilter: string
  helpFilterMode: boolean
}

export type HelpOverlayAction =
  | { type: 'toggleHelp' }
  | { type: 'scrollHelp'; delta: number }
  | { type: 'openHelpFilter' }
  | { type: 'appendHelpFilter'; value: string }
  | { type: 'backspaceHelpFilter' }
  | { type: 'commitHelpFilter' }
  | { type: 'clearHelpFilter' }

export function createHelpOverlayState(): HelpOverlayFields {
  return {
    showHelp: false,
    helpScrollOffset: 0,
    helpFilter: '',
    helpFilterMode: false,
  }
}

/**
 * Reduces help's own four fields. `'toggleHelp'` here only flips
 * `showHelp` and resets the scroll/filter — the composition root
 * additionally closes the view-keys strip and command palette on the
 * same action before merging this result back in.
 */
export function applyHelpOverlayAction(
  state: HelpOverlayFields,
  action: HelpOverlayAction
): HelpOverlayFields {
  switch (action.type) {
    case 'toggleHelp':
      return {
        ...state,
        showHelp: !state.showHelp,
        // Reset scroll position when toggling either direction so the
        // next open always starts at the top — feels more predictable
        // than picking up where the user last scrolled.
        helpScrollOffset: 0,
        helpFilter: '',
        helpFilterMode: false,
      }
    case 'scrollHelp':
      // No upper-bound clamp here — the renderer caps the offset
      // against the actual content height at render time. The
      // reducer just prevents going below 0 so callers can safely
      // pass negative deltas without us going past the top.
      return { ...state, helpScrollOffset: Math.max(0, state.helpScrollOffset + action.delta) }
    case 'openHelpFilter':
      return { ...state, helpFilterMode: true }
    case 'appendHelpFilter':
      // Typing narrows from the top — reset the scroll so the first
      // match is visible instead of whatever row the user had reached.
      return { ...state, helpFilter: state.helpFilter + action.value, helpScrollOffset: 0 }
    case 'backspaceHelpFilter':
      return { ...state, helpFilter: state.helpFilter.slice(0, -1), helpScrollOffset: 0 }
    case 'commitHelpFilter':
      // Enter keeps the narrowed list but returns j/k to scrolling.
      return { ...state, helpFilterMode: false }
    case 'clearHelpFilter':
      return { ...state, helpFilter: '', helpFilterMode: false, helpScrollOffset: 0 }
    default:
      return state
  }
}
