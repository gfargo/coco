/**
 * Repo-root resolution + per-repo view persistence (extracted in the 0.72
 * app.ts decomposition).
 *
 * This module lifts two *non-adjacent* clusters out of `app.ts`:
 *
 *  - `useActiveRepoRoot` — the `activeRepoRoot` `useState` plus the effect
 *    that resolves it via `git.revparse(['--show-toplevel'])` (#931 PR 3b).
 *    The commit-diff drill-in helper needs an absolute workdir for the
 *    active frame's `git`, so the root is re-resolved after every git swap.
 *
 *  - `useViewModePersistence` — the per-repo sidebar-tab + diff-view-mode
 *    *restore* effect (revparse → `getSavedSidebarTab` / `getSavedDiffViewMode`
 *    → dispatch) and the two *save* effects (`saveSidebarTab` /
 *    `saveDiffViewMode`), each of which re-resolves the repo root inline
 *    (Audit finding #2 — deliberately not reading the shared `repoRootRef`,
 *    which can lag a git swap).
 *
 * CRITICAL — effect order. The two clusters sit ~375 lines apart in the
 * original component, separated by many intervening effects. React fires
 * effects in declaration order, so merging both clusters into a single
 * hook at one call site would reorder them relative to those intervening
 * effects. To preserve ordering exactly, this module exports *two* hooks,
 * each called at the original cluster's position in `app.ts`:
 *
 *   const activeRepoRoot = useActiveRepoRoot(React, git)   // Region A (~715)
 *   ...many other hooks/effects...
 *   useViewModePersistence(React, { ... })                 // Region B (~1090)
 *
 * Within each hook the internal effects are reproduced verbatim and in the
 * same order as the original (restore effect, then sidebar-save effect,
 * then diff-save effect) — the `cancelled`-flag logic, the `revparse`
 * calls, the dispatch payloads, and the dependency arrays are byte-for-byte
 * the same. This is a behavior-preserving move, not a rewrite, EXCEPT for
 * the `restoredGitRef` gate added to the two save effects in
 * `useViewModePersistence` (#1598) — the three effects' independent
 * `revparse` calls have no ordering guarantee, so a save's continuation
 * could resolve before the restore's read and silently overwrite a
 * cached preference with the mount-time default. The gate gives the
 * saves a hard "not yet" until this `git`'s restore has completed.
 *
 * `React` is injected (per the runtime's `getLogInkRuntimeContext(React)`
 * convention) because the workstation never statically imports React.
 */

import type * as ReactTypes from 'react'
import type { SimpleGit } from 'simple-git'
import { getSavedDiffViewMode, saveDiffViewMode } from '../../chrome/diffViewModePersistence'
import { getSavedSidebarTab, saveSidebarTab } from '../../chrome/sidebarPersistence'
import type { LogInkAction, LogInkDiffViewMode, LogInkSidebarTab } from '../inkViewModel'

/**
 * Region A — absolute repo root for the active frame's `git` (#931 PR 3b).
 *
 * Issues the `activeRepoRoot` `useState`, then the resolution `useEffect`,
 * in the same order as the original `app.ts` cluster, preserving the
 * effect's `[git]` dependency array and the per-effect `cancelled` flag
 * (Audit finding #10 — rapid frame push/pop races are prevented because
 * React fires the cleanup synchronously before the next effect body, so a
 * pending revparse from the old `git` sees `cancelled === true` and skips
 * its write). Returns the resolved root, `undefined` while in flight.
 */
export function useActiveRepoRoot(
  React: typeof ReactTypes,
  git: SimpleGit,
): string | undefined {
  const [activeRepoRoot, setActiveRepoRoot] = React.useState<string | undefined>(undefined)
  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const root = (await git.revparse(['--show-toplevel'])).trim()
        if (!cancelled && root) {
          setActiveRepoRoot(root)
        }
      } catch {
        if (!cancelled) {
          setActiveRepoRoot(undefined)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [git])
  return activeRepoRoot
}

export type UseViewModePersistenceDeps = {
  /** The active frame's `git`. Drives both restore + save resolutions. */
  git: SimpleGit
  /** Reducer dispatch, used to restore the saved tab / diff mode. */
  dispatch: (action: LogInkAction) => void
  /**
   * Shared repo-root ref, populated by the restore effect for the config
   * editor's cwd fallback. Kept in `app.ts` because it is read outside this
   * cluster; passed in so the write still lands.
   */
  repoRootRef: ReactTypes.MutableRefObject<string | undefined>
  /**
   * `state.userSidebarTab` — the user's explicit choice mirror (not the
   * display `sidebarTab`), compared against the saved value on restore and
   * persisted by the sidebar-save effect.
   */
  userSidebarTab: LogInkSidebarTab
  /** `state.diffViewMode` — compared on restore and persisted on save. */
  diffViewMode: LogInkDiffViewMode
}

