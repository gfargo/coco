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

/**
 * The completion-time snapshot a frame-scoped history-row resolve checks
 * before writing (#1384). `issuedAtDepth` is the repo-frame depth
 * (`repoStack.length - 1`) captured when the fetch was dispatched;
 * `currentDepth` is the live depth when it resolves.
 */
export type FrameScopedResolveSnapshot = {
  /** Whether the component is still mounted (mirrors `mountedRef`). */
  mounted: boolean
  /** Repo-frame depth captured when the fetch was dispatched. */
  issuedAtDepth: number
  /** Live repo-frame depth at resolve time. */
  currentDepth: number
}

/**
 * Stale-completion decision for the frame-scoped row loaders
 * (`loadCommitContext`, `refreshHistoryRows`) — #1384.
 *
 * The history ROWS live in the single reducer state and are swapped
 * in place on every repo-frame push / pop (unlike the context, which
 * is stored per frame and can be *routed* to the issuing frame via
 * `setContext(next, targetDepth)`, the #994 pattern). A row write has
 * no frame to route to — if the frame stack changed while the fetch
 * was in flight, the only safe move is to DROP the resolve: an
 * append / replace from the parent frame would splice parent-repo
 * commits into the child frame's history (or vice versa after a pop).
 */
export function isStaleFrameResolve(snap: FrameScopedResolveSnapshot): boolean {
  return !snap.mounted || snap.currentDepth !== snap.issuedAtDepth
}

/**
 * The completion-time snapshot the deferred boot loader checks —
 * the frame-scoped decision above plus a monotonic history-refetch
 * generation.
 */
export type BootLoadResolveSnapshot = FrameScopedResolveSnapshot & {
  /** History-refetch generation live when the boot load was dispatched. */
  issuedRefetchGeneration: number
  /** Live history-refetch generation at resolve time. */
  currentRefetchGeneration: number
}

/**
 * Stale-completion decision for `useDeferredBootLoad`'s one-shot
 * background fetch.
 *
 * The boot loader fires once on mount and unconditionally
 * `replaceRows`-es with the full unfiltered log when it resolves. If
 * the user submits a server-side history filter (`author:`/`path:`/
 * `S:`/`G:`) or toggles the graph mode WHILE that fetch is still in
 * flight, `useHistoryRefetch`'s own effect fires and dispatches its
 * OWN — correctly filtered — `replaceRows`. A boot load that resolves
 * afterward would silently clobber it back to the unfiltered view:
 * no error, no status line, nothing telling the user their filter was
 * just discarded.
 *
 * `historyRefetchGenerationRef` is bumped the instant `useHistoryRefetch`
 * fires (when the fetch STARTS, not when it resolves), so an in-flight
 * refetch already wins over a slower-resolving boot load regardless of
 * which one's promise settles first. The boot loader captures the
 * generation at dispatch time and drops its resolve if a refetch has
 * started since — same shape as the frame-depth guard above, just
 * keyed on filter/graph freshness instead of repo-frame identity.
 */
export function isStaleBootLoadResolve(snap: BootLoadResolveSnapshot): boolean {
  return isStaleFrameResolve(snap) || snap.currentRefetchGeneration !== snap.issuedRefetchGeneration
}

/**
 * The completion-time snapshot `loadMoreCommits` checks — the
 * frame-scoped decision above plus the pre-existing monotonic
 * request-id family (`loadMoreRequestRef`).
 */
export type LoadMoreCompletionSnapshot = FrameScopedResolveSnapshot & {
  /** The request id this fetch was issued with. */
  requestId: number
  /** The live request id at resolve time (mirrors `loadMoreRequestRef`). */
  currentRequestId: number
}

/**
 * Stale-completion decision for the `loadMoreCommits` resolve (#1384).
 *
 * Three ways a completion goes stale:
 *   1. the component unmounted;
 *   2. the request-id family moved on — a newer page fetch was issued,
 *      or a repo-frame push / pop rescoped the family (the runtime
 *      bumps `loadMoreRequestRef` on every frame transition so a
 *      pre-push fetch can never satisfy the guard post-push, even
 *      after a push → pop round trip back to the SAME depth);
 *   3. the repo-frame depth changed — belt-and-braces with (2) for
 *      the render tick before the rescope bump lands.
 */
export function isStaleLoadMoreCompletion(snap: LoadMoreCompletionSnapshot): boolean {
  if (!snap.mounted) return true
  if (snap.currentRequestId !== snap.requestId) return true
  return snap.currentDepth !== snap.issuedAtDepth
}
