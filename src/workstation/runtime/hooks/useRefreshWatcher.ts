/**
 * Live-refresh filesystem watcher (extracted in the 0.72 app.ts
 * decomposition, PR 9).
 *
 * This module lifts the single effect that watches the repo's `.git`
 * metadata + working-tree root and re-triggers a context reload when
 * something changes outside the TUI (editor save, external git commands,
 * a branch switch in another terminal). On a `'full'` change it calls
 * `refreshContext({ silent: true })`; on a worktree-only change it calls
 * `refreshWorktreeContext({ silent: true })`. Both refreshers are the
 * frame-tagged `useCallback`s from `app.ts`, passed in unchanged.
 *
 * The effect is reproduced **verbatim** — the async `revparse` bootstrap,
 * the `cancelled` guard, the 750ms debounce, the `mountedRef` mount check
 * inside `onChange`, the best-effort `try/catch`, and — critically — the
 * cleanup that flips `cancelled` and calls `watcher?.close()` all carry
 * over byte-for-byte. A leaked watcher is a real regression, so the
 * teardown return is preserved exactly. The dependency array
 * `[git, refreshContext, refreshWorktreeContext]` is unchanged. This is a
 * behavior-preserving move, not a rewrite.
 *
 * `React` is injected (per the runtime's `getLogInkRuntimeContext(React)`
 * convention) because the workstation never statically imports React.
 */

import type * as ReactTypes from 'react'
import type { SimpleGit } from 'simple-git'
import type { LogInkRefreshWatcher } from '../../chrome/refreshWatcher'
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
}

/**
 * Issues the live-refresh watcher effect, in its original `app.ts`
 * position. Reproduced verbatim — same async bootstrap, same `cancelled`
 * guard, same 750ms debounce, same `mountedRef` check, same best-effort
 * `try/catch`, same `watcher?.close()` teardown, same dependency array.
 */
export function useRefreshWatcher(
  React: typeof ReactTypes,
  deps: UseRefreshWatcherDeps,
): void {
  const { git, mountedRef, refreshContext, refreshWorktreeContext } = deps

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
            if (kind === 'full') {
              void refreshContext({ silent: true })
            } else {
              void refreshWorktreeContext({ silent: true })
            }
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
  }, [git, refreshContext, refreshWorktreeContext])
}
