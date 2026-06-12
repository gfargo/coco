import { LOG_INTERACTIVE_DEFAULT_LIMIT } from '../../commands/log/data'

/**
 * Pure decision helpers for the load-more pagination cluster.
 *
 * The async plumbing (git fetch, dispatch, ref bookkeeping) stays in the
 * `useLoadMoreHistory` hook; these are the two cleanly separable
 * decisions lifted out of that machinery so they can be unit tested
 * without driving the full runtime.
 *
 *   - `shouldLoadMore` — the entry guard at the top of `loadMoreCommits`.
 *     Returns whether a fetch is even worth firing given the current
 *     paging snapshot (interactive log only, no explicit `--limit`, not
 *     already loading, more pages believed to exist, at least one row
 *     loaded to skip past).
 *
 *   - `isCursorNearBottom` — the scroll-near-bottom auto-trigger
 *     threshold. The auto-load fires once the cursor is within 20 rows
 *     of the last loaded commit so older history is already on its way
 *     by the time the user reaches the bottom.
 *
 * Both mirror the original inline logic byte-for-byte; the hook calls
 * them in the exact spots the inline expressions sat.
 */

/**
 * The slice of paging state `shouldLoadMore` reads. Matches the shape
 * of `loadMoreStateRef.current` that the hook snapshots per render —
 * only the fields the guard actually consults are required here.
 */
export type LoadMoreGuardSnapshot = {
  /** The interactive log argv, or undefined when not in interactive log mode. */
  logArgv: { limit?: number } | null | undefined
  /** Whether a fetch is already in flight (mirrors `loadingMoreCommitsRef`). */
  loadingMore: boolean
  /** Whether the runtime believes more pages exist beyond the loaded window. */
  hasMoreCommits: boolean
  /** Number of filtered commits currently loaded. Zero → nothing to page past. */
  filteredCommitsLength: number
}

/**
 * Entry guard for `loadMoreCommits`. Returns `true` when a fetch should
 * fire. Faithful to the original two early-return checks:
 *
 *   1. bail when there's no argv, an explicit `--limit` is set, a fetch
 *      is already loading, or we've reached the end (`!hasMoreCommits`);
 *   2. bail when no commits are loaded yet (nothing to skip past).
 */
export function shouldLoadMore(snap: LoadMoreGuardSnapshot): boolean {
  if (!snap.logArgv || snap.logArgv.limit || snap.loadingMore || !snap.hasMoreCommits) {
    return false
  }
  if (snap.filteredCommitsLength === 0) {
    return false
  }
  return true
}

/**
 * Scroll-near-bottom predicate for the auto-trigger effect. `true` once
 * the cursor sits within 20 rows of the last loaded commit. Mirrors the
 * inline `const remaining = length - selectedIndex - 1; if (remaining > 20) return`.
 */
export function isCursorNearBottom(
  filteredCommitsLength: number,
  selectedIndex: number,
): boolean {
  const remaining = filteredCommitsLength - selectedIndex - 1
  return remaining <= 20
}

/**
 * Whether a freshly fetched page implies more pages still exist. A page
 * that came back full (>= the interactive default limit) means git had
 * more to give; a short page means we hit the end. Mirrors the inline
 * `nextCommitCount >= LOG_INTERACTIVE_DEFAULT_LIMIT` used to drive
 * `setHasMoreCommits` after every append.
 */
export function pageImpliesMore(pageCommitCount: number): boolean {
  return pageCommitCount >= LOG_INTERACTIVE_DEFAULT_LIMIT
}
