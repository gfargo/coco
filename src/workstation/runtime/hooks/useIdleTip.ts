/**
 * Idle status-line tip rotation (P4.3, extracted in the 0.72 app.ts
 * decomposition).
 *
 * The footer surfaces a rotating hint during true idle stretches. This
 * cluster used to live inline in `app.ts` as a `useState` tick counter, a
 * timer `useEffect` that bumps it after a grace window and then on a
 * steady cadence, and a derived `idleTip` string. It has been lifted out
 * of the component into this hook so `app.ts` stops carrying the idle-tip
 * timer wiring.
 *
 * The `useState` + timer `useEffect` are reproduced verbatim from the
 * original code — same `IDLE_TIPS_GRACE_MS` / `IDLE_TIPS_INTERVAL_MS`
 * delays, same reset-on-`statusMessage` condition, same
 * `clearTimeout`/`clearInterval` cleanup, same `pickIdleTip` provider
 * argument. This is a behavior-preserving move, not a rewrite. The hook
 * issues its `useState` then `useEffect` in the same order as the
 * original so React's hook ordering is unchanged.
 *
 * `React` is injected (per the runtime's `getLogInkRuntimeContext(React)`
 * convention) because the workstation never statically imports React.
 */

import type * as ReactTypes from 'react'
import type { GitProviderType } from '../../../git/providerData'
import {
  IDLE_TIPS_GRACE_MS,
  IDLE_TIPS_INTERVAL_MS,
  pickIdleTip,
} from '../../chrome/idleTips'
import { isSnapshotMode } from '../../chrome/snapshotMode'

export type UseIdleTipDeps = {
  /** Whether idle tips are enabled (opt-in via `logTui.idleTips`). */
  idleTipsEnabled: boolean | undefined
  /**
   * The live `state.statusMessage`. Any explicit message gates the tip off
   * and resets the rotation cycle.
   */
  statusMessage: string | undefined
  /** The active forge provider, for forge-aware tip wording (PR vs MR). */
  provider: GitProviderType | undefined
}

/**
 * Pure gate over the rotation tick. The tip only renders during a true
 * idle stretch: tips enabled, no active `statusMessage`. Lifted verbatim
 * from the original `app.ts` derivation — same gate, same `pickIdleTip`
 * provider argument — so the cadence + content decision can be tested
 * without spinning React or timers.
 */
export function resolveIdleTip(
  tickIndex: number,
  idleTipsEnabled: boolean | undefined,
  statusMessage: string | undefined,
  provider: GitProviderType | undefined,
): string | undefined {
  // Suppress tip rotation in snapshot mode to keep VHS captures
  // and screenshot stills deterministic (snapshotMode.ts invariant).
  if (isSnapshotMode()) return undefined
  return idleTipsEnabled && !statusMessage
    ? pickIdleTip(tickIndex, provider)
    : undefined
}

/**
 * Idle-tip rotation hook. Issues the `useState` tick counter, then the
 * timer `useEffect`, then derives the gated tip — preserving the exact
 * hook call-order and the effect's dependency array
 * (`[idleTipsEnabled, statusMessage]`) of the original `app.ts` cluster,
 * so React's hook ordering and the timer's reset semantics are unchanged.
 */
export function useIdleTip(
  React: typeof ReactTypes,
  deps: UseIdleTipDeps,
): string | undefined {
  const { idleTipsEnabled, statusMessage, provider } = deps
  const [idleTipIndex, setIdleTipIndex] = React.useState(0)
  React.useEffect(() => {
    if (!idleTipsEnabled) return
    if (statusMessage) {
      // Any explicit message resets the cycle; next idle stretch starts
      // from the grace window again.
      setIdleTipIndex(0)
      return
    }
    let interval: NodeJS.Timeout | undefined
    // Both timer callbacks are function literals (never strings) and the
    // delays are our own `IDLE_TIPS_*_MS` constants — no caller-supplied
    // data flows in, so the eval-injection vector that drives
    // DevSkim DS172411 doesn't apply here.
    // DevSkim: ignore DS172411
    const grace = setTimeout(() => {
      setIdleTipIndex(1)
      // DevSkim: ignore DS172411
      interval = setInterval(() => setIdleTipIndex((tick) => tick + 1), IDLE_TIPS_INTERVAL_MS)
    }, IDLE_TIPS_GRACE_MS)
    return () => {
      clearTimeout(grace)
      if (interval) clearInterval(interval)
    }
  }, [idleTipsEnabled, statusMessage])
  return resolveIdleTip(idleTipIndex, idleTipsEnabled, statusMessage, provider)
}
