/**
 * Debounced per-cursor detail hydration (extracted in the 0.72 app.ts
 * decomposition, PR 7).
 *
 * This module lifts the *most timing-sensitive* cluster so far out of
 * `app.ts`: the three debounced "hydrate detail on cursor-rest" effects,
 * plus the `blameLoading` `useState` the blame effect toggles.
 *
 *   1. Issue detail   — debounced ~250ms; when the issues view is active,
 *      fetch the cursored issue's detail (from the filtered issue list)
 *      into the `issueDetailByNumber` cache via `setContext`.
 *   2. PR detail      — debounced ~250ms; same shape for the cursored
 *      PR-triage row → `pullRequestDetailByNumber`.
 *   3. Blame          — debounced ~150ms; fetch `getBlame` for
 *      `state.blamePath` into `blameByPath`, toggling `blameLoading`.
 *
 * Each effect:
 *   - debounces with a `setTimeout(debounceMs)` that resets on every
 *     cursor move (the cleanup `clearTimeout`s the pending timer);
 *   - captures the `issuedAtDepth = runtimes.length - 1` frame-tag
 *     **BEFORE the await** and passes it to `setContext` so an in-flight
 *     load lands on the repo-stack frame that issued it, not whichever
 *     frame is on top when the fetch resolves;
 *   - guards stale results with an `active` flag flipped false in cleanup;
 *   - skips the fetch when the number/path is already cached.
 *
 * These three effects are reproduced **verbatim and separate** — the
 * debounce delays (250 / 250 / 150), the `active` cancellation flag, the
 * `clearTimeout` cleanup, the cache-skip check, the `setBlameLoading`
 * toggles, and the `issuedAtDepth` capture-before-await are byte-for-byte
 * the same as the original `app.ts` cluster, and the dependency arrays are
 * unchanged. This is a behavior-preserving move, not a rewrite. They are
 * deliberately NOT unified despite their similar shape.
 *
 * CRITICAL — hook ordering. In the original component the `blameLoading`
 * `useState` (issued at ~1111, next to the bisect-candidate `useState`s)
 * sits ~300 lines *above* the three effects (~1427), separated by many
 * intervening hooks (the bisect-candidate effects, `contextStatusRef`, the
 * `forge` `useMemo`, the issue/PR list loaders, …). React fires hooks in
 * declaration order, so collapsing the `useState` and the effects into a
 * single hook at one call site would reorder the `useState` relative to
 * those intervening hooks. To preserve ordering exactly, this module
 * exports *two* hooks, each called at the original position:
 *
 *   const { blameLoading, setBlameLoading } = useBlameLoadingState(React) // ~1111
 *   ...bisect effects, forge useMemo, list loaders...
 *   useDetailHydration(React, { ..., setBlameLoading })                   // ~1427
 *
 * Order correctness wins. `useBlameLoadingState` issues only the
 * `blameLoading` `useState` (in its original slot); `useDetailHydration`
 * issues the three effects (in their original slot) and is handed
 * `setBlameLoading` so the blame effect can toggle the flag exactly as
 * before.
 *
 * `React` is injected (per the runtime's `getLogInkRuntimeContext(React)`
 * convention) because the workstation never statically imports React.
 */

import type * as ReactTypes from 'react'
import type { SimpleGit } from 'simple-git'
import { getBlame } from '../../../git/blameData'
import { getFileHistory } from '../../../git/fileHistoryData'
import type { ForgeActions } from '../../../git/forgeActions'
import type { LogInkState } from '../inkViewModel'
import type { LogInkContext } from '../types'

/** Debounce window for issue / PR detail hydration. Lifted verbatim. */
export const DETAIL_HYDRATION_DELAY_MS = 250
/** Debounce window for blame hydration. Lifted verbatim. */
export const BLAME_HYDRATION_DELAY_MS = 150
/** Debounce window for file-history hydration (#COCO-14). */
export const FILE_HISTORY_HYDRATION_DELAY_MS = 150

/** The filtered issue-list element type, as derived from the live context. */
type IssueListItemType = NonNullable<NonNullable<LogInkContext['issueList']>['issues']>[number]
/** The filtered PR-triage-list element type, as derived from the live context. */
type PullRequestListItemType =
  NonNullable<NonNullable<LogInkContext['pullRequestList']>['pullRequests']>[number]

