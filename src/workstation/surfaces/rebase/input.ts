import type { LogInkAction, LogInkState } from '../../runtime/inkViewModel'
import type {
  LogInkInputContext,
  LogInkInputEvent,
  LogInkInputKey,
} from '../../runtime/inkInput'

/**
 * In-TUI interactive rebase surface (#1359), extracted out of
 * `inkInput.ts`'s monolithic router (#1625 second surface, following
 * `surfaces/bisect/input.ts`). Scoped entirely to `state.activeView ===
 * 'rebase' && state.rebasePlan`, with no dependency on any other view's
 * state, which is what makes it safe to lift verbatim.
 *
 * Returns `null` when no rebase-local binding matches, so the caller
 * (`getLogInkInputEvents`) falls through to the rest of the router.
 */
export function handleRebaseInput(
  state: LogInkState,
  inputValue: string,
  key: LogInkInputKey,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- signature kept symmetric with handleBisectInput; no rebase binding reads context
  context: LogInkInputContext
): LogInkInputEvent[] | null {
  if (state.activeView !== 'rebase' || !state.rebasePlan) {
    return null
  }

  // #1446 — rebase-plan discard guard. A fully retagged/reordered
  // rebase plan is expensive to recreate; Esc-ing away should confirm
  // before silently dropping it, matching the compose-draft pattern.
  // The confirm is only raised when Esc WOULD pop away from the rebase
  // view (viewStack > 1) — otherwise there's nowhere to go and Esc
  // is a no-op anyway.
  if (key.escape && state.viewStack.length > 1) {
    return [action({ type: 'setPendingConfirmation', value: 'discard-rebase-plan' })]
  }

  // ── In-TUI interactive rebase surface (#1359) ───────────────────────
  // The plan claims its keys while the view is active: j/k cursor, J/K
  // reorder, p/s/f/d/e retag, r reword (prompt), Enter executes (behind
  // a y-confirm), Esc pops (which clears the plan). Placed before every
  // other single-letter handler so the rebase letters can't leak into
  // sort/fixup/diff-toggle semantics.
  if (inputValue === 'J') {
    return [action({ type: 'moveRebaseRow', delta: 1 })]
  }
  if (inputValue === 'K') {
    return [action({ type: 'moveRebaseRow', delta: -1 })]
  }
  if (inputValue === 'p') {
    return [action({ type: 'setRebaseAction', action: 'pick' })]
  }
  if (inputValue === 's') {
    return [action({ type: 'setRebaseAction', action: 'squash' })]
  }
  if (inputValue === 'f') {
    return [action({ type: 'setRebaseAction', action: 'fixup' })]
  }
  if (inputValue === 'd') {
    return [action({ type: 'setRebaseAction', action: 'drop' })]
  }
  if (inputValue === 'e') {
    return [action({ type: 'setRebaseAction', action: 'edit' })]
  }
  if (inputValue === 'r') {
    const row = state.rebasePlan.rows[state.rebasePlan.selectedIndex]
    return [action({
      type: 'openInputPrompt',
      kind: 'rebase-reword',
      label: `New message for ${row?.shortSha ?? 'commit'}`,
      initial: row?.newMessage ?? row?.subject ?? '',
    })]
  }
  if (key.return) {
    return [action({ type: 'setPendingConfirmation', value: 'execute-rebase-plan' })]
  }

  if (key.upArrow || inputValue === 'k') {
    return [action({ type: 'moveRebaseCursor', delta: -1 })]
  }

  if (key.downArrow || inputValue === 'j') {
    return [action({ type: 'moveRebaseCursor', delta: 1 })]
  }

  return null
}

function action(actionValue: LogInkAction): LogInkInputEvent {
  return {
    type: 'action',
    action: actionValue,
  }
}