/**
 * Region B — per-repo sidebar-tab + diff-view-mode persistence (#785).
 *
 * Issues three effects in the exact order of the original `app.ts` cluster:
 *
 *   1. restore: revparse → write `repoRootRef` → `getSavedSidebarTab` /
 *      `getSavedDiffViewMode` → dispatch, deps `[git, dispatch]`.
 *   2. sidebar save: revparse → `saveSidebarTab`, deps `[userSidebarTab, git]`.
 *   3. diff-mode save: revparse → `saveDiffViewMode`, deps `[diffViewMode, git]`.
 *
 * The save effects deliberately re-resolve the root inline rather than
 * reading `repoRootRef.current` (Audit finding #2), because the ref is
 * async-populated and can lag a git swap. That behavior is preserved
 * verbatim — they do NOT read `repoRootRef` or a hoisted `activeRepoRoot`.
 */
export function useViewModePersistence(
  React: typeof ReactTypes,
  deps: UseViewModePersistenceDeps,
): void {
  const { git, dispatch, repoRootRef, userSidebarTab, diffViewMode } = deps
  // #1598 — the two save effects below fire on mount (and on every git
  // swap) alongside this restore effect, each behind its own independent
  // `revparse`. With no ordering guarantee between the three, a save's
  // continuation could resolve first and write the mount-time default
  // over a cached preference before the restore ever read it — silently
  // losing the preference. Gate the saves on THIS git's restore having
  // actually completed: they no-op until `restoredGitRef.current` marks
  // the current `git`, closing the race for both plain mount and the
  // repo-frame drill-in/out git-swap case.
  const restoredGitRef = React.useRef<SimpleGit | null>(null)
  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const repoRoot = (await git.revparse(['--show-toplevel'])).trim()
        if (cancelled || !repoRoot) return
        repoRootRef.current = repoRoot
        const saved = getSavedSidebarTab(repoRoot)
        if (saved && saved !== userSidebarTab) {
          dispatch({ type: 'restoreSidebarTab', value: saved })
        }
        // Diff view mode persistence (#785). Same per-repo cache pattern
        // as the sidebar tab — restore the user's last preference if
        // they had one. New repos / fresh installs default to unified.
        const savedDiffMode = getSavedDiffViewMode(repoRoot)
        if (savedDiffMode && savedDiffMode !== diffViewMode) {
          dispatch({ type: 'setDiffViewMode', value: savedDiffMode })
        }
      } catch {
        // Not in a worktree, or revparse failed; nothing to restore.
      } finally {
        if (!cancelled) {
          restoredGitRef.current = git
        }
      }
    })()
    return () => { cancelled = true }
  }, [git, dispatch])

  // Audit finding #2: re-resolve the repo root inline on every save
  // and key the deps off `git` + the saved value. The original
  // implementation read from `repoRootRef.current`, which is async-
  // populated by the resolver effect above and can lag behind a git
  // swap. After #995's synchronous pop-restore, the parent's freshly
  // restored sidebar tab was being written into the submodule's
  // cache because the ref still held the submodule root during the
  // brief window before the resolver settled.
  //
  // The extra `revparse` cost per save is negligible (saves fire
  // once per user-initiated tab change, not per render) and the
  // cancellation flag prevents a stale resolution from racing a
  // newer one in flight.
  React.useEffect(() => {
    // #1598 — skip until this git's restore has completed (see above).
    // The mount-time run always hits this, since `restoredGitRef` starts
    // `null`; a genuine user tab change fires this effect again after
    // restore has already stamped the ref, so it isn't blocked.
    if (restoredGitRef.current !== git) return
    let cancelled = false
    void (async () => {
      try {
        const root = (await git.revparse(['--show-toplevel'])).trim()
        if (cancelled || !root) return
        saveSidebarTab(root, userSidebarTab)
      } catch {
        // Not in a worktree, or revparse failed — silently skip.
        // The next save attempt will retry.
      }
    })()
    return () => { cancelled = true }
  }, [userSidebarTab, git])

  React.useEffect(() => {
    // #1598 — same restore gate as the sidebar-tab save above.
    if (restoredGitRef.current !== git) return
    let cancelled = false
    void (async () => {
      try {
        const root = (await git.revparse(['--show-toplevel'])).trim()
        if (cancelled || !root) return
        saveDiffViewMode(root, diffViewMode)
      } catch {
        // Same as above.
      }
    })()
    return () => { cancelled = true }
  }, [diffViewMode, git])
}
