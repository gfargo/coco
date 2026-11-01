import type { WorkspaceOverview } from '../../../git/workspaceData'
import type { CachedPullRequestCounts } from '../../chrome/workspaceCache'

/**
 * What the workspace does on mount (#2211).
 *
 * `runWorkspaceLoop` remounts after every drill-in into `coco ui`, and the
 * mount used to rediscover every repo and refetch every PR count: with 100
 * repos, hundreds of git processes and 100 `gh` calls just to come back from
 * looking at one repo. A return (there is a `resume`) with a recent cache only
 * needs the repo you were in; `r` still rescans everything on demand.
 */

/** A cached overview younger than this is trusted on a return. */
export const OVERVIEW_TTL_MS = 5 * 60_000
/** Cached PR counts younger than this are reused rather than refetched. */
export const PULL_REQUEST_TTL_MS = 10 * 60_000

export type MountScanPlan =
  | { mode: 'full' }
  | {
      mode: 'cheap'
      /** The repo to re-read, if it is still in the cached overview. */
      repoPath?: string
      /** PR counts to show immediately; refetched only for `repoPath`. */
      pullRequestCounts?: CachedPullRequestCounts
    }

export function planMountScan(input: {
  returning: boolean
  selectedRepoPath?: string
  cached: WorkspaceOverview | undefined
  cachedPullRequests: CachedPullRequestCounts | undefined
  now: Date
}): MountScanPlan {
  const { returning, selectedRepoPath, cached, cachedPullRequests, now } = input
  if (!returning || !cached || cached.repos.length === 0) return { mode: 'full' }

  const scanned = Date.parse(cached.scannedAt)
  if (!Number.isFinite(scanned) || now.getTime() - scanned > OVERVIEW_TTL_MS) return { mode: 'full' }

  const repoPath = selectedRepoPath && cached.repos.some((repo) => repo.path === selectedRepoPath)
    ? selectedRepoPath
    : undefined
  const prFetched = cachedPullRequests ? Date.parse(cachedPullRequests.fetchedAt) : Number.NaN
  const prFresh = Number.isFinite(prFetched) && now.getTime() - prFetched <= PULL_REQUEST_TTL_MS
  return {
    mode: 'cheap',
    repoPath,
    pullRequestCounts: prFresh ? cachedPullRequests : undefined,
  }
}
