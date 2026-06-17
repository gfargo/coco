import { simpleGit, type SimpleGit } from 'simple-git'
import type { LogInkRepoFrame } from '../../workstation/runtime/inkViewModel'
import {
  createLogInkContextStatus,
  updateLogInkContextStatus,
  type LogInkContextStatus,
} from '../chrome/context'
import type { RepoFrameRuntime } from './repoStackRuntime'

/**
 * Build the initial `LogInkContextStatus` for a freshly-created frame
 * (#931). Every *boot-fetched* key starts in `'loading'` so surfaces show
 * the loading hint immediately.
 *
 * The three **lazy-loaded** keys are the exception — they're hydrated on
 * entry to their dedicated view, not at boot (see `loadLogInkContextEntries`,
 * which deliberately omits them), so they're seeded `'idle'`. Leaving them
 * `'loading'` made the chrome's context indicator ("loading context") stick
 * forever, since nothing flips them to `'ready'` until the user actually
 * navigates there:
 *   - `pullRequest`      — full PR overview, lazy on the PR view (#808)
 *   - `issueList`        — issue triage list, lazy on the issues view (#882)
 *   - `pullRequestList`  — PR triage list, lazy on the PR-triage view (#882)
 *
 * Extracted so the root runtime (built at boot inside `LogInkApp`) and the
 * per-frame factory below share one canonical seed; the status surfaces
 * depend on the exact lazy-key `'idle'` seeding to avoid spurious loading
 * hints, so locking it down in one helper means the two paths can't drift.
 */
const LAZY_CONTEXT_KEYS = ['pullRequest', 'issueList', 'pullRequestList'] as const

export function createInitialContextStatus(): LogInkContextStatus {
  return LAZY_CONTEXT_KEYS.reduce(
    (status, key) => updateLogInkContextStatus(status, key, 'idle'),
    createLogInkContextStatus('loading'),
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
