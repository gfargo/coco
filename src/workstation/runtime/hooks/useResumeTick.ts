/**
 * Resume-repaint tick (extracted in the post-0.72 app.ts decomposition,
 * item 5 / #1237).
 *
 * When the workstation is suspended (Ctrl-Z) and later resumed (`fg` →
 * SIGCONT), the terminal comes back on the alternate screen buffer with
 * nothing drawn — Ink doesn't repaint on its own, so the user lands on an
 * empty screen. The runtime installs a resume callback into `resumeRef`; the
 * SIGCONT handler invokes it, and this hook's callback bumps a throwaway
 * counter to force the existing React tree to re-render (repaint).
 *
 * This module lifts the cluster — the throwaway `setResumeTick` `useState` and
 * the effect that wires `resumeRef.current` to the tick-bump (and nulls it on
 * cleanup) — out of `app.ts`. The `useState` and effect are **adjacent** in
 * the original, with no intervening hooks, so they move together into one hook
 * called at the original slot; hook order is preserved. The effect is
 * reproduced verbatim — same `!resumeRef` guard, same
 * `resumeRef.current = () => setResumeTick((tick) => tick + 1)` assignment,
 * same cleanup, same `[resumeRef]` dependency array.
 *
 * `resumeRef` stays owned by the runtime (it is also read by the editor /
 * compose / changelog action hooks to re-arm the screen after shelling out)
 * and is passed in.
 *
 * `React` is injected (per the runtime's `getLogInkRuntimeContext(React)`
 * convention) because the workstation never statically imports React.
 */

import type * as ReactTypes from 'react'

export type UseResumeTickDeps = {
  /**
   * The runtime's resume-callback slot. The SIGCONT handler calls
   * `resumeRef.current?.()`; this hook points it at a tick-bump so the tree
   * repaints. Optional — absent in non-interactive / test seams, in which
   * case the hook is a no-op.
   */
  resumeRef?: ReactTypes.MutableRefObject<(() => void) | null>
}

/**
 * Installs the resume-repaint callback into `resumeRef` and bumps a throwaway
 * counter when invoked, forcing the React tree to repaint after `fg`.
 */
export function useResumeTick(
  React: typeof ReactTypes,
  deps: UseResumeTickDeps,
): void {
  const { resumeRef } = deps

  const [, setResumeTick] = React.useState(0)
  React.useEffect(() => {
    if (!resumeRef) {
      return
    }
    resumeRef.current = () => setResumeTick((tick) => tick + 1)
    return () => {
      resumeRef.current = null
    }
  }, [resumeRef])
}
