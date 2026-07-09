/**
 * Context refresh callbacks (extracted from app.ts, #1418 decomposition).
 *
 * Owns `refreshContext` and `refreshWorktreeContext` — the two async
 * callbacks that re-fetch the git metadata context (branches, tags, worktree,
 * provider, stash, etc.) in response to manual `r` or the fs-watcher.
 *
 * Also owns the two per-frame monotonic request-id refs
 * (`refreshContextRequestRef`, `refreshWorktreeRequestRef`) that sequence
 * overlapping refreshes on the same frame — a watcher-triggered silent
 * refresh and a manual `r` can resolve out of order; the id ensures only
 * the latest write lands.
 *
 * The cluster — two `useRef`, two `useCallback` — is issued at the original
 * slot (after the `dispatch` `useCallback` and before `useRefreshWatcher`).
 * Hook order is preserved.
 *
 * `React` is injected per the runtime's convention.
 */

import type * as ReactTypes from 'react'
import type { SimpleGit } from 'simple-git'
import type { LogInkContext } from '../types'
import type { LogInkContextKey, LogInkContextStatus } from '../../chrome/context'
import { createLogInkContextStatus, mergeRefreshedContext, updateLogInkContextStatus } from '../../chrome/context'
import { getBranchOverview } from '../../../git/branchData'
import { getLfsAttributeStatus } from '../../../git/lfsAttributes'
import { getSubmoduleOverview } from '../../../git/submoduleData'
import { getRemoteOverview } from '../../../git/remoteData'
import { getGitOperationOverview } from '../../../git/operationData'
import { getProviderOverview } from '../../../git/providerData'
import { getForgePullRequestOverview } from '../../../git/forgeActions'
import { getStashOverview } from '../../../git/stashData'
import { getWorktreeOverview } from '../../../git/statusData'
import { getBisectStatus } from '../../../git/bisectData'
import { getReflogOverview } from '../../../git/reflogData'
import { getTagOverview } from '../../../git/tagData'
import { getWorktreeListOverview } from '../../../git/worktreeData'

async function safe<T>(promise: Promise<T>): Promise<T | undefined> {
  try {
    return await promise
  } catch {
    return undefined
  }
}

async function loadLogInkContext(git: SimpleGit): Promise<LogInkContext> {
  const [branches, pullRequest, tags, worktree, stashes, worktreeList, operation, provider, reflog, bisect, lfs, submodules, remotes] =
    await Promise.all([
      safe(getBranchOverview(git)),
      safe(getForgePullRequestOverview(git)),
      safe(getTagOverview(git)),
      safe(getWorktreeOverview(git)),
      safe(getStashOverview(git)),
      safe(getWorktreeListOverview(git)),
      safe(getGitOperationOverview(git)),
      safe(getProviderOverview(git)),
      safe(getReflogOverview(git)),
      safe(getBisectStatus(git)),
      safe(getLfsAttributeStatus(git)),
      safe(getSubmoduleOverview(git)),
      safe(getRemoteOverview(git)),
    ])

  return {
    bisect,
    branches,
    lfs,
    operation,
    provider,
    pullRequest,
    reflog,
    remotes,
    stashes,
    submodules,
    tags,
    worktree,
    worktreeList,
  }
}

/**
 * Boot-time per-key loader table. Each entry resolves one context key in
 * parallel. Used by `useContextHydration` for the per-key mount load.
 */
export function loadLogInkContextEntries(git: SimpleGit): Array<{
  key: LogInkContextKey
  load: () => Promise<LogInkContext[LogInkContextKey] | undefined>
}> {
  return [
    { key: 'branches', load: () => safe(getBranchOverview(git)) },
    { key: 'tags', load: () => safe(getTagOverview(git)) },
    { key: 'reflog', load: () => safe(getReflogOverview(git)) },
    { key: 'bisect', load: () => safe(getBisectStatus(git)) },
    { key: 'lfs', load: () => safe(getLfsAttributeStatus(git)) },
    { key: 'submodules', load: () => safe(getSubmoduleOverview(git)) },
    { key: 'remotes', load: () => safe(getRemoteOverview(git)) },
    { key: 'worktree', load: () => safe(getWorktreeOverview(git)) },
    { key: 'stashes', load: () => safe(getStashOverview(git)) },
    { key: 'worktreeList', load: () => safe(getWorktreeListOverview(git)) },
    { key: 'operation', load: () => safe(getGitOperationOverview(git)) },
    { key: 'provider', load: () => safe(getProviderOverview(git)) },
  ]
}

