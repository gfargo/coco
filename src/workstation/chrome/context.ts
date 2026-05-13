export const LOG_INK_CONTEXT_KEYS = [
  'bisect',
  'branches',
  'lfs',
  'operation',
  'provider',
  'pullRequest',
  'reflog',
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

export function isLogInkContextKeyLoading(
  status: LogInkContextStatus,
  key: LogInkContextKey
): boolean {
  return status[key] === 'loading'
}
