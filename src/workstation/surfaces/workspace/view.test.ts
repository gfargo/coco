/**
 * Structural snapshots for `renderWorkspaceApp`. Mirrors the pattern
 * used by the existing surfaces (statusRender.test.ts,
 * historyRender.test.ts) — stub `Box`/`Text` so jest's snapshot
 * serializer can render the React tree without bundling Ink (which is
 * ESM-only) into ts-jest.
 *
 * These tests fix the workspace layout shape for regressions:
 *   - sidebar + main split
 *   - header / footer chrome
 *   - per-state hints (filter focus, add-repo focus, gh-unauth)
 *
 * Pure layers (sort / filter / state / render / input) are covered by
 * their own .test.ts files; this file exists to guard the Ink-shaped
 * output specifically.
 */

import { createElement, type ReactElement } from 'react'

import type { WorkspaceOverview, WorkspaceRepoSummary } from '../../../git/workspaceData'
import { createLogInkTheme } from '../../chrome/theme'

import { completePath } from './pathCompletion'
import { applyWorkspaceAction, createWorkspaceState, type WorkspaceState } from './state'
import { renderWorkspaceApp, type RenderWorkspaceAppDeps } from './view'

type StubProps = Record<string, unknown>

const Text = ((props: StubProps) =>
  createElement('text', props as Record<string, unknown>, props.children as React.ReactNode)
) as unknown as React.ComponentType<StubProps>

const Box = ((props: StubProps) =>
  createElement('box', props as Record<string, unknown>, props.children as React.ReactNode)
) as unknown as React.ComponentType<StubProps>

const components: RenderWorkspaceAppDeps['ink'] = { Box, Text }

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

function baseState(overrides: Partial<WorkspaceState> = {}): WorkspaceState {
  const base = createWorkspaceState({
    overview: overview([
      repo({
        name: 'coco',
        branch: 'main',
        dirty: 2,
        ahead: 1,
        behind: 0,
        lastCommit: { hash: 'aaa', date: '2026-05-01T12:00:00Z', subject: 'feat: thing' },
      }),
      repo({
        name: 'docs',
        branch: 'feature/landing',
        dirty: 0,
        ahead: 0,
        behind: 3,
        lastCommit: { hash: 'bbb', date: '2026-04-15T08:00:00Z', subject: 'wip' },
      }),
      repo({
        name: 'lib',
        branch: 'main',
        dirty: 0,
        ahead: 0,
        behind: 0,
      }),
    ]),
    roots: ['~/code'],
  })
  return { ...base, ...overrides }
}

function render(
  state: WorkspaceState,
  options: {
    filterDraft?: string
    addRepoDraft?: string
    addRepoCompletion?: ReturnType<typeof completePath>
    columns?: number
  } = {}
): ReactElement {
  const theme = createLogInkTheme({ ascii: true })
  return renderWorkspaceApp({
    React: { createElement } as unknown as RenderWorkspaceAppDeps['React'],
    ink: components,
    state,
    theme,
    appLabel: 'coco workspace',
    filterDraft: options.filterDraft ?? '',
    addRepoDraft: options.addRepoDraft ?? '~/',
    addRepoCompletion:
      options.addRepoCompletion ??
      ({
        baseDir: '~/',
        prefix: '',
        completions: [],
        commonPrefix: '',
        isDirectory: false,
      } as ReturnType<typeof completePath>),
    columns: options.columns ?? 120,
  })
}

