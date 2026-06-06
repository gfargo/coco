/**
 * Validation suite for the `selectVisibleRepos` single-entry memo
 * (#1079). The memo is only safe if it is *transparent* — every caller
 * must observe exactly what an uncached recompute would produce, and
 * the on-screen frame must never go stale because a cursor move handed
 * back a cached array.
 *
 * Three lenses, each an independent proof:
 *
 *   1. Selector fuzz — long random action sequences; at every step the
 *      memoized result must deep-equal a fresh, non-cached reference
 *      computation. Catches both failure directions: a key that should
 *      have invalidated but didn't (stale read) and a key that
 *      invalidated needlessly (correctness is unaffected, but the test
 *      would still pass — staleness is the dangerous one).
 *
 *   2. Identity stability — the performance contract. Actions that
 *      leave the five keyed inputs untouched (cursor moves, PR-fetch
 *      markers, loading/status) must return the *same* array reference;
 *      actions that change a keyed input must recompute.
 *
 *   3. Render transparency — drive a keystroke-like sequence through
 *      the real `renderWorkspaceApp`; every warm-cache frame must render
 *      identically to the same logical state computed from forcibly
 *      fresh references (guaranteed cache miss). This is the end-to-end
 *      "no stale frames" guarantee.
 */

import { createElement, type ReactElement } from 'react'

import type { WorkspaceOverview, WorkspaceRepoSummary } from '../../../git/workspaceData'
import { createLogInkTheme } from '../../chrome/theme'

import { filterWorkspaceRepos, matchesWorkspaceText, WORKSPACE_TABS } from './filter'
import { sortWorkspaceRepos, WORKSPACE_SORT_MODES } from './sort'
import {
  applyWorkspaceAction,
  createWorkspaceState,
  selectVisibleRepos,
  type WorkspaceAction,
  type WorkspaceState,
} from './state'
import { renderWorkspaceApp, type RenderWorkspaceAppDeps } from './view'

/**
 * Non-cached reference implementation — a verbatim copy of the memo's
 * compute body. The whole point of the suite is that the production
 * `selectVisibleRepos` must always agree with this.
 */
function selectVisibleReposReference(state: WorkspaceState): WorkspaceRepoSummary[] {
  const sorted = sortWorkspaceRepos(state.overview.repos, state.sortMode)
  const tabFiltered = filterWorkspaceRepos(sorted, state.tab, {
    pullRequestCounts: state.pullRequestCounts,
  })
  return state.filter
    ? tabFiltered.filter((entry) => matchesWorkspaceText(entry, state.filter))
    : tabFiltered
}

/** Deterministic PRNG so a failure reproduces from the seed. */
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const REPO_NAMES = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel']

function repoFor(name: string, rng: () => number): WorkspaceRepoSummary {
  const day = 10 + Math.floor(rng() * 18)
  return {
    path: `/tmp/${name}`,
    name,
    branch: rng() < 0.5 ? 'main' : `feature/${name}`,
    ahead: Math.floor(rng() * 3),
    behind: Math.floor(rng() * 4),
    dirty: Math.floor(rng() * 5),
    lastCommit:
      rng() < 0.85
        ? { hash: name, date: `2026-05-${String(day).padStart(2, '0')}T00:00:00Z`, subject: `work on ${name}` }
        : undefined,
  }
}

function randomOverview(rng: () => number): WorkspaceOverview {
  const count = 1 + Math.floor(rng() * REPO_NAMES.length)
  const repos = REPO_NAMES.slice(0, count)
    // Shuffle so discovery order isn't always alphabetical.
    .map((name) => ({ name, k: rng() }))
    .sort((a, b) => a.k - b.k)
    .map(({ name }) => repoFor(name, rng))
  return { roots: ['/home/me/code'], repos, scannedAt: '2026-05-26T12:00:00Z' }
}

/**
 * Pick a random action. Deliberately weighted toward the keyed inputs
 * (sort / tab / filter / overview / PR counts) AND the non-keyed ones
 * (cursor / fetch markers / loading) so the fuzz exercises both
 * "should invalidate" and "must not invalidate" transitions.
 */
