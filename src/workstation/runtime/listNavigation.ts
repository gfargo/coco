/**
 * One table for the list-navigation ladder (#2219).
 *
 * The router used to repeat the same nine-list `if` chain three times
 * (Up, Down, and Home/End edge jumps), each block naming the list's
 * action-target predicate, its count and id fields on the input context,
 * and its `moveX` action. Adding a list meant editing three places and
 * the copies could (and did) drift. The chain now lives here once.
 *
 * State shape and the per-list `moveX` actions are unchanged: this only
 * collapses the router side. Precedence is preserved exactly: the Up/Down
 * ladders interleave two surface handlers (blame, file history) between
 * the `remotes` and `submodules` lists, so the table is walked in two
 * phases around them; the Home/End ladder has no such handlers and walks
 * both phases back to back.
 */
import type { ListId, LogInkState } from './inkViewModel'
import type { LogInkInputContext, LogInkInputEvent } from './inkInput'

/**
 * Resolve the id at the post-move index for a `moveBranch`/`moveTag`/
 * `moveStash` dispatch (#1452 dual-write). `ids` is the sorted +
 * filtered id list in render order; undefined when the caller hasn't
 * threaded it through `LogInkInputContext` yet (e.g. a test harness
 * exercising only `count`), in which case the move still dispatches —
 * it just carries no `id` payload.
 */
export function resolveMoveTargetId(
  ids: string[] | undefined,
  currentIndex: number,
  delta: number,
  count: number,
): string | undefined {
  if (!ids || count === 0) return undefined
  const newIndex = Math.max(0, Math.min(currentIndex + delta, count - 1))
  return ids[newIndex]
}

/**
 * Per-entity action-target predicates. The promoted views (`branches`,
 * `tags`, `stash`, `worktrees`) each scope a set of ops to their
 * dedicated surface. The same ops also fire when the user has the
 * sidebar focused on the matching tab — that's how in-sidebar
 * selection (#791 follow-up) lets the user checkout / apply / drop
 * without leaving the workstation view.
 */
export function isBranchActionTarget(state: LogInkState): boolean {
  return (state.activeView === 'branches' && state.focus === 'commits') ||
    (state.focus === 'sidebar' && state.sidebarTab === 'branches')
}

export function isTagActionTarget(state: LogInkState): boolean {
  return (state.activeView === 'tags' && state.focus === 'commits') ||
    (state.focus === 'sidebar' && state.sidebarTab === 'tags')
}

export function isStashActionTarget(state: LogInkState): boolean {
  return (state.activeView === 'stash' && state.focus === 'commits') ||
    (state.focus === 'sidebar' && state.sidebarTab === 'stashes')
}

/**
 * Reflog has no sidebar tab — only the dedicated promoted view (#781).
 * The condition stays as a single helper anyway so navigation handlers
 * can read it the same way they do for the other promoted views.
 */
export function isReflogActionTarget(state: LogInkState): boolean {
  return state.activeView === 'reflog' && state.focus === 'commits'
}

/**
 * Submodules has no sidebar tab either — only the dedicated promoted
 * view (#932). Same shape as `isReflogActionTarget`.
 */
export function isSubmodulesActionTarget(state: LogInkState): boolean {
  return state.activeView === 'submodules' && state.focus === 'commits'
}

/**
 * Remotes has no sidebar tab — only the dedicated promoted view
 * (#0.71). Same shape as `isReflogActionTarget` / `isSubmodulesActionTarget`.
 */
export function isRemotesActionTarget(state: LogInkState): boolean {
  return state.activeView === 'remotes' && state.focus === 'commits'
}

/**
 * Issue triage list (#882 phase 3). Same shape as the other promoted
 * read-only views — j/k move the cursor when the commits pane is
 * focused on the dedicated view.
 */
export function isIssueActionTarget(state: LogInkState): boolean {
  return state.activeView === 'issues' && state.focus === 'commits'
}

/**
 * Pull-request triage list (#882 phase 3). Distinct from the existing
 * `pull-request` single-PR action panel — this is the multi-PR list
 * surface and its cursor lives in `selectedPullRequestTriageIndex`.
 */
export function isPullRequestTriageActionTarget(state: LogInkState): boolean {
  return state.activeView === 'pull-request-triage' && state.focus === 'commits'
}

export function isWorktreeActionTarget(state: LogInkState): boolean {
  return (state.activeView === 'worktrees' && state.focus === 'commits') ||
    (state.focus === 'sidebar' && state.sidebarTab === 'worktrees')
}

