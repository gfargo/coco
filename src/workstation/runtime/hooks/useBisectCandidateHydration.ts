/**
 * Bisect-candidate detail hydration (extracted in the post-0.72 app.ts
 * decomposition, item 2 / #1237; the feature itself is #879).
 *
 * This module lifts the "load commit detail for the active bisect's current
 * candidate" cluster out of `app.ts`: the `bisectCandidateDetail` /
 * `bisectCandidateLoading` `useState` pair and the effect that fetches
 * `getCommitDetail(git, bisect.currentSha)` into them once the bisect view is
 * active. The loaded detail lets the bisect surface show "what changed here"
 * alongside the decision keys; any failure leaves the surface in its
 * decision-log-only mode (best-effort, never crash).
 *
 * The effect is reproduced **verbatim** — the same empty-sha guard, the
 * `active` cancellation flag, the `safe()` wrapper, the `setBisectCandidateLoading`
 * toggles, and the `[git, bisectCandidateSha]` dependency array are
 * byte-for-byte the same as the original `app.ts` effect. This is a
 * behavior-preserving move, not a rewrite.
 *
 * `setBisectCandidateDetail` / `setBisectCandidateLoading` are written *only*
 * by this effect, so the pair is owned here.
 *
 * CRITICAL — hook ordering. In `app.ts` the `useState` pair (~L858) and the
 * effect (~L871) are *not* adjacent: a `useBlameLoadingState` call sits between
 * them. Collapsing the `useState` and the effect into a single hook at one call
 * site would reorder one of them relative to that intervening hook — moving the
 * `useState` past it corrupts the state slots (catastrophic), and moving the
 * effect changes effect-execution order (which the render-snapshot suite does
 * not catch). To preserve ordering exactly, this module exports *two* hooks,
 * each called at the original position:
 *
 *   const { bisectCandidateDetail, setBisectCandidateDetail, ... } =
 *     useBisectCandidateState(React)                                    // ~L858
 *   const { blameLoading, setBlameLoading } = useBlameLoadingState(React) // ~L867
 *   useBisectCandidateHydration(React, { git, bisectCandidateSha, ... })  // ~L871
 *
 * Order correctness wins. Mirrors the `useCommitDetailState` +
 * `useCommitDetailHydration` split (item 1a).
 *
 * `React` is injected (per the runtime's `getLogInkRuntimeContext(React)`
 * convention) because the workstation never statically imports React.
 */

import type * as ReactTypes from 'react'
import type { SimpleGit } from 'simple-git'
import { GitCommitDetail, getCommitDetail } from '../../../git/logData'

/**
 * Best-effort promise unwrap, lifted verbatim from `app.ts`. Swallows the
 * rejection so a git error leaves the bisect surface in its decision-log-only
 * mode instead of crashing the workstation.
 */
async function safe<T>(promise: Promise<T>): Promise<T | undefined> {
  try {
    return await promise
  } catch {
    return undefined
  }
}

/**
 * Issues only the bisect-candidate `useState` pair, in its original `app.ts`
 * position (next to the bisect comment block, just above the
 * `useBlameLoadingState` call). Returns the values (read by the bisect surface)
 * and the setters (threaded into {@link useBisectCandidateHydration} so the
 * loader can toggle them exactly as the inline code did). A position-preserving
 * split; see the module header.
 */
export function useBisectCandidateState(React: typeof ReactTypes): {
  bisectCandidateDetail: GitCommitDetail | undefined
  setBisectCandidateDetail: ReactTypes.Dispatch<
    ReactTypes.SetStateAction<GitCommitDetail | undefined>
  >
  bisectCandidateLoading: boolean
  setBisectCandidateLoading: ReactTypes.Dispatch<ReactTypes.SetStateAction<boolean>>
} {
  const [bisectCandidateDetail, setBisectCandidateDetail] = React.useState<
    GitCommitDetail | undefined
  >(undefined)
  const [bisectCandidateLoading, setBisectCandidateLoading] = React.useState(false)
  return {
    bisectCandidateDetail,
    setBisectCandidateDetail,
    bisectCandidateLoading,
    setBisectCandidateLoading,
  }
}

export type UseBisectCandidateHydrationDeps = {
  /** The active frame's `git`. Drives the `getCommitDetail` fetch. */
  git: SimpleGit
  /**
   * The bisect's current candidate sha (`''` when the bisect view isn't active
   * or no bisect is running). Empty ⇒ clear the detail and skip the fetch.
   */
  bisectCandidateSha: string
  /** Writer for the loaded detail, from {@link useBisectCandidateState}. */
  setBisectCandidateDetail: ReactTypes.Dispatch<
    ReactTypes.SetStateAction<GitCommitDetail | undefined>
  >
  /** Loading-flag setter, from {@link useBisectCandidateState}. */
  setBisectCandidateLoading: ReactTypes.Dispatch<ReactTypes.SetStateAction<boolean>>
}

/**
 * Issues the bisect-candidate loader effect, in its original `app.ts` position.
 * Reproduced verbatim — same empty-sha guard, `active` cancellation flag,
 * `safe()` wrapper, `setBisectCandidateLoading` toggles, and
 * `[git, bisectCandidateSha]` dependency array.
 */
export function useBisectCandidateHydration(
  React: typeof ReactTypes,
  deps: UseBisectCandidateHydrationDeps,
): void {
  const {
    git,
    bisectCandidateSha,
    setBisectCandidateDetail,
    setBisectCandidateLoading,
  } = deps

  React.useEffect(() => {
    if (!bisectCandidateSha) {
      setBisectCandidateDetail(undefined)
      setBisectCandidateLoading(false)
      return
    }
    let active = true
    setBisectCandidateLoading(true)
    void (async () => {
      const next = await safe(getCommitDetail(git, bisectCandidateSha))
      if (active) {
        setBisectCandidateDetail(next)
        setBisectCandidateLoading(false)
      }
    })()
    return () => { active = false }
  }, [git, bisectCandidateSha])
}
