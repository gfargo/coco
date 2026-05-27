import { WorkspaceOverview, WorkspaceRepoSummary } from '../../../git/workspaceData'

import {
  buildWorkspaceFooter,
  buildWorkspaceHeader,
  buildWorkspaceHelpRows,
  buildWorkspaceListRows,
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

  it('builds a list row per visible repo with the expected columns', () => {
    const rows = buildWorkspaceListRows(state)
    expect(rows.map((row) => row.repo.name)).toEqual(['coco', 'docs'])
    expect(rows[0].cursor).toBe(true)
    expect(rows[1].cursor).toBe(false)
    const [name, branch, status, date, path] = rows[0].columns
    expect(name.text.startsWith('coco')).toBe(true)
    expect(branch.text.startsWith('main')).toBe(true)
    expect(status.text).toContain('●2')
    expect(status.text).toContain('↑1')
    expect(status.text).toContain('↓3')
    expect(date.text.startsWith('2026-05-01')).toBe(true)
    expect(path.text).toContain('/tmp/coco')
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
    expect(rows[1].columns[2].text).toContain('pr4')
  })

  it('omits pr tokens when gh is unauthenticated', () => {
    const next = applyWorkspaceAction(state, {
      type: 'replace-pull-request-counts',
      counts: { [state.overview.repos[1].path]: 4 },
      authenticated: false,
    })
    const rows = buildWorkspaceListRows(next)
    expect(rows[1].columns[2].text).not.toContain('pr4')
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
    for (const expected of ['j', 'k', 'g', 'G', 's', '/', 'r', 'a', '?', 'q', 'enter', 'tab', 'esc']) {
      expect(allKeys).toContain(expected)
    }
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
})
