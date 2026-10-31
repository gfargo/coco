import type { StashOverview } from '../../git/stashData'

export const LOG_INK_CONTEXT_KEYS = [
  'bisect',
  'branches',
  'issueList',
  'lfs',
  'operation',
  'provider',
  'pullRequest',
  'pullRequestChecks',
  'pullRequestList',
  'reflog',
  'remotes',
  'sparse',
  'stashes',
  'submodules',
  'tags',
  'worktree',
  'worktreeList',
] as const

export type LogInkContextKey = typeof LOG_INK_CONTEXT_KEYS[number]

export type LogInkContextLoadState = 'idle' | 'loading' | 'ready'

export type LogInkContextStatus = Record<LogInkContextKey, LogInkContextLoadState>

export function createLogInkContextStatus(
  state: LogInkContextLoadState = 'idle'
): LogInkContextStatus {
  return Object.fromEntries(
    LOG_INK_CONTEXT_KEYS.map((key) => [key, state])
  ) as LogInkContextStatus
}

export function updateLogInkContextStatus(
  status: LogInkContextStatus,
  key: LogInkContextKey,
  state: LogInkContextLoadState
): LogInkContextStatus {
  return {
    ...status,
    [key]: state,
  }
}

export function isLogInkContextLoading(status: LogInkContextStatus): boolean {
  return Object.values(status).some((state) => state === 'loading')
}

/**
 * Merge a fresh boot-load snapshot onto the previous context. `next` only
 * carries the keys `loadLogInkContext` owns (boot-fetched slices) — lazy-
 * loaded slices it doesn't fetch (`pullRequestList`, `issueList`, per-item
 * detail/blame caches) must survive untouched, or every refresh silently
 * clears them (OSS-452).
 */
export function mergeRefreshedContext<T extends object>(previous: T, next: Partial<T>): T {
  return carryStashFiles(previous, { ...previous, ...next })
}

/**
 * A refresh lists stashes without their files (#2209), so a fresh entry would
 * blank the files already loaded. A stash commit never changes, so its files
 * carry over by hash.
 */
function carryStashFiles<T extends object>(previous: T, merged: T): T {
  const before = (previous as { stashes?: StashOverview }).stashes?.stashes
  const after = (merged as { stashes?: StashOverview }).stashes
  if (!before?.length || !after?.stashes.length || after === (previous as { stashes?: StashOverview }).stashes) return merged
  const filesByHash = new Map<string, string[]>()
  for (const stash of before) if (stash.files) filesByHash.set(stash.hash, stash.files)
  if (filesByHash.size === 0) return merged
  return {
    ...merged,
    stashes: {
      ...after,
      stashes: after.stashes.map((stash) => (stash.files || !filesByHash.has(stash.hash) ? stash : { ...stash, files: filesByHash.get(stash.hash) })),
    },
  }
}

/**
 * The status the surfaces and the sidebar render from (#2166). An explicit
 * refresh marks every key `loading` while the previous data is still on
 * screen, and each surface swaps its list for "Loading …" the moment it sees
 * that, so every refresh flashed the whole workstation to loading text. A key
 * that is loading but already has data reads as `ready` here: the old rows
 * stay up until the new ones land. A key with no data yet still reads
 * `loading`, because then there is nothing to show instead. The header keeps
 * the real status and its "loading context" chip is the refresh indicator.
 *
 * Returns `status` itself when nothing changes, so a `useMemo` over it keeps
 * its identity.
 */
export function deriveDisplayContextStatus(
  status: LogInkContextStatus,
  context: Partial<Record<LogInkContextKey, unknown>>
): LogInkContextStatus {
  let display: LogInkContextStatus | undefined
  for (const key of LOG_INK_CONTEXT_KEYS) {
    if (status[key] === 'loading' && context[key] !== undefined) {
      display ??= { ...status }
      display[key] = 'ready'
    }
  }
  return display ?? status
}

export function isLogInkContextKeyLoading(
  status: LogInkContextStatus,
  key: LogInkContextKey
): boolean {
  return status[key] === 'loading'
}
