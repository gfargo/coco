import { simpleGit, type SimpleGit } from 'simple-git'
import type { LogInkRepoFrame } from '../../commands/log/inkViewModel'
import {
  createLogInkContextStatus,
  updateLogInkContextStatus,
  type LogInkContextStatus,
} from '../chrome/context'
import type { RepoFrameRuntime } from './repoStackRuntime'

/**
 * Build the initial `LogInkContextStatus` for a freshly-created frame
 * (#931). Every fetched key starts in `'loading'` so surfaces show the
 * loading hint immediately; `pullRequest` is the exception (#808) —
 * it's lazy-loaded on entry to the PR view, so we seed it `'idle'`
 * instead of leaving it stuck as a permanent "loading" flag in the
 * chrome.
 *
 * Extracted so the root runtime (built at boot inside `LogInkApp`) and
 * the per-frame factory below share one canonical seed. The status
 * surfaces depend on the exact `'pullRequest' = 'idle'` initialization
 * to avoid spurious loading hints; locking it down in one helper means
 * the two code paths can't drift.
 */
export function createInitialContextStatus(): LogInkContextStatus {
  return updateLogInkContextStatus(
    createLogInkContextStatus('loading'),
    'pullRequest',
    'idle',
  )
}

/**
 * Factory that builds a fresh `RepoFrameRuntime` for a newly-pushed
 * frame (#931). The frame's `workdir` (set by the push action) drives
 * which working tree the `SimpleGit` instance binds against:
 *
 *   - **Has workdir** → `simpleGit(workdir)`. Production case for any
 *     nested submodule frame.
 *   - **No workdir** → falls back to `rootGit`. Defensive: only the
 *     root frame is expected to lack a workdir, and the root frame's
 *     runtime is built directly from `rootGit` in `LogInkApp`'s state
 *     initializer — this fallback only kicks in if a future push path
 *     forgets to pass `workdir`. Binding to the root keeps the session
 *     functional (the user still sees data) at the cost of the frame
 *     being a duplicate of the root.
 *
 * `context` starts empty; `contextStatus` starts in the same initial
 * "loading + pullRequest idle" shape the root frame seeds with. The
 * sync effect in `LogInkApp` is responsible for kicking off the
 * per-key context loads against the new frame's `git`; we don't do
 * that here so the factory stays pure and unit-testable without a
 * real repo on disk.
 */
export function createRepoFrameRuntime(
  frame: LogInkRepoFrame,
  rootGit: SimpleGit,
): RepoFrameRuntime {
  return {
    git: frame.workdir ? simpleGit(frame.workdir) : rootGit,
    context: {},
    contextStatus: createInitialContextStatus(),
  }
}