function randomAction(rng: () => number, state: WorkspaceState): WorkspaceAction {
  const paths = state.overview.repos.map((r) => r.path)
  const pick = rng()
  if (pick < 0.18) return { type: 'move-cursor', delta: Math.floor(rng() * 7) - 3 }
  if (pick < 0.26) return { type: 'set-cursor', index: Math.floor(rng() * 8) }
  if (pick < 0.34) return { type: 'cycle-sort' }
  if (pick < 0.4)
    return { type: 'set-sort', sort: WORKSPACE_SORT_MODES[Math.floor(rng() * WORKSPACE_SORT_MODES.length)] }
  if (pick < 0.5) return { type: 'cycle-tab', direction: rng() < 0.5 ? 'next' : 'previous' }
  if (pick < 0.58) return { type: 'set-tab', tab: WORKSPACE_TABS[Math.floor(rng() * WORKSPACE_TABS.length)] }
  if (pick < 0.68) {
    const q = rng() < 0.5 ? '' : REPO_NAMES[Math.floor(rng() * REPO_NAMES.length)].slice(0, 1 + Math.floor(rng() * 3))
    return { type: 'set-filter', filter: q }
  }
  if (pick < 0.72) return { type: 'clear-filter' }
  if (pick < 0.82) return { type: 'replace-overview', overview: randomOverview(rng) }
  if (pick < 0.9) {
    const counts: Record<string, number> = {}
    for (const p of paths) {
      if (rng() < 0.5) counts[p] = 1 + Math.floor(rng() * 9)
    }
    return { type: 'replace-pull-request-counts', counts, authenticated: rng() < 0.9 }
  }
  // Non-keyed actions — must never invalidate the visible list.
  if (pick < 0.94) return { type: 'set-pull-request-fetching', paths: paths.filter(() => rng() < 0.5) }
  if (pick < 0.97) return { type: 'mark-pull-request-fetched', path: paths[Math.floor(rng() * paths.length)] ?? '' }
  if (pick < 0.99) return { type: 'set-loading', loading: rng() < 0.5 }
  return { type: 'set-status', status: rng() < 0.5 ? 'noise' : undefined }
}

/**
 * The exact set of state slices the memo keys on. The cache must hit
 * iff every one of these is reference/value-equal between two states —
 * this mirror lets the test assert the invalidation predicate directly
 * rather than guessing from the action type (setting `sort` to its
 * current value, for instance, makes a new state object but leaves the
 * keyed inputs identical → a correct cache hit).
 */
function sameMemoKey(a: WorkspaceState, b: WorkspaceState): boolean {
  return (
    a.overview.repos === b.overview.repos &&
    a.sortMode === b.sortMode &&
    a.tab === b.tab &&
    a.filter === b.filter &&
    a.pullRequestCounts === b.pullRequestCounts
  )
}

describe('selectVisibleRepos memo — selector transparency (fuzz)', () => {
  it('always agrees with a fresh, non-cached recompute across random action sequences', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const rng = mulberry32(seed)
      let state = createWorkspaceState({ overview: randomOverview(rng), roots: ['~/code'] })
      for (let step = 0; step < 500; step++) {
        const memoized = selectVisibleRepos(state)
        const reference = selectVisibleReposReference(state)
        // Same length, same order, same repo identities — a stale cache
        // would surface here as a mismatch.
        expect(memoized.map((r) => r.path)).toEqual(reference.map((r) => r.path))
        expect(memoized).toEqual(reference)
        state = applyWorkspaceAction(state, randomAction(rng, state))
      }
    }
  })
})