export type UseContextRefreshDeps = {
  git: SimpleGit
  runtimesLength: number
  dispatch: (action: { type: 'setStatus'; value: string }) => void
  setContext: (updater: (current: LogInkContext) => LogInkContext, depth: number) => void
  setContextStatus: (
    value: LogInkContextStatus | ((current: LogInkContextStatus) => LogInkContextStatus),
    depth: number,
  ) => void
  setPrDiffRefreshToken: ReactTypes.Dispatch<ReactTypes.SetStateAction<number>>
}

export type UseContextRefreshResult = {
  refreshContext: (options?: { silent?: boolean }) => Promise<void>
  refreshWorktreeContext: (options?: { silent?: boolean }) => Promise<LogInkContext['worktree']>
}

export function useContextRefresh(
  React: typeof ReactTypes,
  deps: UseContextRefreshDeps,
): UseContextRefreshResult {
  const { git, runtimesLength, dispatch, setContext, setContextStatus, setPrDiffRefreshToken } = deps

  // #1385 — per-frame monotonic request ids for sequencing overlapping
  // refreshes on the same frame. Each call claims the next id before
  // awaiting and drops its resolve if a newer claim exists by the time
  // it lands.
  const refreshContextRequestRef = React.useRef<Record<number, number>>({})
  const refreshWorktreeRequestRef = React.useRef<Record<number, number>>({})

  const refreshContext = React.useCallback(async (options: { silent?: boolean } = {}) => {
    const issuedAtDepth = runtimesLength - 1
    const requestId = (refreshContextRequestRef.current[issuedAtDepth] ?? 0) + 1
    refreshContextRequestRef.current[issuedAtDepth] = requestId
    if (!options.silent) {
      dispatch({ type: 'setStatus', value: 'refreshing repository context' })
      setContextStatus(createLogInkContextStatus('loading'), issuedAtDepth)
    }
    const next = await loadLogInkContext(git)
    // #1385 — a newer refresh was issued for this frame while ours was
    // in flight; its snapshot is fresher than ours, so drop this one.
    if (refreshContextRequestRef.current[issuedAtDepth] !== requestId) {
      return
    }
    // OSS-452 — merge, don't replace: preserves lazily-loaded slices.
    setContext((current) => mergeRefreshedContext(current, next), issuedAtDepth)
    setContextStatus(createLogInkContextStatus('ready'), issuedAtDepth)
    // Force PR-diff hydration re-evaluation.
    setPrDiffRefreshToken((token) => token + 1)
    if (!options.silent) {
      dispatch({ type: 'setStatus', value: 'repository context refreshed' })
    }
  }, [dispatch, git, runtimesLength, setContext, setContextStatus, setPrDiffRefreshToken])

  const refreshWorktreeContext = React.useCallback(async (options: { silent?: boolean } = {}) => {
    const issuedAtDepth = runtimesLength - 1
    const requestId = (refreshWorktreeRequestRef.current[issuedAtDepth] ?? 0) + 1
    refreshWorktreeRequestRef.current[issuedAtDepth] = requestId
    if (!options.silent) {
      setContextStatus(
        (current) => updateLogInkContextStatus(current, 'worktree', 'loading'),
        issuedAtDepth,
      )
    }
    const worktree = await safe(getWorktreeOverview(git))

    // #1385 — a newer worktree refresh was issued for this frame while
    // ours was in flight. Skip the context write but still return OUR
    // overview.
    if (refreshWorktreeRequestRef.current[issuedAtDepth] !== requestId) {
      return worktree
    }

    setContext(
      (current) => ({
        ...current,
        worktree,
        // Drop the blame cache: staging/unstaging/reverting changes the
        // working-tree contents, so cached attribution is stale.
        blameByPath: undefined,
        // Drop file-history cache for the same reason.
        fileHistoryByPath: undefined,
      }),
      issuedAtDepth,
    )
    setContextStatus(
      (current) => updateLogInkContextStatus(current, 'worktree', 'ready'),
      issuedAtDepth,
    )
    return worktree
  }, [git, runtimesLength, setContext, setContextStatus])

  return { refreshContext, refreshWorktreeContext }
}