/**
 * Pure cache-skip predicate: should the cursored key be hydrated, i.e. is
 * it *absent* from its detail cache? Mirrors the original inline guard
 * `if (cache?.has(key)) return` — returns `false` when the key is already
 * cached (skip the fetch), `true` otherwise (hydrate). Pulled out so the
 * "fetch only if not already cached" decision is unit-testable without
 * spinning React, debounce timers, or a forge adapter.
 *
 * The effects below keep their cache checks inline and byte-for-byte (the
 * blame effect's check additionally clears the loading flag on a hit), so
 * this helper documents and tests the decision rather than replacing it.
 */
export function shouldHydrate<K>(
  cursoredKey: K,
  cache: { has(key: K): boolean } | undefined,
): boolean {
  return !cache?.has(cursoredKey)
}

/**
 * Issues only the `blameLoading` `useState`, in its original `app.ts`
 * position (next to the bisect-candidate `useState`s, ~300 lines above the
 * effects). Returns both the flag (for the blame surface / MainPanelExtras)
 * and the setter (threaded into {@link useDetailHydration} so the blame
 * effect can toggle it exactly as the inline code did).
 */
export function useBlameLoadingState(React: typeof ReactTypes): {
  blameLoading: boolean
  setBlameLoading: ReactTypes.Dispatch<ReactTypes.SetStateAction<boolean>>
} {
  // On-demand blame hydration flag (#0.71). True while the debounced
  // `getBlame` for the active `state.blamePath` is in flight; the blame
  // surface shows a loading placeholder until the parse lands in the
  // `blameByPath` cache.
  const [blameLoading, setBlameLoading] = React.useState(false)
  return { blameLoading, setBlameLoading }
}

/**
 * Issues only the `fileHistoryLoading` `useState`, in its `app.ts` position
 * immediately after `useBlameLoadingState` (hook ordering preserved).
 * Returns both the flag (for the file-history surface / MainPanelExtras)
 * and the setter (threaded into {@link useDetailHydration}).
 */
export function useFileHistoryLoadingState(React: typeof ReactTypes): {
  fileHistoryLoading: boolean
  setFileHistoryLoading: ReactTypes.Dispatch<ReactTypes.SetStateAction<boolean>>
} {
  const [fileHistoryLoading, setFileHistoryLoading] = React.useState(false)
  return { fileHistoryLoading, setFileHistoryLoading }
}

export type UseDetailHydrationDeps = {
  /** The active frame's `git`. Drives the blame `getBlame` fetch. */
  git: SimpleGit
  /** The forge adapter — issue / PR detail fetches. */
  forge: ForgeActions
  /** The full reducer state (cursor indices, `blamePath`, `activeView`). */
  state: LogInkState
  /** The active frame's loaded context (the detail caches live here). */
  context: LogInkContext
  /** Repo-stack runtimes — `runtimes.length - 1` is the frame-tag depth. */
  runtimes: readonly unknown[]
  /** The filtered issue list (from `useFilteredLists`). */
  filteredIssueList: IssueListItemType[]
  /** The filtered PR-triage list (from `useFilteredLists`). */
  filteredPullRequestTriageList: PullRequestListItemType[]
  /** Frame-tagging context writer (`setContext(next, issuedAtDepth)`). */
  setContext: (
    arg: LogInkContext | ((prev: LogInkContext) => LogInkContext),
    targetDepth?: number,
  ) => void
  /** Blame loading-flag setter, from {@link useBlameLoadingState}. */
  setBlameLoading: ReactTypes.Dispatch<ReactTypes.SetStateAction<boolean>>
  /** File-history loading-flag setter, from {@link useFileHistoryLoadingState}. */
  setFileHistoryLoading: ReactTypes.Dispatch<ReactTypes.SetStateAction<boolean>>
}

/**
 * Issues the three debounced detail-hydration effects, in their original
 * `app.ts` order and position (issue detail, then PR detail, then blame).
 * Each effect is reproduced verbatim — same debounce delay, same `active`
 * cancellation flag, same `issuedAtDepth = runtimes.length - 1`
 * frame-tag captured *before* the `await`, same cache-skip check, same
 * `clearTimeout` cleanup, same dependency array.
 */
