import { WorkspaceOverview, WorkspaceRepoSummary } from '../../../git/workspaceData'

import {
  applyWorkspaceAction,
  createWorkspaceState,
  isRepoRemovable,
  selectFocusedRepo,
  selectVisibleRepos,
} from './state'

function repo(overrides: Partial<WorkspaceRepoSummary>): WorkspaceRepoSummary {
  return {
    path: `/tmp/${overrides.name ?? 'r'}`,
    name: overrides.name ?? 'r',
    branch: overrides.branch ?? 'main',
    ahead: 0,
    behind: 0,
    dirty: 0,
    ...overrides,
  }
}

function overview(repos: WorkspaceRepoSummary[]): WorkspaceOverview {
  return {
    roots: ['/home/me/code'],
    repos,
    scannedAt: '2026-05-26T12:00:00Z',
  }
}

describe('workspace state reducer', () => {
  const baseState = createWorkspaceState({
    overview: overview([
      repo({ name: 'alpha', dirty: 0, lastCommit: { hash: 'a', date: '2026-05-01', subject: 'x' } }),
      repo({ name: 'bravo', dirty: 3, lastCommit: { hash: 'b', date: '2026-04-15', subject: 'x' } }),
      repo({ name: 'charlie', dirty: 1, lastCommit: { hash: 'c', date: '2026-04-01', subject: 'x' } }),
    ]),
    roots: ['~/code'],
  })

  it('defaults to recency sort and the all tab', () => {
    const visible = selectVisibleRepos(baseState)
    expect(visible.map((entry) => entry.name)).toEqual(['alpha', 'bravo', 'charlie'])
    expect(baseState.sortMode).toBe('recency')
    expect(baseState.tab).toBe('all')
  })

  it('cycles the sort mode and resets the cursor', () => {
    const moved = applyWorkspaceAction(baseState, { type: 'move-cursor', delta: 2 })
    expect(moved.selectedIndex).toBe(2)
    const sorted = applyWorkspaceAction(moved, { type: 'cycle-sort' })
    expect(sorted.sortMode).toBe('name')
    expect(sorted.selectedIndex).toBe(0)
  })

  it('clamps the cursor when the visible list shrinks under a filter', () => {
    const cursored = applyWorkspaceAction(
      applyWorkspaceAction(baseState, { type: 'move-cursor', delta: 5 }),
      { type: 'set-filter', filter: 'bra' }
    )
    expect(selectVisibleRepos(cursored).map((entry) => entry.name)).toEqual(['bravo'])
    expect(cursored.selectedIndex).toBe(0)
  })

  it('cycle-panel-focus toggles between sidebar and list', () => {
    expect(baseState.focus).toBe('list')
    const onSidebar = applyWorkspaceAction(baseState, {
      type: 'cycle-panel-focus',
      direction: 'next',
    })
    expect(onSidebar.focus).toBe('sidebar')
    const backToList = applyWorkspaceAction(onSidebar, {
      type: 'cycle-panel-focus',
      direction: 'next',
    })
    expect(backToList.focus).toBe('list')
  })

  it('cycle-panel-focus is a no-op while a modal focus is active', () => {
    const inFilter = { ...baseState, focus: 'filter' as const }
    expect(
      applyWorkspaceAction(inFilter, { type: 'cycle-panel-focus', direction: 'next' }).focus
    ).toBe('filter')
  })

  it('cycles tabs forward and backward', () => {
    const next = applyWorkspaceAction(baseState, { type: 'cycle-tab', direction: 'next' })
    expect(next.tab).toBe('dirty')
    const prev = applyWorkspaceAction(baseState, { type: 'cycle-tab', direction: 'previous' })
    expect(prev.tab).toBe('pull-requests')
  })

  it('hides repos with no open PRs when the pull-requests tab is active', () => {
    const withCounts = applyWorkspaceAction(baseState, {
      type: 'replace-pull-request-counts',
      counts: { '/tmp/bravo': 2 },
      authenticated: true,
    })
    const onTab = applyWorkspaceAction(withCounts, { type: 'set-tab', tab: 'pull-requests' })
    expect(selectVisibleRepos(onTab).map((entry) => entry.name)).toEqual(['bravo'])
    expect(onTab.ghAuthenticated).toBe(true)
  })

  it('records gh authentication failures so the renderer can dim the PRs tab', () => {
    const failed = applyWorkspaceAction(baseState, {
      type: 'replace-pull-request-counts',
      counts: {},
      authenticated: false,
    })
    expect(failed.ghAuthenticated).toBe(false)
  })

  it('replace-overview rectifies the cursor without dropping the sort mode', () => {
    const sortedByDirty = applyWorkspaceAction(baseState, { type: 'set-sort', sort: 'dirty' })
    const movedToEnd = applyWorkspaceAction(sortedByDirty, { type: 'move-cursor', delta: 2 })
    const refreshed = applyWorkspaceAction(movedToEnd, {
      type: 'replace-overview',
      overview: overview([repo({ name: 'solo', dirty: 7 })]),
    })
    expect(refreshed.sortMode).toBe('dirty')
    expect(refreshed.selectedIndex).toBe(0)
    expect(refreshed.loading).toBe(false)
  })

  it('selectFocusedRepo returns the row under the cursor', () => {
    const moved = applyWorkspaceAction(baseState, { type: 'move-cursor', delta: 1 })
    expect(selectFocusedRepo(moved)?.name).toBe('bravo')
  })

  it('clear-filter drops the query, resets focus, and zero-cursors', () => {
    const filtered = applyWorkspaceAction(baseState, { type: 'set-filter', filter: 'bra' })
    const cleared = applyWorkspaceAction(filtered, { type: 'clear-filter' })
    expect(cleared.filter).toBe('')
    expect(cleared.focus).toBe('list')
    expect(cleared.selectedIndex).toBe(0)
  })

  it('records loading + status updates without touching other fields', () => {
    const loading = applyWorkspaceAction(baseState, { type: 'set-loading', loading: true })
    expect(loading.loading).toBe(true)
    expect(loading.overview).toBe(baseState.overview)
    const status = applyWorkspaceAction(loading, { type: 'set-status', status: 'Refreshed.' })
    expect(status.status).toBe('Refreshed.')
  })

  it('seeds the cursor onto the matching repo when selectedRepoPath is provided', () => {
    const seeded = createWorkspaceState({
      overview: baseState.overview,
      roots: ['~/code'],
      selectedRepoPath: '/tmp/bravo',
    })
    expect(seeded.selectedIndex).toBe(1)
  })

  it('falls back to index 0 when the seed path does not exist in the visible list', () => {
    const seeded = createWorkspaceState({
      overview: baseState.overview,
      roots: ['~/code'],
      selectedRepoPath: '/tmp/zzz-not-found',
    })
    expect(seeded.selectedIndex).toBe(0)
  })

  it('anchor-cursor-by-path moves the cursor to the matching repo', () => {
    const anchored = applyWorkspaceAction(baseState, {
      type: 'anchor-cursor-by-path',
      path: '/tmp/charlie',
    })
    expect(anchored.selectedIndex).toBe(2)
  })

  it('anchor-cursor-by-path is a no-op when the path is unknown', () => {
    const anchored = applyWorkspaceAction(baseState, {
      type: 'anchor-cursor-by-path',
      path: '/tmp/not-there',
    })
    expect(anchored.selectedIndex).toBe(baseState.selectedIndex)
  })

  it('toggles the help overlay and auto-dismisses any onboarding banner', () => {
    const seeded = { ...baseState, showOnboarding: true }
    const opened = applyWorkspaceAction(seeded, { type: 'toggle-help' })
    expect(opened.showHelp).toBe(true)
    expect(opened.showOnboarding).toBe(false)
    const closed = applyWorkspaceAction(opened, { type: 'toggle-help' })
    expect(closed.showHelp).toBe(false)
  })

  it('close-help clears the help flag and resets the scroll offset', () => {
    const opened = applyWorkspaceAction(baseState, { type: 'toggle-help' })
    const scrolled = applyWorkspaceAction(opened, { type: 'scroll-help', delta: 5 })
    const closed = applyWorkspaceAction(scrolled, { type: 'close-help' })
    expect(closed.showHelp).toBe(false)
    expect(closed.helpScrollOffset).toBe(0)
  })

  it('scroll-help accumulates the offset and floor-clamps at zero', () => {
    const opened = applyWorkspaceAction(baseState, { type: 'toggle-help' })
    expect(opened.helpScrollOffset).toBe(0)
    const down = applyWorkspaceAction(opened, { type: 'scroll-help', delta: 3 })
    expect(down.helpScrollOffset).toBe(3)
    const up = applyWorkspaceAction(down, { type: 'scroll-help', delta: -10 })
    expect(up.helpScrollOffset).toBe(0)
  })

  it('reopening the help overlay resets the scroll offset to the top', () => {
    const opened = applyWorkspaceAction(baseState, { type: 'toggle-help' })
    const scrolled = applyWorkspaceAction(opened, { type: 'scroll-help', delta: 6 })
    const closed = applyWorkspaceAction(scrolled, { type: 'toggle-help' })
    const reopened = applyWorkspaceAction(closed, { type: 'toggle-help' })
    expect(reopened.showHelp).toBe(true)
    expect(reopened.helpScrollOffset).toBe(0)
  })

  it('dismiss-onboarding clears just the banner flag', () => {
    const seeded = { ...baseState, showOnboarding: true }
    const dismissed = applyWorkspaceAction(seeded, { type: 'dismiss-onboarding' })
    expect(dismissed.showOnboarding).toBe(false)
    expect(dismissed.showHelp).toBe(false)
  })

  it('replace-known-repos updates the removable-set', () => {
    const next = applyWorkspaceAction(baseState, {
      type: 'replace-known-repos',
      paths: ['/tmp/bravo'],
    })
    expect(isRepoRemovable(next, '/tmp/bravo')).toBe(true)
    expect(isRepoRemovable(next, '/tmp/alpha')).toBe(false)
  })

  it('request-delete only fires when the path is in the known set', () => {
    const known = applyWorkspaceAction(baseState, {
      type: 'replace-known-repos',
      paths: ['/tmp/bravo'],
    })
    const ignored = applyWorkspaceAction(known, { type: 'request-delete', path: '/tmp/alpha' })
    expect(ignored.focus).toBe('list')
    expect(ignored.pendingDeletePath).toBeUndefined()

    const requested = applyWorkspaceAction(known, { type: 'request-delete', path: '/tmp/bravo' })
    expect(requested.focus).toBe('confirm-delete')
    expect(requested.pendingDeletePath).toBe('/tmp/bravo')
  })

  it('restores the cursor onto the previously-selected repo when clear-filter fires', () => {
    // Cursor on bravo (index 1) before opening the filter.
    const positioned = applyWorkspaceAction(baseState, { type: 'move-cursor', delta: 1 })
    expect(positioned.selectedIndex).toBe(1)
    const opened = applyWorkspaceAction(positioned, { type: 'set-focus', focus: 'filter' })
    const filtered = applyWorkspaceAction(opened, { type: 'set-filter', filter: 'char' })
    // Filtered list is now [charlie] at index 0.
    expect(selectFocusedRepo(filtered)?.name).toBe('charlie')
    const cleared = applyWorkspaceAction(filtered, { type: 'clear-filter' })
    // Cursor should land back on bravo.
    expect(selectFocusedRepo(cleared)?.name).toBe('bravo')
    expect(cleared.cursorBeforeFilter).toBeUndefined()
  })

  it('falls back to index 0 when the pre-filter row no longer exists', () => {
    const positioned = applyWorkspaceAction(baseState, { type: 'move-cursor', delta: 1 })
    const opened = applyWorkspaceAction(positioned, { type: 'set-focus', focus: 'filter' })
    // Replace the overview while filter is open so the pre-filter
    // row goes away entirely.
    const replaced = applyWorkspaceAction(opened, {
      type: 'replace-overview',
      overview: {
        ...baseState.overview,
        repos: [baseState.overview.repos[0]], // only alpha survives
      },
    })
    const cleared = applyWorkspaceAction(replaced, { type: 'clear-filter' })
    expect(cleared.selectedIndex).toBe(0)
    expect(selectFocusedRepo(cleared)?.name).toBe('alpha')
  })

  it('committing the filter (focus → list) clears the snapshot so a later Esc does not restore', () => {
    const opened = applyWorkspaceAction(baseState, { type: 'set-focus', focus: 'filter' })
    expect(opened.cursorBeforeFilter).toBeDefined()
    const committed = applyWorkspaceAction(opened, { type: 'set-focus', focus: 'list' })
    expect(committed.cursorBeforeFilter).toBeUndefined()
  })

  it('cancel-delete returns focus to the list and clears the pending path', () => {
    const known = applyWorkspaceAction(baseState, {
      type: 'replace-known-repos',
      paths: ['/tmp/bravo'],
    })
    const requested = applyWorkspaceAction(known, { type: 'request-delete', path: '/tmp/bravo' })
    const cancelled = applyWorkspaceAction(requested, { type: 'cancel-delete' })
    expect(cancelled.focus).toBe('list')
    expect(cancelled.pendingDeletePath).toBeUndefined()
  })

  it('set-pull-request-fetching replaces the whole fetching set', () => {
    const next = applyWorkspaceAction(baseState, {
      type: 'set-pull-request-fetching',
      paths: ['/tmp/alpha', '/tmp/bravo'],
    })
    expect(next.pullRequestFetching).toEqual(['/tmp/alpha', '/tmp/bravo'])
  })

  it('mark-pull-request-fetched removes the path from the fetching set', () => {
    let s = applyWorkspaceAction(baseState, {
      type: 'set-pull-request-fetching',
      paths: ['/tmp/alpha', '/tmp/bravo'],
    })
    s = applyWorkspaceAction(s, { type: 'mark-pull-request-fetched', path: '/tmp/alpha' })
    expect(s.pullRequestFetching).toEqual(['/tmp/bravo'])
  })

  it('mark-pull-request-fetched is a no-op for an unknown path', () => {
    const s = applyWorkspaceAction(baseState, {
      type: 'set-pull-request-fetching',
      paths: ['/tmp/alpha'],
    })
    const t = applyWorkspaceAction(s, { type: 'mark-pull-request-fetched', path: '/tmp/zzz' })
    expect(t.pullRequestFetching).toEqual(['/tmp/alpha'])
  })

  describe('theme picker', () => {
    const base = createWorkspaceState({ overview: overview([]), roots: ['~/code'] })

    it('toggles open/closed and closes help/onboarding', () => {
      let s = applyWorkspaceAction({ ...base, showHelp: true, showOnboarding: true }, { type: 'toggle-theme-picker' })
      expect(s.showThemePicker).toBe(true)
      expect(s.showHelp).toBe(false)
      expect(s.showOnboarding).toBe(false)
      s = applyWorkspaceAction(s, { type: 'toggle-theme-picker' })
      expect(s.showThemePicker).toBe(false)
    })

    it('moves the cursor clamped to the preset count and resets it on filter edits', () => {
      let s = applyWorkspaceAction(base, { type: 'toggle-theme-picker' })
      s = applyWorkspaceAction(s, { type: 'move-theme-picker', delta: -1, presetCount: 50 })
      expect(s.themePickerIndex).toBe(0)
      s = applyWorkspaceAction(s, { type: 'move-theme-picker', delta: 999, presetCount: 50 })
      expect(s.themePickerIndex).toBe(49)
      s = applyWorkspaceAction(s, { type: 'append-theme-picker-filter', value: 'gr' })
      expect(s.themePickerFilter).toBe('gr')
      expect(s.themePickerIndex).toBe(0)
      s = applyWorkspaceAction(s, { type: 'backspace-theme-picker-filter' })
      expect(s.themePickerFilter).toBe('g')
      s = applyWorkspaceAction(s, { type: 'clear-theme-picker-filter' })
      expect(s.themePickerFilter).toBe('')
    })
  })

  describe('selectVisibleRepos memoization (#1079)', () => {
    it('returns the cached array across renders that leave the inputs untouched', () => {
      const first = selectVisibleRepos(baseState)
      // A cursor move only swaps selectedIndex — overview.repos, sortMode,
      // tab, filter, and pullRequestCounts all carry by reference, so the
      // visible list must come back as the very same array.
      const moved = applyWorkspaceAction(baseState, { type: 'move-cursor', delta: 1 })
      expect(selectVisibleRepos(moved)).toBe(first)
      // A pure re-read of the same state hits the memo too.
      expect(selectVisibleRepos(baseState)).toBe(first)
    })

    it('invalidates when any keyed input changes', () => {
      const first = selectVisibleRepos(baseState)
      const sorted = applyWorkspaceAction(baseState, { type: 'set-sort', sort: 'name' })
      expect(selectVisibleRepos(sorted)).not.toBe(first)

      const refreshed = applyWorkspaceAction(baseState, {
        type: 'replace-overview',
        overview: overview([repo({ name: 'solo' })]),
      })
      const refreshedVisible = selectVisibleRepos(refreshed)
      expect(refreshedVisible).not.toBe(first)
      expect(refreshedVisible.map((entry) => entry.name)).toEqual(['solo'])

      const withCounts = applyWorkspaceAction(baseState, {
        type: 'replace-pull-request-counts',
        counts: { '/tmp/bravo': 1 },
        authenticated: true,
      })
      expect(selectVisibleRepos(withCounts)).not.toBe(first)
    })
  })
})
