/**
 * Commit-detail hydration (extracted in the post-0.72 app.ts decomposition,
 * item 1a / #1237).
 *
 * This module lifts the "load the cursored commit's full detail" cluster out
 * of `app.ts`: the `detail` / `detailLoading` `useState` pair and the single
 * effect that fetches `getCommitDetail(git, selected.hash)` into them once the
 * cursor rests on a commit row. The loaded `detail` drives the inspector's
 * file list (`selectedDetailFile`), the diff/file-preview surfaces, and the
 * footer's loading chrome.
 *
 * The effect is a best-effort loader: the fetch is wrapped in `safe()` (a git
 * error leaves `detail` undefined → the surface shows its "no detail" hint
 * instead of crashing), guarded with an `active` flag flipped false in cleanup
 * so a stale in-flight load can't clobber a newer selection, and toggles
 * `detailLoading` around the await. It is reproduced **verbatim** — the guard,
 * the `active` flag, the `safe()` wrapper, the `setDetailLoading` toggles, and
 * the `[git, selected?.hash]` dependency array are byte-for-byte the same as
 * the original `app.ts` effect. This is a behavior-preserving move, not a
 * rewrite.
 *
 * CRITICAL — hook ordering. In `app.ts` the `detail` / `detailLoading`
 * `useState` pair sits near the top of the hydration-state block (~L504),
 * while the loader effect sits ~600 lines below (~L1104), separated by many
 * intervening hooks (the bisect effects, the issue/PR list loaders,
 * `useContextHydration`, `useDetailHydration`, …). React fires hooks in
 * declaration order, so collapsing the `useState` and the effect into a single
 * hook at one call site would reorder one of them relative to those
 * intervening hooks — moving the `useState` down corrupts every state slot
 * after it (catastrophic), and moving the effect up changes effect-execution
 * order (which the render-snapshot suite does not catch). To preserve ordering
 * exactly, this module exports *two* hooks, each called at the original
 * position:
 *
 *   const { detail, setDetail, detailLoading, setDetailLoading } =
 *     useCommitDetailState(React)                                   // ~L504
 *   ...intervening hooks...
 *   useCommitDetailHydration(React, { git, selected, setDetail, setDetailLoading }) // ~L1104
 *
 * Order correctness wins. `useCommitDetailState` issues only the two
 * `useState`s (in their original slot); `useCommitDetailHydration` issues the
 * effect (in its original slot) and is handed the setters so the loader
 * toggles `detail` / `detailLoading` exactly as before. This mirrors the
 * `useBlameLoadingState` + `useDetailHydration` split (PR 7).
 *
 * `React` is injected (per the runtime's `getLogInkRuntimeContext(React)`
 * convention) because the workstation never statically imports React.
 */

import type * as ReactTypes from 'react'
import type { SimpleGit } from 'simple-git'
import { GitCommitDetail, GitLogCommitRow, getCommitDetail } from '../../../commands/log/data'

/**
 * Best-effort promise unwrap, lifted verbatim from `app.ts`. Swallows the
 * rejection so a git error leaves the detail surface on its "no detail" hint
 * instead of crashing the workstation.
 */
async function safe<T>(promise: Promise<T>): Promise<T | undefined> {
  try {
    return await promise
  } catch {
    return undefined
  }
}

/**
 * Issues only the `detail` / `detailLoading` `useState` pair, in its original
 * `app.ts` position (top of the hydration-state block, ~600 lines above the
 * loader effect). Returns the values (consumed by the inspector / footer) and
 * the setters (threaded into {@link useCommitDetailHydration} so the loader
 * effect can toggle them exactly as the inline code did).
 */
export function useCommitDetailState(React: typeof ReactTypes): {
  detail: GitCommitDetail | undefined
  setDetail: ReactTypes.Dispatch<ReactTypes.SetStateAction<GitCommitDetail | undefined>>
  detailLoading: boolean
  setDetailLoading: ReactTypes.Dispatch<ReactTypes.SetStateAction<boolean>>
} {
  const [detail, setDetail] = React.useState<GitCommitDetail | undefined>(undefined)
  const [detailLoading, setDetailLoading] = React.useState(false)
  return { detail, setDetail, detailLoading, setDetailLoading }
}

export type UseCommitDetailHydrationDeps = {
  /** The active frame's `git`. Drives the `getCommitDetail` fetch. */
  git: SimpleGit
  /** The cursored commit row (drives the `sha`), or `undefined`. */
  selected: GitLogCommitRow | undefined
  /** Writer for the loaded commit detail, from {@link useCommitDetailState}. */
  setDetail: ReactTypes.Dispatch<ReactTypes.SetStateAction<GitCommitDetail | undefined>>
  /** Loading-flag setter, from {@link useCommitDetailState}. */
  setDetailLoading: ReactTypes.Dispatch<ReactTypes.SetStateAction<boolean>>
}

/**
 * Issues the commit-detail loader effect, in its original `app.ts` position.
 * Reproduced verbatim — same `!selected` guard, same `active` cancellation
 * flag, same `safe()` wrapper, same `setDetailLoading` toggles, same
 * `[git, selected?.hash]` dependency array.
 */
export function useCommitDetailHydration(
  React: typeof ReactTypes,
  deps: UseCommitDetailHydrationDeps,
): void {
  const { git, selected, setDetail, setDetailLoading } = deps

  React.useEffect(() => {
    let active = true

    async function loadDetail(): Promise<void> {
      if (!selected) {
        setDetail(undefined)
        // Reset the loading flag too: if the selection clears while a fetch is
        // in flight, the cleanup flips `active` false so the in-flight branch
        // below never runs `setDetailLoading(false)` — without this the
        // inspector is left showing "Loading commit details…" indefinitely.
        setDetailLoading(false)
        return
      }

      setDetailLoading(true)
      const nextDetail = await safe(getCommitDetail(git, selected.hash))

      if (active) {
        setDetail(nextDetail)
        setDetailLoading(false)
      }
    }

    void loadDetail()

    return () => {
      active = false
    }
  }, [git, selected?.hash])
}
