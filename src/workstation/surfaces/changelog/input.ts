import type { LogInkAction, LogInkState } from '../../runtime/inkViewModel'
import type {
  LogInkInputContext,
  LogInkInputEvent,
  LogInkInputKey,
} from '../../runtime/inkInput'

/**
 * Changelog view local keymap, extracted to its own module (mirrors the
 * #1625 bisect surface). Scoped to `activeView === 'changelog'` so the
 * letters stay free everywhere else. Bindings:
 *
 *   j / k          → scroll line down / up (1 line)
 *   pgdn / pgup    → scroll page down / up (10 lines)
 *   y              → yank text to clipboard
 *   E              → open in $EDITOR (companion to compose's `E` from #913)
 *   c              → create-PR seeded with this changelog
 *   r              → regenerate (skip cache, re-run LLM)
 *
 * Back-out is `<` / Esc handled by the global pop-view path in
 * `inkInput.ts`. The view only renders when `state.changelogView.status`
 * is 'ready' — scroll keystrokes early-return when changelogLineCount
 * is missing so they no-op gracefully during loading / error states.
 *
 * The `gg` / `G` top/bottom jumps for this view are NOT handled here —
 * they live in `inkInput.ts`'s shared `moveToTop`/`moveToBottom` chord
 * handlers alongside the blame/file-history branches, since extracting
 * them would require restructuring those shared handlers. Left in place
 * intentionally (see PR description).
 *
 * Returns `null` when no changelog-local binding matches, so the caller
 * (`getLogInkInputEvents`) falls through to the rest of the router.
 */
export function handleChangelogInput(
  state: LogInkState,
  inputValue: string,
  key: LogInkInputKey,
  context: LogInkInputContext
): LogInkInputEvent[] | null {
  if (state.activeView !== 'changelog') {
    return null
  }

  // Arrows are synonyms for j/k here like on every other surface —
  // they used to be swallowed by the loading-state guard below even
  // when the view was ready, leaving ↓/↑ silently dead.
  if ((inputValue === 'j' || key.downArrow) && context.changelogLineCount) {
    return [action({ type: 'pageChangelog', delta: 1, lineCount: context.changelogLineCount })]
  }
  if ((inputValue === 'k' || key.upArrow) && context.changelogLineCount) {
    return [action({ type: 'pageChangelog', delta: -1, lineCount: context.changelogLineCount })]
  }
  if (key.pageDown && context.changelogLineCount) {
    return [action({ type: 'pageChangelog', delta: 10, lineCount: context.changelogLineCount })]
  }
  if (key.pageUp && context.changelogLineCount) {
    return [action({ type: 'pageChangelog', delta: -10, lineCount: context.changelogLineCount })]
  }
  if (inputValue === 'y') {
    return [{ type: 'yankChangelog' }]
  }
  if (inputValue === 'E') {
    return [{ type: 'openChangelogInEditor' }]
  }
  if (inputValue === 'c') {
    return [{ type: 'startCreatePullRequest' }]
  }
  if (inputValue === 'r') {
    return [{ type: 'regenerateChangelog' }]
  }
  // While loading / errored there's no line count yet — swallow the
  // scroll keys instead of letting them fall through to the global
  // move handler, which used to scroll the HISTORY cursor invisibly
  // beneath this surface (#1348).
  if (inputValue === 'j' || inputValue === 'k' || key.upArrow || key.downArrow || key.pageUp || key.pageDown) {
    return []
  }

  return null
}

function action(actionValue: LogInkAction): LogInkInputEvent {
  return {
    type: 'action',
    action: actionValue,
  }
}
