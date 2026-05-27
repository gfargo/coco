import type {
  WorkspaceOverview,
  WorkspaceRepoSummary,
} from '../../../git/workspaceData'
import {
  filterWorkspaceRepos,
  matchesWorkspaceText,
  nextWorkspaceTab,
  previousWorkspaceTab,
  type WorkspaceTab,
} from './filter'
import {
  nextWorkspaceSortMode,
  sortWorkspaceRepos,
  type WorkspaceSortMode,
} from './sort'

/**
 * Workspace surface state + reducer (#880). Mirrors the
 * `applyLogInkAction` discipline from the existing TUI: pure,
 * side-effect-free, no fs/git access, no `Date.now()`. The reducer is
 * the only place state changes; the runtime sources timestamps and
 * dispatches them on action payloads.
 */

export type WorkspaceFocus = 'list' | 'filter' | 'add-repo'

export type WorkspaceState = {
  overview: WorkspaceOverview
  /** Open-PR counts keyed by repo path. Empty when gh is unavailable. */
  pullRequestCounts: Readonly<Record<string, number>>
  sortMode: WorkspaceSortMode
  tab: WorkspaceTab
  /** Free-text filter applied on top of the sidebar tab. */
  filter: string
  focus: WorkspaceFocus
  /** Cursor index into the visible (sorted + filtered) list. */
  selectedIndex: number
  /** Background-refresh in flight. */
  loading: boolean
  /**
   * Status banner copy. The runtime sets this from workflow outcomes
   * (refresh complete, gh missing, etc.); the renderer surfaces it
   * in the footer.
   */
  status?: string
  /**
   * gh CLI authentication state. `undefined` = not yet probed,
   * `true` = available, `false` = missing/unauthenticated. The
   * "PRs" tab dims itself when this resolves to `false`.
   */
  ghAuthenticated?: boolean
  /**
   * Roots the workspace surface was launched against. Stored on
   * state so the footer can render a `roots: ~/code, ~/work` chip
   * without the renderer reaching back into the runtime closure.
   */
  roots: ReadonlyArray<string>
}

export type WorkspaceAction =
  | { type: 'replace-overview'; overview: WorkspaceOverview }
  | { type: 'anchor-cursor-by-path'; path: string }
  | { type: 'replace-pull-request-counts'; counts: Readonly<Record<string, number>>; authenticated: boolean }
  | { type: 'set-sort'; sort: WorkspaceSortMode }
  | { type: 'cycle-sort' }
  | { type: 'set-tab'; tab: WorkspaceTab }
  | { type: 'cycle-tab'; direction: 'next' | 'previous' }
  | { type: 'set-filter'; filter: string }
  | { type: 'clear-filter' }
  | { type: 'set-focus'; focus: WorkspaceFocus }
  | { type: 'move-cursor'; delta: number }
  | { type: 'set-cursor'; index: number }
  | { type: 'set-loading'; loading: boolean }
  | { type: 'set-status'; status?: string }

export type WorkspaceStateInit = {
  overview: WorkspaceOverview
  roots: ReadonlyArray<string>
  sortMode?: WorkspaceSortMode
  tab?: WorkspaceTab
  filter?: string
  pullRequestCounts?: Readonly<Record<string, number>>
  loading?: boolean
  /**
   * When set, the constructor seeds the cursor onto the row whose
   * repo path matches. Used by the drill-in loop (#880 PR3) so the
   * cursor lands back on the repo the user just exited.
   */
  selectedRepoPath?: string
}

export function createWorkspaceState(init: WorkspaceStateInit): WorkspaceState {
  const base: WorkspaceState = {
    overview: init.overview,
    pullRequestCounts: init.pullRequestCounts ?? {},
    sortMode: init.sortMode ?? 'recency',
    tab: init.tab ?? 'all',
    filter: init.filter ?? '',
    focus: 'list',
    selectedIndex: 0,
    loading: Boolean(init.loading),
    roots: init.roots,
  }
  if (!init.selectedRepoPath) {
    return base
  }
  const visible = selectVisibleRepos(base)
  const idx = visible.findIndex((entry) => entry.path === init.selectedRepoPath)
  if (idx < 0) {
    return base
  }
  return { ...base, selectedIndex: idx }
}

