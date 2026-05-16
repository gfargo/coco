import type { SimpleGit } from 'simple-git'
import type { LogInkRepoFrame } from '../../commands/log/inkViewModel'
import type { LogInkContextStatus } from '../chrome/context'
import type { LogInkContext } from './types'

/**
 * Per-frame runtime (#931 PR 2b). The view-model side of the repo
 * stack (`LogInkState.repoStack`) is pure data — labels, return
 * snapshots, optional entry ranges. The runtime side, kept here in
 * parallel, holds the *live* objects each frame binds against:
 *
 *   - `git` — a `SimpleGit` instance bound to the frame's workdir
 *     (root cwd for the root frame, submodule absolute path for
 *     nested frames). Every loader (`getBranchOverview`, the row
 *     fetcher, the diff helpers, etc.) consumes this.
 *   - `context` — the per-frame loaded context (branches / tags /
 *     stashes / submodules / …). Persisted across drill-in / drill-
 *     out cycles so popping back to a parent doesn't re-pay the load
 *     cost.
 *   - `contextStatus` — the per-key load progress for `context`,
 *     used by the chrome to show loading hints in the right column.
 *
 * Live runtime objects can't live in the reducer (they'd break
 * referential purity and serialization). They sit in a structural
 * array indexed by frame depth so push / pop manipulations stay a
 * trivial append / slice.
 */
export type RepoFrameRuntime = {
  git: SimpleGit
  context: LogInkContext
  contextStatus: LogInkContextStatus
}

/**
 * Ordered list of frame runtimes, root-first. The index of a runtime
 * in the list equals its depth in `LogInkState.repoStack` — runtime
 * 0 backs the root frame, runtime 1 backs the first push, etc.
 *
 * Kept as a plain readonly array (not a `Map`) so push is `.concat`,
 * pop is `.slice`, and reads are O(1) — exactly the operations the
 * sync helper performs.
 */
export type RepoStackRuntimes = readonly RepoFrameRuntime[]

/**
 * Reconcile the per-frame runtime list against the current view-model
 * stack. Three cases:
 *
 *   - **No change** — same length, returns `prev` unchanged so React
 *     reference equality skips downstream re-renders.
 *   - **Pop** — stack shrunk, returns `prev.slice(0, stack.length)`.
 *     The dropped runtimes are released to the GC; the surviving
 *     runtimes (root + any intermediate frames) keep their cached
 *     `git` + `context` so a re-push lands on warm state.
 *   - **Push** — stack grew, builds a fresh runtime via the supplied
 *     `createRuntime(frame, depth)` factory for each newly-deeper
 *     frame. The caller is responsible for the factory's content;
 *     this module never imports `simple-git` or `loadLogInkContext`
 *     directly so it stays unit-testable without a real repo on disk.
 *
 * Returns `newlyAddedIndices` so the caller's effect knows which
 * frames need their initial context fetch kicked off. On a no-op or
 * pop, the list is empty.
 *
 * The reducer's `pushRepoFrame` / `popRepoFrame` actions are the only
 * things that mutate `state.repoStack`; both are monotone — push
 * appends one, pop drops one — so this helper never needs to handle
 * "frame at index i changed identity in place." If that invariant ever
 * loosens, this helper should error rather than silently mis-bind a
 * `SimpleGit` to the wrong working directory.
 */
export function syncRepoStackRuntimes(
  prev: RepoStackRuntimes,
  stack: readonly LogInkRepoFrame[],
  createRuntime: (frame: LogInkRepoFrame, depth: number) => RepoFrameRuntime,
): { runtimes: RepoStackRuntimes; newlyAddedIndices: number[] } {
  if (stack.length < prev.length) {
    return { runtimes: prev.slice(0, stack.length), newlyAddedIndices: [] }
  }
  if (stack.length === prev.length) {
    return { runtimes: prev, newlyAddedIndices: [] }
  }
  const next: RepoFrameRuntime[] = prev.slice()
  const newlyAddedIndices: number[] = []
  for (let i = prev.length; i < stack.length; i += 1) {
    next.push(createRuntime(stack[i], i))
    newlyAddedIndices.push(i)
  }
  return { runtimes: next, newlyAddedIndices }
}

/**
 * Top-of-stack runtime — the one every active surface, loader, and
 * action target reads from. Undefined when the runtime list is empty
 * (which production code never produces — `createLogInkState` always
 * seeds a root frame, so the corresponding root runtime is built on
 * mount and the array is non-empty for the lifetime of the session).
 */
export function getActiveRepoFrameRuntime(
  runtimes: RepoStackRuntimes,
): RepoFrameRuntime | undefined {
  return runtimes[runtimes.length - 1]
}

/**
 * Immutably update one frame's runtime entry. Used by the app shell's
 * loader effects when a frame's `context` or `contextStatus` changes
 * — replacing the entry in place lets React's referential equality
 * skip re-renders on unrelated frames.
 *
 * Out-of-range indices are no-ops (return `prev` unchanged) so the
 * caller doesn't have to guard against race-y stack changes between
 * the load kickoff and the load-complete callback.
 */
export function updateRepoFrameRuntime(
  runtimes: RepoStackRuntimes,
  index: number,
  updater: (prev: RepoFrameRuntime) => RepoFrameRuntime,
): RepoStackRuntimes {
  if (index < 0 || index >= runtimes.length) return runtimes
  const next = runtimes.slice()
  next[index] = updater(next[index])
  return next
}
