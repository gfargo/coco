/**
 * Thin re-export shim over the generic repo-change watcher in `src/lib/`
 * (extracted for #1955 so `src/commands/watch` can reuse the same
 * debounce/quiesce + rename-survival logic without `commands` reaching
 * sideways into `workstation`). Kept under the original `LogInk*` names so
 * every existing import in the workstation (and `refreshWatcher.test.ts`,
 * which carries a documented flaky rename-survival case — see its own
 * comments) keeps working unchanged.
 */
export type {
  RepoChangeDebouncer as LogInkRefreshDebouncer,
  RepoChangeDebouncerOptions as LogInkRefreshDebouncerOptions,
  RepoChangeKind as LogInkRefreshKind,
  RepoChangeWatcher as LogInkRefreshWatcher,
  RepoChangeWatcherOptions as LogInkRefreshWatcherOptions,
} from '../../lib/watcher/repoChangeWatcher'
export {
  createRepoChangeDebouncer as createRefreshDebouncer,
  createRepoChangeWatcher as createRefreshWatcher,
} from '../../lib/watcher/repoChangeWatcher'
