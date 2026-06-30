/**
 * Live-refresh filesystem watcher (extracted in the 0.72 app.ts
 * decomposition, PR 9).
 *
 * This module lifts the single effect that watches the repo's `.git`
 * metadata + working-tree root and re-triggers a context reload when
 * something changes outside the TUI (editor save, external git commands,
 * a branch switch in another terminal). On a `'full'` change it calls
 * `refreshContext({ silent: true })` **and** `refreshHistoryRows()` so
 * the commit graph stays in sync with the repository after graph-mutating
 * operations (git reset, rebase, cherry-pick, merge, etc.); on a
 * worktree-only change it calls `refreshWorktreeContext({ silent: true })`.
 * Both refreshers are the frame-tagged `useCallback`s from `app.ts`,
 * passed in unchanged.
 *
 * The effect is reproduced **verbatim** — the async `revparse` bootstrap,
 * the `cancelled` guard, the 750ms debounce, the `mountedRef` mount check
 * inside `onChange`, the best-effort `try/catch`, and — critically — the
 * cleanup that flips `cancelled` and calls `watcher?.close()` all carry
 * over byte-for-byte. A leaked watcher is a real regression, so the
 * teardown return is preserved exactly. The dependency array
 * `[git, refreshContext, refreshWorktreeContext, refreshHistoryRows]` is
 * unchanged except for the addition of `refreshHistoryRows`.
 *
 * `React` is injected (per the runtime's `getLogInkRuntimeContext(React)`
 * convention) because the workstation never statically imports React.
 */

import type * as ReactTypes from 'react'
import type { SimpleGit } from 'simple-git'
import type { LogInkRefreshKind, LogInkRefreshWatcher } from '../../chrome/refreshWatcher'
import { createRefreshWatcher } from '../../chrome/refreshWatcher'

export type UseRefreshWatcherDeps = {
  /** The active frame's `git`. Drives `revparse` + scopes the watcher. */
  git: SimpleGit
  /** Mount flag — `onChange` no-ops once the component unmounts. */
  mountedRef: ReactTypes.MutableRefObject<boolean>
  /** Frame-tagged full-context refresher (`refreshContext`) from `app.ts`. */
  refreshContext: (options?: { silent?: boolean }) => Promise<void>
  /**
   * Frame-tagged worktree-only refresher (`refreshWorktreeContext`) from
   * `app.ts`.
   */
  refreshWorktreeContext: (options?: { silent?: boolean }) => Promise<unknown>
  /**
   * Re-fetches the commit-graph rows (`state.rows`) from `app.ts`.
   * Called alongside `refreshContext` on every `'full'` watcher event so
   * that graph-mutating operations performed outside the TUI (git reset,
   * rebase, cherry-pick, merge, pull --rebase, commit --amend) are
   * reflected in the history view without a restart.
   *
   * Mirrors the manual `r` handler in `useInputHandler.ts` which already
   * calls both `refreshContext()` and `refreshHistoryRows()`.
   */
  refreshHistoryRows: () => Promise<unknown>
}

/**
 * Decide what to refresh based on the watcher kind. Extracted as a pure
 * function so it can be tested without driving `fs.watch` or the full
 * React hook machinery.
 *
 * - `'full'`     → call `refreshContext({ silent: true })` **and**
 *                  `refreshHistoryRows()`. Used for HEAD/ref changes
 *                  (branch switch, git reset, rebase, merge, etc.).
 * - `'worktree'` → call only `refreshWorktreeContext({ silent: true })`.
 *                  Used for index/working-tree changes (git add, save,
 *                  etc.). Cheaper — no graph re-fetch.
 */
export function applyRefreshKind(
  kind: LogInkRefreshKind,
  actions: {
    refreshContext: (options?: { silent?: boolean }) => Promise<unknown>
    refreshWorktreeContext: (options?: { silent?: boolean }) => Promise<unknown>
    refreshHistoryRows: () => Promise<unknown>
  },
): void {
  if (kind === 'full') {
    void actions.refreshContext({ silent: true })
    void actions.refreshHistoryRows()
  } else {
    void actions.refreshWorktreeContext({ silent: true })
  }
}

/**
 * Issues the live-refresh watcher effect, in its original `app.ts`
 * position. Reproduced verbatim — same async bootstrap, same `cancelled`
 * guard, same 750ms debounce, same `mountedRef` check, same best-effort
 * `try/catch`, same `watcher?.close()` teardown.
 *
 * The dependency array gains `refreshHistoryRows` (a stable `useCallback`
 * from `app.ts`) alongside the existing `refreshContext` and
 * `refreshWorktreeContext`. The watcher re-subscribes when any dep
 * changes, which is the same behaviour the existing deps already had.
 */
export function useRefreshWatcher(
  React: typeof ReactTypes,
  deps: UseRefreshWatcherDeps,
): void {
  const { git, mountedRef, refreshContext, refreshWorktreeContext, refreshHistoryRows } = deps

  // Live refresh: watch .git metadata + the working tree root and reload
  // context when something changes outside the TUI (editor save, external
  // git commands, branch switch in another terminal). Best-effort — the
  // watcher quietly skips paths that don't exist or platforms where
  // fs.watch fails. Subdirectory unstaged edits don't fire; users can
  // press `r` for those.
  React.useEffect(() => {
    let cancelled = false
    let watcher: LogInkRefreshWatcher | null = null

    void (async () => {
      try {
        const [repoRoot, gitDir] = await Promise.all([
          git.revparse(['--show-toplevel']),
          git.revparse(['--absolute-git-dir']),
        ])
        if (cancelled) {
          return
        }
        watcher = createRefreshWatcher({
          repoRoot: repoRoot.trim(),
          gitDir: gitDir.trim(),
          // Editor saves and git background processes can produce a steady
          // drip of fs events on busy repos. The default 250ms debounce
          // was tight enough that the watcher fired ~once per second; 750
          // batches the steady-state better without delaying the user's
          // perception of an actual change.
          debounceMs: 750,
          onChange: (kind) => {
            if (!mountedRef.current) {
              return
            }
            applyRefreshKind(kind, {
              refreshContext,
              refreshWorktreeContext,
              refreshHistoryRows,
            })
          },
        })
      } catch {
        // Not in a git worktree, or revparse failed. Skip — manual `r`
        // refresh still works.
      }
    })()

    return () => {
      cancelled = true
      watcher?.close()
    }
  }, [git, refreshContext, refreshWorktreeContext, refreshHistoryRows])
}