export function useDetailHydration(
  React: typeof ReactTypes,
  deps: UseDetailHydrationDeps,
): void {
  const {
    git,
    forge,
    state,
    context,
    runtimes,
    filteredIssueList,
    filteredPullRequestTriageList,
    setContext,
    setBlameLoading,
    setFileHistoryLoading,
  } = deps

  React.useEffect(() => {
    if (state.activeView !== 'issues') return
    const cursored = filteredIssueList[
      Math.min(state.selectedIssueIndex, Math.max(0, filteredIssueList.length - 1))
    ]
    if (!cursored) return
    if (context.issueDetailByNumber?.has(cursored.number)) return

    const issuedAtDepth = runtimes.length - 1
    let active = true
    const timer = setTimeout(async () => {
      const result = await forge.getIssueDetail(cursored.number)
      if (!active || !result.ok) return
      setContext(
        (current) => ({
          ...current,
          issueDetailByNumber: new Map(current.issueDetailByNumber || []).set(
            result.detail.number,
            result.detail
          ),
        }),
        issuedAtDepth,
      )
    }, DETAIL_HYDRATION_DELAY_MS)

    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [
    runtimes.length,
    state.activeView,
    state.selectedIssueIndex,
    filteredIssueList,
    context.issueDetailByNumber,
    setContext,
  ])

  React.useEffect(() => {
    if (state.activeView !== 'pull-request-triage') return
    const cursored = filteredPullRequestTriageList[
      Math.min(
        state.selectedPullRequestTriageIndex,
        Math.max(0, filteredPullRequestTriageList.length - 1)
      )
    ]
    if (!cursored) return
    if (context.pullRequestDetailByNumber?.has(cursored.number)) return

    const issuedAtDepth = runtimes.length - 1
    let active = true
    const timer = setTimeout(async () => {
      const result = await forge.getPullRequestDetail(cursored.number)
      if (!active || !result.ok) return
      setContext(
        (current) => ({
          ...current,
          pullRequestDetailByNumber: new Map(current.pullRequestDetailByNumber || []).set(
            result.detail.number,
            result.detail
          ),
        }),
        issuedAtDepth,
      )
    }, DETAIL_HYDRATION_DELAY_MS)

    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [
    runtimes.length,
    state.activeView,
    state.selectedPullRequestTriageIndex,
    filteredPullRequestTriageList,
    context.pullRequestDetailByNumber,
    setContext,
  ])

  React.useEffect(() => {
    if (state.activeView !== 'blame') return
    const path = state.blamePath
    if (!path) return
    if (context.blameByPath?.has(path)) {
      // Cache hit — make sure the loading flag is cleared (it may be set
      // from a previous cold path) so the surface renders the cached
      // blame immediately.
      setBlameLoading(false)
      return
    }

    const issuedAtDepth = runtimes.length - 1
    let active = true
    setBlameLoading(true)
    const timer = setTimeout(async () => {
      const result = await getBlame(git, path)
      if (!active) return
      setContext(
        (current) => ({
          ...current,
          blameByPath: new Map(current.blameByPath || []).set(result.path, result),
        }),
        issuedAtDepth,
      )
      setBlameLoading(false)
    }, BLAME_HYDRATION_DELAY_MS)

    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [
    runtimes.length,
    git,
    state.activeView,
    state.blamePath,
    context.blameByPath,
    setContext,
  ])

  // File-history hydration (#COCO-14). Same debounce / active-flag /
  // frame-tag / cache-skip shape as the blame effect above.
  React.useEffect(() => {
    if (state.activeView !== 'file-history') return
    const path = state.fileHistoryPath
    if (!path) return
    if (context.fileHistoryByPath?.has(path)) {
      setFileHistoryLoading(false)
      return
    }

    const issuedAtDepth = runtimes.length - 1
    let active = true
    setFileHistoryLoading(true)
    const timer = setTimeout(async () => {
      const result = await getFileHistory(git, path)
      if (!active) return
      setContext(
        (current) => ({
          ...current,
          fileHistoryByPath: new Map(current.fileHistoryByPath || []).set(result.path, result),
        }),
        issuedAtDepth,
      )
      setFileHistoryLoading(false)
    }, FILE_HISTORY_HYDRATION_DELAY_MS)

    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [
    runtimes.length,
    git,
    state.activeView,
    state.fileHistoryPath,
    context.fileHistoryByPath,
    setContext,
  ])
}