describe('selectVisibleRepos memo — identity stability contract', () => {
  function baseState(): WorkspaceState {
    const rng = mulberry32(99)
    return createWorkspaceState({ overview: randomOverview(rng), roots: ['~/code'] })
  }

  it('returns the SAME array reference after non-keyed actions', () => {
    const start = baseState()
    const first = selectVisibleRepos(start)
    const nonKeyed: WorkspaceAction[] = [
      { type: 'move-cursor', delta: 1 },
      { type: 'set-cursor', index: 0 },
      { type: 'set-loading', loading: true },
      { type: 'set-status', status: 'hi' },
      { type: 'set-pull-request-fetching', paths: [start.overview.repos[0].path] },
      { type: 'mark-pull-request-fetched', path: start.overview.repos[0].path },
      { type: 'toggle-help' },
    ]
    let state = start
    for (const action of nonKeyed) {
      state = applyWorkspaceAction(state, action)
      expect(selectVisibleRepos(state)).toBe(first)
    }
  })

  it('hits iff the keyed inputs are unchanged, recomputes a fresh reference otherwise', () => {
    const rng = mulberry32(7)
    let state = createWorkspaceState({ overview: randomOverview(rng), roots: ['~/code'] })
    for (let step = 0; step < 400; step++) {
      const before = selectVisibleRepos(state)
      const next = applyWorkspaceAction(state, randomAction(rng, state))
      const after = selectVisibleRepos(next)
      if (sameMemoKey(state, next)) {
        // No keyed input moved → must be the very same cached array.
        expect(after).toBe(before)
      } else {
        // A keyed input changed → a miss always allocates a fresh array,
        // so the reference must differ (proves we never serve a stale hit).
        expect(after).not.toBe(before)
      }
      // Transparency holds either way.
      expect(after).toEqual(selectVisibleReposReference(next))
      state = next
    }
  })
})

describe('selectVisibleRepos memo — render transparency under interaction', () => {
  type StubProps = Record<string, unknown>
  const Text = ((props: StubProps) =>
    createElement('text', props, props.children as React.ReactNode)) as unknown as React.ComponentType<StubProps>
  const Box = ((props: StubProps) =>
    createElement('box', props, props.children as React.ReactNode)) as unknown as React.ComponentType<StubProps>

  const PINNED_NOW = new Date('2026-05-30T00:00:00Z')

  function renderFrame(state: WorkspaceState): ReactElement {
    return renderWorkspaceApp({
      React: { createElement } as unknown as RenderWorkspaceAppDeps['React'],
      ink: { Box, Text },
      state,
      theme: createLogInkTheme({ ascii: true }),
      appLabel: 'coco workspace',
      filterDraft: '',
      addRepoDraft: '~/',
      addRepoCompletion: { baseDir: '~/', prefix: '', completions: [], commonPrefix: '', isDirectory: false },
      cloneUrl: '',
      cloneTarget: '',
      cloneField: 'url',
      cloneCompletion: { baseDir: '~/', prefix: '', completions: [], commonPrefix: '', isDirectory: false },
      cloning: false,
      columns: 120,
      rows: 40,
      spinnerTick: 0,
      now: PINNED_NOW,
    })
  }

  /**
   * Deep-clone the cache-keyed inputs so the next `selectVisibleRepos`
   * is a guaranteed cache MISS — the control against which the warm
   * (possibly-stale) frame is compared.
   */
  function forceFreshInputs(state: WorkspaceState): WorkspaceState {
    return {
      ...state,
      overview: {
        ...state.overview,
        repos: state.overview.repos.map((r) => ({
          ...r,
          lastCommit: r.lastCommit ? { ...r.lastCommit } : undefined,
        })),
      },
      pullRequestCounts: { ...state.pullRequestCounts },
    }
  }

  it('every warm-cache frame renders identically to a cold recompute', () => {
    const rng = mulberry32(2026)
    let state = createWorkspaceState({ overview: randomOverview(rng), roots: ['~/code'] })
    for (let step = 0; step < 300; step++) {
      // Render twice from the SAME logical state:
      //   warm — selectVisibleRepos may hit the cache populated by the
      //          previous step's render (the real interactive path).
      //   cold — fresh references force a full recompute.
      const warm = renderFrame(state)
      const cold = renderFrame(forceFreshInputs(state))
      expect(warm).toEqual(cold)
      state = applyWorkspaceAction(state, randomAction(rng, state))
    }
  })
})
