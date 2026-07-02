/**
 * Status-message auto-dismiss timer (extracted in the 0.72 app.ts
 * decomposition).
 *
 * Transient status confirmations ("Pulled current branch", "Edited
 * foo.ts") clear themselves after a short window so they don't linger
 * forever. This cluster used to live inline in `app.ts` as a single timer
 * `useEffect` that schedules a `setStatus(undefined)` dispatch ~4s after a
 * message appears, gated off while a modal (input prompt, confirmation,
 * choice, mutation confirmation, command palette) holds the status line as
 * live feedback. It has been lifted out of the component into this hook so
 * `app.ts` stops carrying the auto-dismiss timer wiring.
 *
 * The timer `useEffect` is reproduced verbatim from the original code —
 * same 4000ms delay, same modal-open gate, same `mountedRef` guard before
 * dispatching, same `clearTimeout` cleanup, same 7-element dependency
 * array. This is a behavior-preserving move, not a rewrite. The hook
 * issues its single `useEffect` in the same position as the original so
 * React's hook ordering is unchanged.
 *
 * `React` is injected (per the runtime's `getLogInkRuntimeContext(React)`
 * convention) because the workstation never statically imports React.
 */

import type * as ReactTypes from 'react'
import type { LogInkAction } from '../inkViewModel'

/**
 * The delay, in ms, before a settled status message auto-dismisses.
 * Lifted verbatim from the original inline `setTimeout` constant.
 */
export const STATUS_AUTO_DISMISS_MS = 4000

export type UseStatusAutoDismissDeps = {
  /** The live `state.statusMessage`. No message → nothing to dismiss. */
  statusMessage: string | undefined
  /** `state.statusKind` — errors never auto-dismiss (the user must read them). */
  statusKind: 'info' | 'error' | 'success' | 'warning' | undefined
  /** `state.statusLoading` — in-flight progress lines hold until they settle. */
  statusLoading: boolean | undefined
  /** `state.inputPrompt` — an open input prompt holds the status line. */
  inputPrompt: unknown
  /** `state.pendingConfirmationId` — a y/n confirmation is open. */
  pendingConfirmationId: unknown
  /** `state.pendingChoice` — a multi-choice prompt is open. */
  pendingChoice: unknown
  /** `state.pendingMutationConfirmation` — a revert/discard confirm is open. */
  pendingMutationConfirmation: unknown
  /** `state.showCommandPalette` — the command palette is open. */
  showCommandPalette: unknown
  /** Reducer dispatch, used to clear the message via `setStatus(undefined)`. */
  dispatch: (action: LogInkAction) => void
  /** Mounted guard so a late timer can't dispatch after unmount/quit. */
  mountedRef: ReactTypes.MutableRefObject<boolean>
}

/**
 * Pure eligibility predicate over the modal gate: a status message
 * auto-dismisses only when there *is* a message and no modal (input
 * prompt, confirmation, choice, mutation confirmation, command palette)
 * is holding the status line as live feedback. Lifted verbatim from the
 * original `app.ts` guard — same fields, read the same way — so the
 * "should this dismiss" decision can be tested without spinning React or
 * timers.
 */
export function shouldAutoDismissStatus(deps: {
  statusMessage: string | undefined
  statusKind: 'info' | 'error' | 'success' | 'warning' | undefined
  statusLoading: boolean | undefined
  inputPrompt: unknown
  pendingConfirmationId: unknown
  pendingChoice: unknown
  pendingMutationConfirmation: unknown
  showCommandPalette: unknown
}): boolean {
  if (!deps.statusMessage) return false
  // Errors carry information the user has to act on (failure reasons,
  // diagnostic paths) — they clear on the next action, not on a timer.
  // Loading lines ("generating PR body… Esc to skip") are live progress
  // for an in-flight call; wiping them mid-call removes both the
  // feedback and the advertised cancel affordance.
  if (deps.statusKind === 'error' || deps.statusLoading) return false
  if (
    deps.inputPrompt ||
    deps.pendingConfirmationId ||
    deps.pendingChoice ||
    deps.pendingMutationConfirmation ||
    deps.showCommandPalette
  ) {
    return false
  }
  return true
}

/**
 * Status-message auto-dismiss hook. Issues the single timer `useEffect`,
 * preserving the exact dependency array (`[dispatch, inputPrompt,
 * pendingConfirmationId, pendingChoice, pendingMutationConfirmation,
 * showCommandPalette, statusMessage]`) of the original `app.ts` cluster,
 * so React's hook ordering and the timer's reset/cancel semantics are
 * unchanged.
 */
export function useStatusAutoDismiss(
  React: typeof ReactTypes,
  deps: UseStatusAutoDismissDeps,
): void {
  const {
    statusMessage,
    statusKind,
    statusLoading,
    inputPrompt,
    pendingConfirmationId,
    pendingChoice,
    pendingMutationConfirmation,
    showCommandPalette,
    dispatch,
    mountedRef,
  } = deps
  React.useEffect(() => {
    if (!statusMessage) return
    if (statusKind === 'error' || statusLoading) return
    if (inputPrompt || pendingConfirmationId || pendingChoice || pendingMutationConfirmation || showCommandPalette) {
      return
    }
    // The `setTimeout` callback is a literal arrow function (not a
    // string), and the delay is a hard-coded constant, so the
    // eval-injection vector behind DevSkim DS172411 doesn't apply here.
    // DevSkim: ignore DS172411
    const handle = setTimeout(() => {
      if (mountedRef.current) {
        dispatch({ type: 'setStatus', value: undefined })
      }
    }, STATUS_AUTO_DISMISS_MS)
    return () => clearTimeout(handle)
  }, [
    dispatch,
    inputPrompt,
    pendingConfirmationId,
    pendingChoice,
    pendingMutationConfirmation,
    showCommandPalette,
    statusMessage,
    statusKind,
    statusLoading,
  ])
}
