/**
 * Public API for the workspace surface. Anything **not** re-exported
 * here is implementation detail — tests can still import the deep
 * paths, but external consumers (the command handler, the rest of
 * coco) go through this barrel.
 *
 * Keep this list minimal. Each entry is something an outside caller
 * actually uses. Internal helpers stay reachable via `./render`,
 * `./state`, etc. for tests + sibling modules.
 */
export {
  startWorkspace,
  type WorkspaceExitResult,
  type WorkspaceResumeState,
  type WorkspaceStartOptions,
} from './runtime'

export type { WorkspaceState } from './state'
export type { WorkspaceSortMode } from './sort'
export type { WorkspaceTab } from './filter'
