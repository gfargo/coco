/**
 * Shared spinner-tick driver for loading states (extracted in the 0.72
 * app.ts decomposition).
 *
 * A single shared animation tick drives every loading surface. This
 * cluster used to live inline in `app.ts` as a `useState` frame counter,
 * an `anyLoading` boolean-OR over the live `state.*` loading flags, and a
 * timer `useEffect` that advances the frame every `SPINNER_TICK_MS` while
 * something is loading (and resets to 0 when nothing is). It has been
 * lifted out of the component into this hook so `app.ts` stops carrying
 * the spinner-tick timer wiring.
 *
 * The `useState` + `anyLoading` derivation + timer `useEffect` are
 * reproduced verbatim from the original code — same `SPINNER_TICK_MS`
 * cadence, same "tick only while loading" gate, same reset-to-0 when idle,
 * same `clearInterval` cleanup, same `[anyLoading]` dependency array. This
 * is a behavior-preserving move, not a rewrite. The hook issues its
 * `useState` then `useEffect` in the same order as the original so React's
 * hook ordering is unchanged.
 *
 * `React` is injected (per the runtime's `getLogInkRuntimeContext(React)`
 * convention) because the workstation never statically imports React.
 */

import type * as ReactTypes from 'react'
import { SPINNER_TICK_MS } from '../../chrome/spinner'

export type UseSpinnerFrameDeps = {
  /** `state.splitPlan?.status` — ticks while `'loading'` or `'applying'`. */
  splitPlanStatus: string | undefined
  /** `state.changelogView.status` — ticks while `'loading'`. */
  changelogStatus: string | undefined
  /** `state.commitCompose.loading` — AI commit draft in flight. */
  commitComposeLoading: boolean
  /** `state.remoteOp` — a remote operation (push/fetch/PR) in flight. */
  remoteOp: unknown
  /** `state.statusLoading` — `git status` refresh in flight. */
  statusLoading: unknown
  /** `state.pendingItemAction` — an inline list-item action (delete/checkout). */
  pendingItemAction: unknown
}

/**
 * Pure gate over the spinner tick: whether any loading surface is active.
 * The boolean-OR is lifted verbatim from the original `app.ts`
 * derivation — same flags, read the same way — so the "is anything
 * loading" decision can be tested without spinning React or timers.
 */
export function computeAnyLoading(deps: UseSpinnerFrameDeps): boolean {
  return (
    deps.splitPlanStatus === 'loading' ||
    deps.splitPlanStatus === 'applying' ||
    deps.changelogStatus === 'loading' ||
    deps.commitComposeLoading ||
    Boolean(deps.remoteOp) ||
    Boolean(deps.statusLoading) ||
    // Keep the shared spinner ticking while a list-item action (delete
    // or checkout) is in flight so its inline pending glyph animates
    // instead of freezing.
    Boolean(deps.pendingItemAction)
  )
}

/**
 * Shared spinner-tick hook. Issues the `useState` frame counter, then the
 * timer `useEffect` — preserving the exact hook call-order and the
 * effect's dependency array (`[anyLoading]`) of the original `app.ts`
 * cluster, so React's hook ordering and the timer's pause/reset semantics
 * are unchanged. Returns the current frame index; the renderer derives a
 * spinner glyph from `frame % FRAMES.length`.
 */
export function useSpinnerFrame(
  React: typeof ReactTypes,
  deps: UseSpinnerFrameDeps,
): number {
  const [spinnerFrame, setSpinnerFrame] = React.useState(0)
  const anyLoading = computeAnyLoading(deps)
  React.useEffect(() => {
    if (!anyLoading) {
      // Reset to 0 so the next loading state starts from a known
      // frame instead of wherever the last animation left off.
      setSpinnerFrame(0)
      return
    }
    // DevSkim: ignore DS172411 — callback is a function literal, delay
    // is our own constant, no caller-supplied data flows through.
    const id = setInterval(() => setSpinnerFrame((tick) => tick + 1), SPINNER_TICK_MS)
    return () => clearInterval(id)
  }, [anyLoading])
  return spinnerFrame
}
