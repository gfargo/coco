/**
 * PR-diff hydration for the triage Enter → diff drill-in (#1363).
 *
 * Mirrors `useDiffHydration`'s per-source discipline: a state hook owning
 * the `useState` slots and a loader hook issuing one lazy effect, guarded
 * on `activeView === 'diff' && diffSource === 'pr'` with an `active` flag
 * flipped false in cleanup so a stale in-flight fetch can't clobber a
 * newer selection. Like those loaders it writes to *local* `useState`
 * slots — not the frame-tagged context — so the `active` flag alone is
 * the cancellation story (#994's frame-tag applies to context writers).
 *
 * Two deliberate departures from the stash/compare loaders:
 *
 *   1. **Errors surface.** `gh pr diff` failures are actionable (auth
 *      expired, PR closed + branch deleted, network) so the fetcher
 *      returns `{ ok: false, message }` instead of throwing, and the
 *      hook stores the message for the diff surface to render — a
 *      silent "no diff" hint would read as an empty PR.
 *   2. **Bounded per-number cache.** Patches are the most expensive
 *      triage fetch (a full network round-trip per PR), and review
 *      flows bounce between the list and a handful of diffs. The last
 *      {@link PR_DIFF_CACHE_LIMIT} patches are kept, keyed by PR
 *      number, LRU-evicted, and invalidated wholesale whenever the
 *      triage list refetches (`pullRequestList` reference identity is
 *      the cache generation — a refresh / filter change replaces the
 *      overview object, so stale patches can't outlive the list that
 *      produced them).
 */

import type * as ReactTypes from 'react'
import type { PullRequestDiffResult } from '../../../git/pullRequestDiffData'
import type { PullRequestListOverview } from '../../../git/pullRequestListData'
import type { LogInkDiffSource, LogInkView } from '../inkViewModel'

/** Max cached PR patches per generation. Small — a review session hops
 * between a handful of PRs; anything larger just holds dead patches. */
export const PR_DIFF_CACHE_LIMIT = 8

/**
 * Bounded LRU cache for PR patches. `generation` carries the
 * `pullRequestList` overview identity the entries were fetched under;
 * a mismatch on read/write resets the map (list refetched ⇒ every
 * cached patch may be stale).
 */
export type PullRequestDiffCache = {
  generation: unknown
  entries: Map<number, string[]>
}

export function createPullRequestDiffCache(): PullRequestDiffCache {
  return { generation: undefined, entries: new Map() }
}

/** Reset the cache when the triage list identity (generation) moved. */
function syncCacheGeneration(cache: PullRequestDiffCache, generation: unknown): void {
  if (cache.generation !== generation) {
    cache.generation = generation
    cache.entries.clear()
  }
}

/**
 * Cache read: returns the patch for `number` fetched under `generation`,
 * refreshing its LRU position on hit. A generation mismatch clears the
 * cache and misses.
 */
export function readPullRequestDiffCache(
  cache: PullRequestDiffCache,
  generation: unknown,
  number: number
): string[] | undefined {
  syncCacheGeneration(cache, generation)
  const hit = cache.entries.get(number)
  if (hit === undefined) return undefined
  // Map preserves insertion order — delete + set moves the entry to the
  // back so eviction always drops the least-recently-used patch.
  cache.entries.delete(number)
  cache.entries.set(number, hit)
  return hit
}

/**
 * Cache write under `generation`, evicting the least-recently-used
 * entry past {@link PR_DIFF_CACHE_LIMIT}.
 */
export function writePullRequestDiffCache(
  cache: PullRequestDiffCache,
  generation: unknown,
  number: number,
  lines: string[]
): void {
  syncCacheGeneration(cache, generation)
  cache.entries.delete(number)
  cache.entries.set(number, lines)
  while (cache.entries.size > PR_DIFF_CACHE_LIMIT) {
    const oldest = cache.entries.keys().next()
    if (oldest.done) break
    cache.entries.delete(oldest.value)
  }
}

/**
 * Owns the PR-diff `useState` slots. All three setters are written only
 * by {@link usePullRequestDiffHydration}. Returns the values (read by
 * the diff surface render) + setters (threaded into the loader). Same
 * state-hook/loader-hook split as `useStashDiffState` — call each at a
 * stable slot in `app.ts` to preserve React hook ordering.
 */
