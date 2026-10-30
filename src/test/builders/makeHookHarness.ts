import type * as ReactTypes from 'react'

/**
 * A minimal React stand-in whose `useRef`, `useCallback` and `useEffect`
 * behave like React's with respect to DEPENDENCY ARRAYS: a callback keeps
 * its first identity until a dependency changes (`Object.is`), and an
 * effect re-runs only when one does, after the cleanup its previous run
 * returned. Call order identifies the slot, as in real hooks. Built for tests that are about *when* a hook recomputes,
 * which the simpler fakes elsewhere (one memo slot, effects never run)
 * cannot express.
 *
 * Usage:
 *   const harness = makeHookHarness()
 *   const result = harness.render((React) => useThing(React, deps))
 *   harness.render((React) => useThing(React, nextDeps))   // re-render
 *   harness.unmount()                                       // run cleanups
 */
export function makeHookHarness() {
  const refs: Array<{ current: unknown }> = []
  const callbacks: Array<{ fn: unknown; deps: readonly unknown[] | undefined }> = []
  const effects: Array<{ deps: readonly unknown[] | undefined; ran: boolean; cleanup?: () => void }> = []
  let refCursor = 0
  let callbackCursor = 0
  let effectCursor = 0
  let pendingEffects: Array<() => void> = []

  const changed = (a: readonly unknown[] | undefined, b: readonly unknown[] | undefined) =>
    !a || !b || a.length !== b.length || a.some((value, i) => !Object.is(value, b[i]))

  const React = {
    useRef: <T,>(initial: T) => {
      if (refCursor >= refs.length) refs.push({ current: initial })
      return refs[refCursor++] as { current: T }
    },
    useCallback: <T,>(fn: T, deps?: readonly unknown[]): T => {
      const slot = callbackCursor++
      if (slot >= callbacks.length) {
        callbacks.push({ fn, deps })
      } else if (changed(callbacks[slot].deps, deps)) {
        callbacks[slot] = { fn, deps }
      }
      return callbacks[slot].fn as T
    },
    useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => {
      const slot = effectCursor++
      const run = () => {
        effects[slot].cleanup?.()
        const cleanup = effect()
        effects[slot].cleanup = typeof cleanup === 'function' ? cleanup : undefined
      }
      if (slot >= effects.length) {
        effects.push({ deps, ran: true })
        pendingEffects.push(run)
      } else if (changed(effects[slot].deps, deps)) {
        effects[slot] = { ...effects[slot], deps, ran: true }
        pendingEffects.push(run)
      }
    },
  } as unknown as typeof ReactTypes

  return {
    React,
    /** Run the hook for one render, then flush the effects whose dependencies changed. */
    render<T>(run: (React: typeof ReactTypes) => T): T {
      refCursor = 0
      callbackCursor = 0
      effectCursor = 0
      pendingEffects = []
      const result = run(React)
      const toRun = pendingEffects
      pendingEffects = []
      toRun.forEach((effect) => effect())
      return result
    },
    /** Run every effect's outstanding cleanup, as an unmount would. */
    unmount(): void {
      for (const effect of effects) {
        effect.cleanup?.()
        effect.cleanup = undefined
      }
    },
  }
}
