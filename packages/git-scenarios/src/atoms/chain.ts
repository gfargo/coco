import type { Step } from './types'

/**
 * Sequence atoms into a single `Step`. The composed step runs each
 * input in order, awaiting each before starting the next.
 *
 * `chain()` with no arguments is a valid no-op step — useful as a
 * placeholder while iterating on a scenario.
 *
 * Errors short-circuit: if one step rejects, subsequent steps don't
 * run. The promise rejects with that step's error so the caller's
 * stack trace points at the offending atom rather than the chain
 * wrapper.
 */
export function chain(...steps: Step[]): Step {
  return async (repo) => {
    for (const step of steps) {
      await step(repo)
    }
  }
}

/**
 * Run an atom factory N times, threading the index in so each call
 * can produce a distinct step (different file name, different seed,
 * different commit message). Equivalent to spreading an
 * `Array.from(...).map(...)` into `chain()`, but reads as the
 * intent: "do this N times."
 *
 *   chain(
 *     repeat(8, (i) => addCommit({ message: `feat: step ${i + 1}` })),
 *   )
 */
export function repeat(n: number, factory: (index: number) => Step): Step {
  return chain(...Array.from({ length: n }, (_, i) => factory(i)))
}