/**
 * Recompute the visible repo list — sort → tab filter → text filter.
 * The renderer consumes this; the reducer also uses it to rectify the
 * cursor after a filter/sort change so the selection stays in range.
 */
export function selectVisibleRepos(state: WorkspaceState): WorkspaceRepoSummary[] {
  const sorted = sortWorkspaceRepos(state.overview.repos, state.sortMode)
  const tabFiltered = filterWorkspaceRepos(sorted, state.tab, {
    pullRequestCounts: state.pullRequestCounts,
  })
  if (!state.filter) {
    return tabFiltered
  }
  return tabFiltered.filter((entry) => matchesWorkspaceText(entry, state.filter))
}

function clampCursor(index: number, length: number): number {
  if (length <= 0) {
    return 0
  }
  if (index < 0) {
    return 0
  }
  if (index >= length) {
    return length - 1
  }
  return index
}

function rectifySelection(state: WorkspaceState): WorkspaceState {
  const visible = selectVisibleRepos(state)
  const clamped = clampCursor(state.selectedIndex, visible.length)
  if (clamped === state.selectedIndex) {
    return state
  }
  return { ...state, selectedIndex: clamped }
}

export function applyWorkspaceAction(
  state: WorkspaceState,
  action: WorkspaceAction
): WorkspaceState {
  switch (action.type) {
    case 'replace-overview': {
      return rectifySelection({
        ...state,
        overview: action.overview,
        loading: false,
      })
    }
    case 'anchor-cursor-by-path': {
      const visible = selectVisibleRepos(state)
      const idx = visible.findIndex((entry) => entry.path === action.path)
      if (idx < 0) {
        return state
      }
      return { ...state, selectedIndex: idx }
    }
    case 'replace-pull-request-counts': {
      return rectifySelection({
        ...state,
        pullRequestCounts: action.counts,
        ghAuthenticated: action.authenticated,
      })
    }
    case 'set-sort': {
      return rectifySelection({ ...state, sortMode: action.sort, selectedIndex: 0 })
    }
    case 'cycle-sort': {
      return rectifySelection({
        ...state,
        sortMode: nextWorkspaceSortMode(state.sortMode),
        selectedIndex: 0,
      })
    }
    case 'set-tab': {
      return rectifySelection({ ...state, tab: action.tab, selectedIndex: 0 })
    }
    case 'cycle-tab': {
      const tab =
        action.direction === 'next'
          ? nextWorkspaceTab(state.tab)
          : previousWorkspaceTab(state.tab)
      return rectifySelection({ ...state, tab, selectedIndex: 0 })
    }
    case 'set-filter': {
      return rectifySelection({ ...state, filter: action.filter, selectedIndex: 0 })
    }
    case 'clear-filter': {
      return rectifySelection({ ...state, filter: '', focus: 'list', selectedIndex: 0 })
    }
    case 'set-focus': {
      return { ...state, focus: action.focus }
    }
    case 'move-cursor': {
      const visible = selectVisibleRepos(state)
      return {
        ...state,
        selectedIndex: clampCursor(state.selectedIndex + action.delta, visible.length),
      }
    }
    case 'set-cursor': {
      const visible = selectVisibleRepos(state)
      return { ...state, selectedIndex: clampCursor(action.index, visible.length) }
    }
    case 'set-loading': {
      return { ...state, loading: action.loading }
    }
    case 'set-status': {
      return { ...state, status: action.status }
    }
    default:
      return state
  }
}

export function selectFocusedRepo(state: WorkspaceState): WorkspaceRepoSummary | undefined {
  const visible = selectVisibleRepos(state)
  return visible[state.selectedIndex]
}
