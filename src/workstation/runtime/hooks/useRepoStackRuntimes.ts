/**
 * Repo-stack runtimes — the multi-repo workspace foundation (extracted in the
 * post-0.72 app.ts decomposition, item 6 / #1237; the feature itself is #931 /
 * #994).
 *
 * This module lifts the entire repo-stack state cluster out of `app.ts`. It is
 * the *root* state of the component: `git`, `context`, and `contextStatus` —
 * read by virtually every loader, effect, and surface — are projections of the
 * active (top-of-stack) frame, and `setContext` / `setContextStatus` are the
 * frame-tagged writers every loader uses. The cluster is **contiguous** in
 * `app.ts` (one `useState`, one sync effect, the active-frame projection, two
 * `useCallback`s), so it moves wholesale into a single hook called at the
 * original slot — React issues `useState → useEffect → useCallback →
 * useCallback` in the exact same order, preserving hook order. Everything is
 * reproduced **verbatim**; this is a behavior-preserving move, not a rewrite.
 *
 * What it owns:
 *   - `runtimes` — the frame stack (`RepoStackRuntimes`), seeded with a single
 *     root frame bound to `rootGit`;
 *   - the sync effect — `syncRepoStackRuntimes(prev, repoStack, factory)` runs
 *     on every push / pop (`[repoStack, rootGit]`): push appends a runtime via
 *     the factory, pop slices the top off, the parent's cached state survives;
 *   - the active-frame projection — `git` / `context` / `contextStatus` read
 *     off `getActiveRepoFrameRuntime(runtimes)` (falling back to a root-bound
 *     default), so a submodule drill-in swaps the top frame and every dep array
 *     that lists `git` re-fires;
 *   - `setContext` / `setContextStatus` — stable (`[]`) `useCallback`s that
 *     delegate to the active frame's runtime via `updateRepoFrameRuntime`. The
 *     optional `targetDepth` (#994) routes a write to a specific frame instead
 *     of the active one, so a load that captured its depth at issue-time lands
 *     on the frame that issued it — or silently drops if that frame was popped
 *     (`updateRepoFrameRuntime` no-ops on out-of-range indices). Without the
 *     tag, an in-flight refresh on the parent would clobber a freshly-pushed
 *     submodule frame.
 *
 * `activeRuntime` stays internal — it is referenced only by the projection.
 * The hook returns the names `app.ts` already used (`runtimes`, `git`,
 * `context`, `contextStatus`, `setContext`, `setContextStatus`), so every
 * downstream consumer (the ~30 `setContext` call sites, the `runtimes.length`
 * frame-tag depth reads, the `git` / `context` readers) is unchanged.
 *
 * `React` is injected (per the runtime's `getLogInkRuntimeContext(React)`
 * convention) because the workstation never statically imports React.
 */

import type * as ReactTypes from 'react'
import type { SimpleGit } from 'simple-git'
import type { LogInkContextStatus } from '../../chrome/context'
import { createInitialContextStatus, createRepoFrameRuntime } from '../repoFrameFactory'
import type { LogInkRepoFrame } from '../inkViewModel'
import {
  getActiveRepoFrameRuntime,
  syncRepoStackRuntimes,
  updateRepoFrameRuntime,
  type RepoFrameRuntime,
  type RepoStackRuntimes,
} from '../repoStackRuntime'
import type { LogInkContext } from '../types'

/** Frame-tagged context writer — `setContext(next, targetDepth?)`. */
export type SetContextFn = (
  arg: LogInkContext | ((prev: LogInkContext) => LogInkContext),
  targetDepth?: number,
) => void

/** Frame-tagged context-status writer — `setContextStatus(next, targetDepth?)`. */
export type SetContextStatusFn = (
  arg: LogInkContextStatus | ((prev: LogInkContextStatus) => LogInkContextStatus),
  targetDepth?: number,
) => void

export type UseRepoStackRuntimesDeps = {
  /** The root frame's `git` (the cwd `coco ui` launched in). */
  rootGit: SimpleGit
  /** `state.repoStack` — the view-model frame stack the runtimes sync against. */
  repoStack: readonly LogInkRepoFrame[]
}

