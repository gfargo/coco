import { WorkspaceOverview, WorkspaceRepoSummary } from '../../../git/workspaceData'

import {
  assignWorkspaceColumnWidths,
  buildWorkspaceFooter,
  buildWorkspaceHeader,
  buildWorkspaceHelpRows,
  buildWorkspaceListRows,
  buildWorkspaceListWindow,
  buildWorkspaceOnboarding,
  buildWorkspaceSidebar,
} from './render'
import { applyWorkspaceAction, createWorkspaceState } from './state'

function repo(overrides: Partial<WorkspaceRepoSummary>): WorkspaceRepoSummary {
  return {
    path: overrides.path ?? `/tmp/${overrides.name ?? 'r'}`,
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

describe('workspace render builders', () => {
  const state = createWorkspaceState({
    overview: overview([
      repo({
        name: 'coco',
        branch: 'main',
        dirty: 2,
        ahead: 1,
        behind: 3,
        lastCommit: { hash: 'abc', date: '2026-05-01T12:00:00Z', subject: 'feat: thing' },
      }),
      repo({ name: 'docs', branch: 'feature/x', dirty: 0 }),
    ]),
    roots: ['~/code'],
  })

  it('builds a list row per visible repo with the expected columns (absolute dates)', () => {
    const rows = buildWorkspaceListRows(state, { width: 160, dateMode: 'absolute' })
    expect(rows.map((row) => row.repo.name)).toEqual(['coco', 'docs'])
    expect(rows[0].cursor).toBe(true)
    expect(rows[1].cursor).toBe(false)
    const [name, branch, status, date, subject, path] = rows[0].columns
    expect(name.text.startsWith('coco')).toBe(true)
    expect(branch.text.startsWith('main')).toBe(true)
    expect(status.text).toContain('●2')
    expect(status.text).toContain('↑1')
    expect(status.text).toContain('↓3')
    expect(date.text.startsWith('2026-05-01')).toBe(true)
    expect(subject.text).toContain('feat: thing')
    expect(path.text).toContain('/tmp/coco')
  })

  it('relative date mode formats the date column compactly', () => {
    const rows = buildWorkspaceListRows(state, {
      width: 120,
      dateMode: 'relative',
      now: new Date('2026-05-30T00:00:00Z'),
    })
    // coco's lastCommit is 2026-05-01 → 29 days → 4w
    expect(rows[0].columns[3].text.trim()).toMatch(/^(\d+(d|w|mo|y)|now|\dh|\d+m)$/)
  })

  it('renders the placeholder · for a clean repo and dims the status cell', () => {
    const rows = buildWorkspaceListRows(state)
    const docs = rows[1]
    expect(docs.columns[2].text.trim()).toBe('·')
    expect(docs.columns[2].tone).toBe('dim')
  })

  it('includes pr count in the status cell when gh is authenticated', () => {
    const next = applyWorkspaceAction(state, {
      type: 'replace-pull-request-counts',
      counts: { [state.overview.repos[1].path]: 4 },
      authenticated: true,
    })
    const rows = buildWorkspaceListRows(next)
    // PR token uses the ⊙ glyph matching the PRs tab.
    expect(rows[1].columns[2].text).toContain('⊙4')
  })

  it('omits pr tokens when gh is unauthenticated', () => {
    const next = applyWorkspaceAction(state, {
      type: 'replace-pull-request-counts',
      counts: { [state.overview.repos[1].path]: 4 },
      authenticated: false,
    })
    const rows = buildWorkspaceListRows(next)
    expect(rows[1].columns[2].text).not.toContain('⊙4')
  })

  it('dims the PRs sidebar tab when gh is unauthenticated', () => {
    const next = applyWorkspaceAction(state, {
      type: 'replace-pull-request-counts',
      counts: {},
      authenticated: false,
    })
    const sidebar = buildWorkspaceSidebar(next)
    const prs = sidebar.find((row) => row.tab === 'pull-requests')!
    expect(prs.disabled).toBe(true)
    expect(sidebar.find((row) => row.tab === 'all')!.active).toBe(true)
  })

  it('marks the active sidebar tab', () => {
    const next = applyWorkspaceAction(state, { type: 'set-tab', tab: 'dirty' })
    const sidebar = buildWorkspaceSidebar(next)
    expect(sidebar.find((row) => row.tab === 'dirty')!.active).toBe(true)
  })

  it('header reports root list, repo counts and sort label', () => {
    const next = applyWorkspaceAction(state, { type: 'set-sort', sort: 'name' })
    const header = buildWorkspaceHeader(next, { appLabel: 'coco workspace' })
    expect(header.repoCount).toBe(2)
    expect(header.visibleCount).toBe(2)
    expect(header.sortLabel).toBe('Name')
    expect(header.rootsLabel).toBe('~/code')
    expect(header.appLabel).toBe('coco workspace')
  })

  it('footer shows filter hint when filter focus is active', () => {
    const focused = applyWorkspaceAction(state, { type: 'set-focus', focus: 'filter' })
    const footer = buildWorkspaceFooter(focused)
    expect(footer.filterMode).toBe(true)
    expect(footer.hint).toContain('type filter')
  })

  it('footer shows status when the runtime set one', () => {
    const noted = applyWorkspaceAction(state, { type: 'set-status', status: 'Refreshed.' })
    const footer = buildWorkspaceFooter(noted)
    expect(footer.status).toBe('Refreshed.')
  })

  it('footer hint flips to the add-repo prompt when add-repo focus is active', () => {
    const focused = applyWorkspaceAction(state, { type: 'set-focus', focus: 'add-repo' })
    expect(buildWorkspaceFooter(focused).hint).toContain('tab to complete')
  })

  it('help rows cover every binding wired by the input resolver', () => {
    const rows = buildWorkspaceHelpRows()
    const allKeys = rows.map((row) => row.keys).join(' | ')
    for (const expected of ['j', 'k', 'g', 'G', 's', '/', 'r', 'a', 'd', '?', 'q', 'enter', 'tab', 'esc']) {
      expect(allKeys).toContain(expected)
    }
  })

  describe('assignWorkspaceColumnWidths', () => {
    it('drops the path column first on narrow terminals', () => {
      const widths = assignWorkspaceColumnWidths(70)
      expect(widths.name).toBeDefined()
      expect(widths.branch).toBeDefined()
      expect(widths.status).toBeDefined()
      expect(widths.date).toBeDefined()
      expect(widths.subject).toBeDefined()
      expect(widths.path).toBeUndefined()
    })

    it('drops the subject column next', () => {
      const widths = assignWorkspaceColumnWidths(50)
      expect(widths.name).toBeDefined()
      expect(widths.branch).toBeDefined()
      expect(widths.status).toBeDefined()
      expect(widths.date).toBeDefined()
      expect(widths.subject).toBeUndefined()
      expect(widths.path).toBeUndefined()
    })

    it('drops date next when very narrow', () => {
      const widths = assignWorkspaceColumnWidths(40)
      expect(widths.name).toBeDefined()
      expect(widths.branch).toBeDefined()
      expect(widths.status).toBeDefined()
      expect(widths.date).toBeUndefined()
      expect(widths.subject).toBeUndefined()
      expect(widths.path).toBeUndefined()
    })

    it('keeps status longer than branch — status drops only after branch', () => {
      // Branch min 12 + cursor 2 + status 8 + gap 1 = 23 → budget 25 fits
      // name+status. Below that we drop status too.
      const widths = assignWorkspaceColumnWidths(28)
      expect(widths.name).toBeDefined()
      expect(widths.status).toBeDefined()
      expect(widths.branch).toBeUndefined()
      expect(widths.date).toBeUndefined()
    })

    it('keeps every column at standard width', () => {
      const widths = assignWorkspaceColumnWidths(140)
      expect(widths.name).toBeGreaterThanOrEqual(14)
      expect(widths.branch).toBeGreaterThanOrEqual(12)
      expect(widths.status).toBeGreaterThanOrEqual(8)
      expect(widths.date).toBe(10)
      expect(widths.subject).toBeGreaterThanOrEqual(18)
      expect(widths.path).toBeGreaterThanOrEqual(18)
    })

    it('respects per-column max caps when widening', () => {
      const widths = assignWorkspaceColumnWidths(400)
      expect(widths.name).toBeLessThanOrEqual(36)
      expect(widths.branch).toBeLessThanOrEqual(28)
      expect(widths.status).toBeLessThanOrEqual(16)
      expect(widths.date).toBe(10)
      expect(widths.subject).toBeLessThanOrEqual(60)
    })

    it('keeps name as the irreducible minimum even at zero budget', () => {
      const widths = assignWorkspaceColumnWidths(0)
      expect(widths.name).toBeDefined()
      expect(widths.branch).toBeUndefined()
      expect(widths.status).toBeUndefined()
    })

    it('builds list rows with only the surviving columns at narrow widths', () => {
      const rows = buildWorkspaceListRows(state, { width: 50 })
      // Path drops below ~68 cells; expect <=4 columns per row.
      expect(rows[0].columns.length).toBeLessThanOrEqual(4)
    })
  })

  it('footer hint flips to the confirm-delete copy when pending', () => {
    const focused = applyWorkspaceAction(state, {
      type: 'replace-known-repos',
      paths: [state.overview.repos[0].path],
    })
    const requested = applyWorkspaceAction(focused, {
      type: 'request-delete',
      path: state.overview.repos[0].path,
    })
    expect(buildWorkspaceFooter(requested).hint).toContain('press y')
  })

  it('onboarding model returns show=false unless the flag is set', () => {
    expect(buildWorkspaceOnboarding(state)).toEqual({ show: false })
  })

  it('onboarding model surfaces empty + populated hints based on overview shape', () => {
    const populated = { ...state, showOnboarding: true }
    expect(buildWorkspaceOnboarding(populated).populatedHint).toContain('enter')
    const empty = {
      ...state,
      showOnboarding: true,
      overview: { ...state.overview, repos: [] },
    }
    expect(buildWorkspaceOnboarding(empty).emptyHint).toContain('No repos found')
    expect(buildWorkspaceOnboarding(empty).populatedHint).toBeUndefined()
  })

  describe('buildWorkspaceListWindow', () => {
    function bigState(count: number) {
      const repos = Array.from({ length: count }, (_, i) =>
        repo({
          name: `repo-${String(i).padStart(2, '0')}`,
          path: `/tmp/repo-${i}`,
          lastCommit: { hash: `h${i}`, date: '2026-05-01', subject: `subject ${i}` },
        })
      )
      return createWorkspaceState({
        overview: overview(repos),
        roots: ['~/code'],
      })
    }

    it('returns every row when the list fits the viewport', () => {
      const win = buildWorkspaceListWindow(bigState(5), { rows: 10 })
      expect(win.rows).toHaveLength(5)
      expect(win.hiddenAbove).toBe(0)
      expect(win.hiddenBelow).toBe(0)
      expect(win.totalRows).toBe(5)
    })

    it('windows the list to the viewport height when overflowing', () => {
      const win = buildWorkspaceListWindow(bigState(50), { rows: 10 })
      expect(win.rows).toHaveLength(10)
      expect(win.hiddenAbove + win.rows.length + win.hiddenBelow).toBe(50)
    })

    it('keeps the cursor inside the window when scrolled to the bottom', () => {
      const state = bigState(50)
      const moved = applyWorkspaceAction(state, { type: 'set-cursor', index: 49 })
      const win = buildWorkspaceListWindow(moved, { rows: 10 })
      expect(win.hiddenBelow).toBe(0)
      expect(win.hiddenAbove).toBe(40)
      // Cursor row should appear in the window.
      const cursorRow = win.rows.find((row) => row.cursor)
      expect(cursorRow).toBeDefined()
      expect(cursorRow?.repo.name).toBe('repo-49')
    })

    it('keeps the cursor about a third from the top when scrolling through the middle', () => {
      const state = bigState(50)
      const moved = applyWorkspaceAction(state, { type: 'set-cursor', index: 25 })
      const win = buildWorkspaceListWindow(moved, { rows: 12 })
      // restAbove = floor(12 / 3) = 4 → start = max(0, 25 - 4) = 21
      expect(win.hiddenAbove).toBe(21)
      expect(win.rows[4].repo.name).toBe('repo-25')
      expect(win.rows[4].cursor).toBe(true)
    })

    it('floors viewport rows at 1 even when given 0', () => {
      const win = buildWorkspaceListWindow(bigState(5), { rows: 0 })
      expect(win.rows.length).toBeGreaterThanOrEqual(1)
    })
  })
})