type ListNavigator = {
  /** The list whose cursor `moveList` moves. */
  list: ListId
  /** Whether the keyboard currently drives this list. */
  isTarget: (state: LogInkState) => boolean
  /** Row count of the list (falsy: nothing to move through). */
  count: (context: LogInkInputContext) => number | undefined
  /** Render-order ids, for the id half of the index/id pair. Reflog has none. */
  ids?: (context: LogInkInputContext) => string[] | undefined
  /** Current cursor index. */
  index: (state: LogInkState) => number
  /** 1 = consulted before the blame / file-history handlers, 2 = after. */
  phase: 1 | 2
}

/** In the router's historical precedence order. */
export const LIST_NAVIGATORS: ReadonlyArray<ListNavigator> = [
  { list: 'branch', isTarget: isBranchActionTarget, count: (c) => c.branchCount, ids: (c) => c.branchIds, index: (s) => s.selectedBranchIndex, phase: 1 },
  { list: 'tag', isTarget: isTagActionTarget, count: (c) => c.tagCount, ids: (c) => c.tagIds, index: (s) => s.selectedTagIndex, phase: 1 },
  { list: 'stash', isTarget: isStashActionTarget, count: (c) => c.stashCount, ids: (c) => c.stashIds, index: (s) => s.selectedStashIndex, phase: 1 },
  { list: 'reflog', isTarget: isReflogActionTarget, count: (c) => c.reflogCount, index: (s) => s.selectedReflogIndex, phase: 1 },
  { list: 'remote', isTarget: isRemotesActionTarget, count: (c) => c.remoteCount, ids: (c) => c.remoteListIds, index: (s) => s.selectedRemoteIndex, phase: 1 },
  { list: 'submodule', isTarget: isSubmodulesActionTarget, count: (c) => c.submoduleCount, ids: (c) => c.submoduleListIds, index: (s) => s.selectedSubmoduleIndex, phase: 2 },
  { list: 'issue', isTarget: isIssueActionTarget, count: (c) => c.issueCount, ids: (c) => c.issueListIds, index: (s) => s.selectedIssueIndex, phase: 2 },
  { list: 'pullRequestTriage', isTarget: isPullRequestTriageActionTarget, count: (c) => c.pullRequestTriageCount, ids: (c) => c.pullRequestTriageListIds, index: (s) => s.selectedPullRequestTriageIndex, phase: 2 },
  { list: 'worktreeList', isTarget: isWorktreeActionTarget, count: (c) => c.worktreeListCount, ids: (c) => c.worktreeListIds, index: (s) => s.selectedWorktreeListIndex, phase: 2 },
]

function moveEvent(
  navigator: ListNavigator,
  state: LogInkState,
  context: LogInkInputContext,
  count: number,
  delta: number,
): LogInkInputEvent {
  const ids = navigator.ids
  return {
    type: 'action',
    action: ids
      ? { type: 'moveList', list: navigator.list, delta, count, id: resolveMoveTargetId(ids(context), navigator.index(state), delta, count) }
      : { type: 'moveList', list: navigator.list, delta, count },
  }
}

/**
 * The move event for whichever list currently owns the keyboard, or
 * undefined when none does. `delta` is the step (±1 for ↑/↓). Pass `phase`
 * to walk only the lists on one side of the blame / file-history handlers.
 */
export function listMoveEvents(
  state: LogInkState,
  context: LogInkInputContext,
  delta: number,
  phase?: 1 | 2,
): LogInkInputEvent[] | undefined {
  for (const navigator of LIST_NAVIGATORS) {
    if (phase !== undefined && navigator.phase !== phase) continue
    const count = navigator.count(context)
    if (navigator.isTarget(state) && count) {
      return [moveEvent(navigator, state, context, count, delta)]
    }
  }
  return undefined
}

/**
 * Home/End: the same ladder with a delta of ±the list's length, which
 * `clampIndex` lands exactly on the first or last entry.
 */
export function listEdgeEvents(
  state: LogInkState,
  context: LogInkInputContext,
  sign: 1 | -1,
): LogInkInputEvent[] | undefined {
  for (const navigator of LIST_NAVIGATORS) {
    const count = navigator.count(context)
    if (navigator.isTarget(state) && count) {
      return [moveEvent(navigator, state, context, count, sign * count)]
    }
  }
  return undefined
}