export function usePullRequestDiffState(React: typeof ReactTypes): {
  prDiffLines: string[] | undefined
  setPrDiffLines: ReactTypes.Dispatch<ReactTypes.SetStateAction<string[] | undefined>>
  prDiffLoading: boolean
  setPrDiffLoading: ReactTypes.Dispatch<ReactTypes.SetStateAction<boolean>>
  prDiffError: string | undefined
  setPrDiffError: ReactTypes.Dispatch<ReactTypes.SetStateAction<string | undefined>>
} {
  const [prDiffLines, setPrDiffLines] = React.useState<string[] | undefined>(undefined)
  const [prDiffLoading, setPrDiffLoading] = React.useState(false)
  const [prDiffError, setPrDiffError] = React.useState<string | undefined>(undefined)
  return {
    prDiffLines,
    setPrDiffLines,
    prDiffLoading,
    setPrDiffLoading,
    prDiffError,
    setPrDiffError,
  }
}

export type UsePullRequestDiffHydrationDeps = {
  /**
   * Patch fetcher — `forge.getPullRequestDiffByNumber` (identity-stable:
   * `forge` is memoized on the detected provider in `app.ts`). Injected
   * as a function so tests exercise the effect without a forge facade.
   */
  getPullRequestDiffByNumber: (n: number) => Promise<PullRequestDiffResult>
  /** `state.activeView` — only `'diff'` triggers a load. */
  activeView: LogInkView
  /** `state.diffSource` — only `'pr'` triggers a load. */
  diffSource: LogInkDiffSource | undefined
  /** `state.prDiffNumber` — the PR number to fetch. */
  prDiffNumber: number | undefined
  /**
   * The triage list overview — its reference identity is the cache
   * generation. A refetch (refresh, filter change, frame swap) replaces
   * the object and invalidates every cached patch.
   */
  pullRequestList: PullRequestListOverview | undefined
  /**
   * Bumped whenever `refreshContext` settles (OSS-452). `pullRequestList`'s
   * reference is now preserved across refreshes (see `mergeRefreshedContext`
   * in `chrome/context.ts`), so this is the only signal that forces the
   * effect to re-evaluate after a background refresh — without it, a failed
   * `gh pr diff` fetch's `r`-to-retry only worked once (the unchanged
   * `pullRequestList` reference meant the deps never changed on a retry).
   */
  refreshToken: number
  /** Writer for the loaded patch lines. */
  setPrDiffLines: ReactTypes.Dispatch<ReactTypes.SetStateAction<string[] | undefined>>
  /** Loading-flag setter for the patch fetch. */
  setPrDiffLoading: ReactTypes.Dispatch<ReactTypes.SetStateAction<boolean>>
  /** Writer for the surfaced fetch-error message. */
  setPrDiffError: ReactTypes.Dispatch<ReactTypes.SetStateAction<string | undefined>>
}

/**
 * #1363 — load `gh pr diff <n>` (via the forge facade) once the diff
 * view becomes active with `diffSource === 'pr'`, serving repeat opens
 * from the bounded per-number cache.
 */
export function usePullRequestDiffHydration(
  React: typeof ReactTypes,
  deps: UsePullRequestDiffHydrationDeps,
): void {
  const {
    getPullRequestDiffByNumber,
    activeView,
    diffSource,
    prDiffNumber,
    pullRequestList,
    refreshToken,
    setPrDiffLines,
    setPrDiffLoading,
    setPrDiffError,
  } = deps

  const cacheRef = React.useRef<PullRequestDiffCache>(createPullRequestDiffCache())

  React.useEffect(() => {
    if (activeView !== 'diff' || diffSource !== 'pr' || !prDiffNumber) {
      // Clear the loading flag on the guard-fail bail (see the stash
      // loader): a view change while a fetch is in flight would
      // otherwise leave it stuck `true`.
      setPrDiffLoading(false)
      return
    }
    const cached = readPullRequestDiffCache(cacheRef.current, pullRequestList, prDiffNumber)
    if (cached !== undefined) {
      setPrDiffLines(cached)
      setPrDiffError(undefined)
      setPrDiffLoading(false)
      return
    }
    let active = true
    setPrDiffLoading(true)
    setPrDiffError(undefined)
    void (async () => {
      // The fetcher never throws — failures ride `{ ok: false }` — but
      // guard anyway so an unexpected rejection degrades to the error
      // line instead of an unhandled rejection.
      const result = await getPullRequestDiffByNumber(prDiffNumber).catch(
        (error: unknown): PullRequestDiffResult => ({
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        })
      )
      if (!active) return
      if (result.ok) {
        writePullRequestDiffCache(cacheRef.current, pullRequestList, prDiffNumber, result.lines)
        setPrDiffLines(result.lines)
        setPrDiffError(undefined)
      } else {
        setPrDiffLines([])
        setPrDiffError(result.message)
      }
      setPrDiffLoading(false)
    })()
    return () => { active = false }
  }, [getPullRequestDiffByNumber, activeView, diffSource, prDiffNumber, pullRequestList, refreshToken])
}
