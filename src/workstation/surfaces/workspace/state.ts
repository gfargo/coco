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

/**
 * Which panel currently receives j/k input. Modeled to match
 * `coco ui`'s `'sidebar' | 'commits' | 'detail'` so users moving
 * between the two surfaces don't have to learn a different focus
 * model.
 *
 * - `sidebar`: j/k cycles the tab filter (All / Dirty / Behind / PRs)
 * - `list`:    j/k moves the cursor through repos
 * - `filter`:  modal text-input for the search filter
 * - `add-repo`: modal path-prompt
 * - `confirm-delete`: modal y-confirm before removing a repo
 *
 * Tab / Shift+Tab cycles between `sidebar` and `list`. Modal focuses
 * are entered/exited via their own keys (`/`, `a`, `d`) and ignore
 * Tab while open.
 */
export type WorkspaceFocus = 'sidebar' | 'list' | 'filter' | 'add-repo' | 'confirm-delete'

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
  /** Keymap help overlay toggle. */
  showHelp: boolean
  /** First-run onboarding overlay toggle. Self-dismisses on first user action. */
  showOnboarding: boolean
  /**
   * Paths added through the add-repo prompt. Only entries in this set
   * can be removed via the delete affordance — repos discovered via
   * configured roots would just come back on the next refresh.
   */
  knownRepoPaths: ReadonlyArray<string>
  /** Path the user is being asked to confirm deletion for. */
  pendingDeletePath?: string
  /**
   * Repo path the cursor was on right before the user opened the
   * filter prompt. Used to restore the cursor when the filter is
   * cleared (Esc) — without it, the cursor would land at index 0
   * which is a papercut every time you cancel a filter.
   */
  cursorBeforeFilter?: string
}

export type WorkspaceAction =
  | { type: 'replace-overview'; overview: WorkspaceOverview }
  | { type: 'anchor-cursor-by-path'; path: string }
  | { type: 'replace-pull-request-counts'; counts: Readonly<Record<string, number>>; authenticated: boolean }
  | { type: 'set-sort'; sort: WorkspaceSortMode }
  | { type: 'cycle-sort' }
  | { type: 'set-tab'; tab: WorkspaceTab }
  | { type: 'cycle-tab'; direction: 'next' | 'previous' }
  | { type: 'cycle-panel-focus'; direction: 'next' | 'previous' }
  | { type: 'set-filter'; filter: string }
  | { type: 'clear-filter' }
  | { type: 'set-focus'; focus: WorkspaceFocus }
  | { type: 'move-cursor'; delta: number }
  | { type: 'set-cursor'; index: number }
  | { type: 'set-loading'; loading: boolean }
  | { type: 'set-status'; status?: string }
  | { type: 'toggle-help' }
  | { type: 'close-help' }
  | { type: 'dismiss-onboarding' }
  | { type: 'replace-known-repos'; paths: ReadonlyArray<string> }
  | { type: 'request-delete'; path: string }
  | { type: 'cancel-delete' }

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
  /** Render the first-run onboarding overlay. */
  showOnboarding?: boolean
  /** Paths considered "known" (added via the add-repo prompt). */
  knownRepoPaths?: ReadonlyArray<string>
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
    showHelp: false,
    showOnboarding: Boolean(init.showOnboarding),
    knownRepoPaths: init.knownRepoPaths ?? [],
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
    case 'cycle-panel-focus': {
      // Two-panel cycle: sidebar ↔ list. Modal focuses (filter,
      // add-repo, confirm-delete) are reached/dismissed via their
      // own bindings and ignore Tab — explicit modes shouldn't be
      // exit-able by an accidental Tab press.
      if (state.focus !== 'sidebar' && state.focus !== 'list') {
        return state
      }
      const next: WorkspaceFocus = state.focus === 'sidebar' ? 'list' : 'sidebar'
      return { ...state, focus: next }
    }
    case 'set-filter': {
      return rectifySelection({ ...state, filter: action.filter, selectedIndex: 0 })
    }
    case 'clear-filter': {
      // Drop the filter, return to list focus, and try to restore the
      // cursor onto the row that was selected before we entered the
      // filter prompt. Falls back to index 0 when the snapshot row no
      // longer exists in the visible list (e.g., it was removed
      // between filter open and clear).
      const restored: WorkspaceState = {
        ...state,
        filter: '',
        focus: 'list',
        selectedIndex: 0,
        cursorBeforeFilter: undefined,
      }
      if (!state.cursorBeforeFilter) {
        return restored
      }
      const visible = selectVisibleRepos(restored)
      const idx = visible.findIndex((entry) => entry.path === state.cursorBeforeFilter)
      if (idx < 0) {
        return restored
      }
      return { ...restored, selectedIndex: idx }
    }
    case 'set-focus': {
      // Snapshot the cursor when the user opens the filter prompt so
      // we can put them back where they were if they bail with Esc.
      if (action.focus === 'filter' && state.focus !== 'filter') {
        const focused = selectFocusedRepo(state)
        return {
          ...state,
          focus: action.focus,
          cursorBeforeFilter: focused?.path ?? state.cursorBeforeFilter,
        }
      }
      // Committing the filter from inside the prompt (focus → list)
      // clears the snapshot — the user is keeping the filtered view,
      // so any cancel from here on should restart the cycle.
      if (action.focus === 'list' && state.focus === 'filter') {
        return { ...state, focus: action.focus, cursorBeforeFilter: undefined }
      }
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
    case 'toggle-help': {
      return { ...state, showHelp: !state.showHelp, showOnboarding: false }
    }
    case 'close-help': {
      return { ...state, showHelp: false }
    }
    case 'dismiss-onboarding': {
      return { ...state, showOnboarding: false }
    }
    case 'replace-known-repos': {
      return { ...state, knownRepoPaths: action.paths }
    }
    case 'request-delete': {
      // No-op if the cursor target isn't actually in the known set —
      // the input layer is supposed to gate this, but defensive
      // gating here keeps the reducer authoritative.
      if (!state.knownRepoPaths.includes(action.path)) {
        return state
      }
      return { ...state, focus: 'confirm-delete', pendingDeletePath: action.path }
    }
    case 'cancel-delete': {
      return { ...state, focus: 'list', pendingDeletePath: undefined }
    }
    default:
      return state
  }
}

export function isRepoRemovable(state: WorkspaceState, repoPath: string): boolean {
  return state.knownRepoPaths.includes(repoPath)
}

export function selectFocusedRepo(state: WorkspaceState): WorkspaceRepoSummary | undefined {
  const visible = selectVisibleRepos(state)
  return visible[state.selectedIndex]
}