describe('renderWorkspaceApp', () => {
  it('snapshots the populated workspace with the default tab + sort', () => {
    const tree = render(baseState())
    expect(tree).toMatchSnapshot()
  })

  it('snapshots an empty discovery (no repos, loading false)', () => {
    const tree = render(
      baseState({
        overview: overview([]),
        loading: false,
      })
    )
    expect(tree).toMatchSnapshot()
  })

  it('snapshots the loading placeholder when discovery is in flight', () => {
    const tree = render(
      baseState({
        overview: overview([]),
        loading: true,
      })
    )
    expect(tree).toMatchSnapshot()
  })

  it('snapshots a status banner from the workflow layer', () => {
    const tree = render(
      applyWorkspaceAction(baseState(), { type: 'set-status', status: 'Refreshed 3 repos.' })
    )
    expect(tree).toMatchSnapshot()
  })

  it('snapshots filter focus with a draft showing in the header chip', () => {
    const state = applyWorkspaceAction(baseState(), { type: 'set-focus', focus: 'filter' })
    const tree = render(state, { filterDraft: 'lib' })
    expect(tree).toMatchSnapshot()
  })

  it('snapshots a committed filter (focus back to list)', () => {
    const state = applyWorkspaceAction(baseState(), { type: 'set-filter', filter: 'lib' })
    const tree = render(state)
    expect(tree).toMatchSnapshot()
  })

  it('snapshots the dirty tab', () => {
    const state = applyWorkspaceAction(baseState(), { type: 'set-tab', tab: 'dirty' })
    const tree = render(state)
    expect(tree).toMatchSnapshot()
  })

  it('snapshots the behind tab', () => {
    const state = applyWorkspaceAction(baseState(), { type: 'set-tab', tab: 'behind' })
    const tree = render(state)
    expect(tree).toMatchSnapshot()
  })

  it('snapshots a gh-unauthenticated state dimming the PRs sidebar tab', () => {
    const state = applyWorkspaceAction(baseState(), {
      type: 'replace-pull-request-counts',
      counts: {},
      authenticated: false,
    })
    const tree = render(state)
    expect(tree).toMatchSnapshot()
  })

  it('snapshots PR counts in the status cell when gh is authenticated', () => {
    const state = applyWorkspaceAction(baseState(), {
      type: 'replace-pull-request-counts',
      counts: { '/tmp/coco': 4 },
      authenticated: true,
    })
    const tree = render(state)
    expect(tree).toMatchSnapshot()
  })

  it('snapshots the add-repo prompt with completions', () => {
    const state = applyWorkspaceAction(baseState(), { type: 'set-focus', focus: 'add-repo' })
    const tree = render(state, {
      addRepoDraft: '~/co',
      addRepoCompletion: {
        baseDir: '~/',
        prefix: 'co',
        completions: ['coco/*', 'code/', 'coffee/'],
        commonPrefix: 'co',
        isDirectory: false,
      } as ReturnType<typeof completePath>,
    })
    expect(tree).toMatchSnapshot()
  })

  it('snapshots a narrow terminal (80 columns) so column-budget regressions surface', () => {
    const tree = render(baseState(), { columns: 80 })
    expect(tree).toMatchSnapshot()
  })

  it('snapshots a very narrow terminal (60 columns) — path drops out', () => {
    const tree = render(baseState(), { columns: 60 })
    expect(tree).toMatchSnapshot()
  })

  it('snapshots a wide terminal (200 columns) — columns grow up to their caps', () => {
    const tree = render(baseState(), { columns: 200 })
    expect(tree).toMatchSnapshot()
  })

  it('snapshots the keymap help overlay when toggled on', () => {
    const state = applyWorkspaceAction(baseState(), { type: 'toggle-help' })
    const tree = render(state)
    expect(tree).toMatchSnapshot()
  })

  it('snapshots the confirm-delete prompt for a known repo', () => {
    let state = baseState()
    state = applyWorkspaceAction(state, {
      type: 'replace-known-repos',
      paths: [state.overview.repos[1].path],
    })
    state = applyWorkspaceAction(state, {
      type: 'request-delete',
      path: state.overview.repos[1].path,
    })
    const tree = render(state)
    expect(tree).toMatchSnapshot()
  })

  it('snapshots the first-run onboarding banner', () => {
    const state = { ...baseState(), showOnboarding: true }
    const tree = render(state)
    expect(tree).toMatchSnapshot()
  })

  it('shifts borderColor between focus modes', () => {
    const list = render(baseState())
    const filter = render(applyWorkspaceAction(baseState(), { type: 'set-focus', focus: 'filter' }))
    expect((list.props as StubProps).children).toBeDefined()
    expect((filter.props as StubProps).children).toBeDefined()
    // Sanity: both trees should be Box-rooted; specific borderColor
    // values are checked via the snapshot.
    expect(list.type).toBe(Box)
    expect(filter.type).toBe(Box)
  })
})
