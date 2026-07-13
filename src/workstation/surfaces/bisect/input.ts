import type { LogInkAction, LogInkState } from '../../runtime/inkViewModel'
import type {
  LogInkInputContext,
  LogInkInputEvent,
  LogInkInputKey,
} from '../../runtime/inkInput'

/**
 * Bisect view action keys (#784 / #1352) — the first per-surface input
 * module extracted out of `inkInput.ts`'s monolithic router (#1625 first
 * surface). Scoped entirely to `state.activeView === 'bisect' &&
 * state.focus === 'commits'`, with no dependency on any other view's
 * state, which is what makes it safe to lift verbatim.
 *
 * Mark-good is `y` (yes/good), NOT bare `g`: the old `g` binding shadowed
 * the global chord prefix, so a user reflexively typing `gh`/`gs` to
 * navigate away silently ran `git bisect good` on the current candidate.
 * `g` now arms the chord on bisect like everywhere else (`gh`/`gs`/`gx`
 * work mid-bisect); `b` keeps the `pendingKey !== 'g'` guard so `gb`
 * still reaches branches. The trade: `y` yank is unavailable on this one
 * transient view (the candidate sha is visible in the panel).
 *
 * Returns `null` when no bisect-local binding matches, so the caller
 * (`getLogInkInputEvents`) falls through to the rest of the router.
 */
export function handleBisectInput(
  state: LogInkState,
  inputValue: string,
  key: LogInkInputKey,
  context: LogInkInputContext
): LogInkInputEvent[] | null {
  if (state.activeView !== 'bisect' || state.focus !== 'commits') {
    return null
  }

  // Gated off once the bisect has terminated: the completion panel
  // rebinds y/Y to yank the first-bad sha (#879 item 3), and there is no
  // candidate left to mark. Also gated on an ACTIVE session — like
  // `s`/`R`, marking is meaningless from the empty-state view and used
  // to surface a raw `git bisect` error ("You need to start by \"git
  // bisect start\"") on the status line.
  if (
    inputValue === 'y' &&
    !key.ctrl &&
    !key.meta &&
    context.bisectActive &&
    !context.bisectCompletionSha
  ) {
    return [{ type: 'runWorkflowAction', id: 'bisect-good' }]
  }
  if (inputValue === 'b' && state.pendingKey !== 'g' && context.bisectActive) {
    return [{ type: 'runWorkflowAction', id: 'bisect-bad' }]
  }
  if (inputValue === 's') {
    // #879 item 4 — `s` is context-overloaded. When a bisect is active,
    // the original #784 behavior applies: skip the current candidate.
    // When no bisect is active, the empty-state view is showing and `s`
    // enters the in-TUI start wizard: push history, mark the user as
    // picking the BAD commit, surface a sticky banner explaining the
    // next step.
    if (context.bisectActive) {
      return [{ type: 'runWorkflowAction', id: 'bisect-skip' }]
    }
    return [
      action({ type: 'setBisectPickMode', mode: 'bad' }),
      action({ type: 'pushView', value: 'history' }),
      action({
        type: 'setStatus',
        value: 'Pick the BAD commit (where the bug is present). Enter to confirm · esc to cancel',
      }),
    ]
  }
  if (inputValue === 'x' && context.bisectActive) {
    return [action({ type: 'setPendingConfirmation', value: 'bisect-reset' })]
  }
  // #879 item 5 — `R` (capital) on an active bisect view opens an input
  // prompt for a test command. Only fires when a session is active
  // because `git bisect run` is meaningless otherwise. Lower-case `r`
  // stays free for future view-local bindings.
  if (inputValue === 'R' && context.bisectActive) {
    return [action({
      type: 'openInputPrompt',
      kind: 'bisect-run-command',
      label: 'Bisect run command (e.g. npm test, pytest -k regression)',
    })]
  }

  return null
}

function action(actionValue: LogInkAction): LogInkInputEvent {
  return {
    type: 'action',
    action: actionValue,
  }
}