export type UseRepoStackRuntimesResult = {
  /** The full frame stack — `runtimes.length` is the frame-tag depth. */
  runtimes: RepoStackRuntimes
  /** The active (top-of-stack) frame's `git`. */
  git: SimpleGit
  /** The active frame's loaded context. */
  context: LogInkContext
  /** The active frame's per-key load status. */
  contextStatus: LogInkContextStatus
  /** Frame-tagged context writer. */
  setContext: SetContextFn
  /** Frame-tagged context-status writer. */
  setContextStatus: SetContextStatusFn
}

/**
 * Owns the repo-stack runtimes cluster (see the module header). Verbatim lift
 * of the contiguous `app.ts` block, called at its original slot.
 */
export function useRepoStackRuntimes(
  React: typeof ReactTypes,
  deps: UseRepoStackRuntimesDeps,
): UseRepoStackRuntimesResult {
  const { rootGit, repoStack } = deps

  const [runtimes, setRuntimes] = React.useState<RepoStackRuntimes>(() => [{
    git: rootGit,
    context: {},
    contextStatus: createInitialContextStatus(),
  }])
  // Sync `runtimes` against the view-model stack on every push / pop.
  // The sync is monotone — push appends a new runtime via the factory,
  // pop slices off the top runtime; the parent's cached state survives.
  // The factory is wrapped to capture `rootGit` so a defensively-pushed
  // frame without a workdir still has a working `SimpleGit` bound.
  React.useEffect(() => {
    setRuntimes((prev) => {
      const { runtimes: next } = syncRepoStackRuntimes(
        prev,
        repoStack,
        (frame) => createRepoFrameRuntime(frame, rootGit),
      )
      return next
    })
  }, [repoStack, rootGit])
  // Active-frame projection (#931). `git`, `context`, `contextStatus`
  // — every existing closure / effect / surface reads these names.
  const activeRuntime: RepoFrameRuntime = getActiveRepoFrameRuntime(runtimes) ?? {
    git: rootGit,
    context: {},
    contextStatus: createInitialContextStatus(),
  }
  const git = activeRuntime.git
  const context = activeRuntime.context
  const contextStatus = activeRuntime.contextStatus
  // Wrappers that delegate to the active frame's runtime entry so the
  // existing call sites stay byte-identical. Support both function-
  // updater and value-updater forms (the codebase uses both).
  //
  // `targetDepth` (#994) routes the write to a specific frame instead
  // of the currently-active one. Loaders that capture the depth at
  // issue-time and pass it here are robust against frame-stack
  // mutations (push / pop) that happen while the load is in flight —
  // the write lands on the frame that issued it, or silently drops
  // if that frame has been popped (`updateRepoFrameRuntime` no-ops on
  // out-of-range indices). Without the tag, an in-flight refresh on
  // the parent would clobber a freshly-pushed submodule frame.
  const setContext = React.useCallback<SetContextFn>(
    (arg, targetDepth) => {
      setRuntimes((prev) => {
        const depth = targetDepth ?? prev.length - 1
        if (depth < 0) return prev
        return updateRepoFrameRuntime(prev, depth, (frame) => ({
          ...frame,
          context: typeof arg === 'function'
            ? (arg as (p: LogInkContext) => LogInkContext)(frame.context)
            : arg,
        }))
      })
    },
    [],
  )
  const setContextStatus = React.useCallback<SetContextStatusFn>(
    (arg, targetDepth) => {
      setRuntimes((prev) => {
        const depth = targetDepth ?? prev.length - 1
        if (depth < 0) return prev
        return updateRepoFrameRuntime(prev, depth, (frame) => ({
          ...frame,
          contextStatus: typeof arg === 'function'
            ? (arg as (p: LogInkContextStatus) => LogInkContextStatus)(frame.contextStatus)
            : arg,
        }))
      })
    },
    [],
  )

  return { runtimes, git, context, contextStatus, setContext, setContextStatus }
}
