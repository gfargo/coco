import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * Severity of refresh required by an observed change.
 *
 * - `worktree` — only the working tree / index changed. Cheap to refresh
 *   (single `getWorktreeOverview` call); the rest of the context (branches,
 *   tags, stashes, PR metadata) stays valid.
 * - `full` — branch tip moved, HEAD switched, or refs were created /
 *   deleted. Requires `loadLogInkContext` to reload everything.
 *
 * The debouncer escalates monotonically: once a `full` is requested in a
 * window, subsequent `worktree` triggers don't downgrade it.
 */
export type LogInkRefreshKind = 'worktree' | 'full'

export type LogInkRefreshDebouncerOptions = {
  /** ms to wait after the last trigger before emitting `onSettle`. */
  debounceMs?: number
  /** Called once per debounce window with the highest kind seen. */
  onSettle: (kind: LogInkRefreshKind) => void
  /** Override `setTimeout`/`clearTimeout` for tests. */
  scheduler?: {
    setTimeout: (callback: () => void, ms: number) => unknown
    clearTimeout: (handle: unknown) => void
  }
}

export type LogInkRefreshDebouncer = {
  trigger: (kind: LogInkRefreshKind) => void
  /** Drops any pending settle without firing it. */
  close: () => void
}

const DEFAULT_DEBOUNCE_MS = 250

const DEFAULT_SCHEDULER = {
  // `callback` is typed `() => void` (a function reference, never a string),
  // and `ms` is a number, so the eval-injection vector behind DevSkim
  // DS172411 doesn't apply here.
  // DevSkim: ignore DS172411
  setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
  clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

/**
 * Pure debouncer that coalesces a burst of `trigger` calls into one
 * `onSettle` invocation. Tracks the highest-severity kind across the
 * window so a fast sequence of worktree-then-HEAD changes still produces
 * a single `full` refresh.
 *
 * Extracted from the watcher so it's testable without touching `fs.watch`.
 */
export function createRefreshDebouncer(
  options: LogInkRefreshDebouncerOptions
): LogInkRefreshDebouncer {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS
  const scheduler = options.scheduler ?? DEFAULT_SCHEDULER
  let timer: unknown = null
  let pendingKind: LogInkRefreshKind | null = null

  const onTimerFire = (): void => {
    timer = null
    const kindToEmit = pendingKind || 'worktree'
    pendingKind = null
    options.onSettle(kindToEmit)
  }

  const trigger = (kind: LogInkRefreshKind) => {
    pendingKind = pendingKind === 'full' ? 'full' : kind
    if (timer !== null) {
      scheduler.clearTimeout(timer)
    }
    // The first arg is a function value defined above (`onTimerFire`),
    // never a string, so the eval-injection vector that drives
    // DevSkim DS172411 doesn't apply here. The second arg is also our
    // own `debounceMs` constant — no caller-supplied data flows in.
    // DevSkim: ignore DS172411
    timer = scheduler.setTimeout(onTimerFire, debounceMs)
  }

  const close = () => {
    if (timer !== null) {
      scheduler.clearTimeout(timer)
      timer = null
    }
    pendingKind = null
  }

  return { trigger, close }
}

export type LogInkRefreshWatcherOptions = {
  /** Working tree root (output of `git rev-parse --show-toplevel`). */
  repoRoot: string
  /** Resolved git directory (output of `git rev-parse --absolute-git-dir`). */
  gitDir: string
  /** Called once per debounce window. */
  onChange: (kind: LogInkRefreshKind) => void
  debounceMs?: number
}

export type LogInkRefreshWatcher = {
  close: () => void
}

/**
 * Watch the repo's `.git` metadata + the working tree root for changes
 * that should refresh the TUI's repository context. Best-effort: missing
 * paths or platforms without `fs.watch` support degrade gracefully — the
 * user can still manually refresh with `r`.
 *
 * The watch surface is deliberately narrow:
 *
 * - `.git/index` (worktree refresh) — fires on `git add` / `rm` / `commit`
 * - `.git/HEAD` (full refresh)      — fires on branch switches and detached
 *   HEAD operations
 * - `.git/refs/heads` recursively (full refresh) — fires on commits to a
 *   branch tip, branch creation/deletion
 * - `.git/logs/HEAD` (full refresh) — fires on every HEAD movement: git
 *   reset, rebase, cherry-pick, merge, pull --rebase, commit --amend. This
 *   is the primary signal for graph-mutating operations on an attached
 *   branch where `.git/HEAD` itself (the symbolic ref) does not change.
 *   Best-effort: silently skipped when `core.logAllRefUpdates=false` or the
 *   file does not yet exist (fresh repo). The refs/heads + HEAD watches
 *   still cover those cases.
 * - repo root non-recursively (worktree refresh) — picks up top-level
 *   create/delete/rename. Subdirectory unstaged edits do NOT trigger an
 *   auto-refresh; the user can press `r` for those, which keeps watch
 *   overhead negligible on large repos.
 */
export function createRefreshWatcher(
  options: LogInkRefreshWatcherOptions
): LogInkRefreshWatcher {
  const debouncer = createRefreshDebouncer({
    debounceMs: options.debounceMs,
    onSettle: options.onChange,
  })
  const watchers: fs.FSWatcher[] = []

  const safeWatch = (
    pathname: string,
    kind: LogInkRefreshKind,
    watchOptions: fs.WatchOptions = {}
  ): void => {
    try {
      const watcher = fs.watch(pathname, watchOptions, () => debouncer.trigger(kind))
      // fs.watch errors at runtime (e.g. file removed) shouldn't crash the
      // TUI — the watcher is best-effort.
      watcher.on('error', () => {})
      watchers.push(watcher)
    } catch {
      // Path may not exist (fresh repo with no commits yet) or the platform
      // may not support fs.watch on this entry. Skip silently.
    }
  }

  // Watch a single FILE by watching its parent directory and filtering
  // by name. `fs.watch` on the file itself follows the inode — and git
  // updates `index` / `HEAD` / `logs/HEAD` via write-lock-file-then-
  // rename, so a direct file watch fires for the first replacement and
  // then sits on the orphaned old inode forever (the TUI silently
  // stopped auto-refreshing after the first external `git add`). The
  // directory watch survives any number of renames. A null filename
  // (platforms that can't report one) triggers conservatively.
  const safeWatchFileViaParent = (
    pathname: string,
    kind: LogInkRefreshKind
  ): void => {
    const dir = path.dirname(pathname)
    const name = path.basename(pathname)
    try {
      const watcher = fs.watch(dir, (eventType, filename) => {
        if (filename === null || filename === name) {
          debouncer.trigger(kind)
        }
      })
      watcher.on('error', () => {})
      watchers.push(watcher)
    } catch {
      // Parent may not exist (e.g. `.git/logs` in a fresh repo). Skip.
    }
  }

  safeWatchFileViaParent(path.join(options.gitDir, 'index'), 'worktree')
  safeWatchFileViaParent(path.join(options.gitDir, 'HEAD'), 'full')
  safeWatch(path.join(options.gitDir, 'refs', 'heads'), 'full', { recursive: true })
  safeWatchFileViaParent(path.join(options.gitDir, 'logs', 'HEAD'), 'full')
  safeWatch(options.repoRoot, 'worktree')

  return {
    close: () => {
      debouncer.close()
      for (const watcher of watchers) {
        try {
          watcher.close()
        } catch {
          // already closed; ignore
        }
      }
      watchers.length = 0
    },
  }
}
