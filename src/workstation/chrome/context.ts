export const LOG_INK_CONTEXT_KEYS = [
  'bisect',
  'branches',
  'issueList',
  'lfs',
  'operation',
  'provider',
  'pullRequest',
  'pullRequestList',
  'reflog',
  'remotes',
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
  return { ...previous, ...next }
}

export function isLogInkContextKeyLoading(
  status: LogInkContextStatus,
  key: LogInkContextKey
): boolean {
  return status[key] === 'loading'
}
