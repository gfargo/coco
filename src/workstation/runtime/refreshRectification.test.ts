/**
 * Tests for the refresh-rectification snapshot (OSS-1001 / #1671).
 *
 * These prove the core of the fix: after a background context refresh
 * reorders/inserts/removes rows, `computeRefreshRectificationSnapshot`
 * finds each `selected*Id`-bearing view's new position (or flags it for
 * clearing when the id no longer resolves) — this is what lets the
 * reducer re-sync `selected*Index` so the rendered highlight, the confirm
 * copy, and the id-first workflow executor stay in agreement.
 */
import { createLogInkState } from './inkViewModel'
import type { LogInkContext } from './types'
import { computeRefreshRectificationSnapshot, hasRefreshRectification } from './refreshRectification'

function makeBranch(shortName: string, date = '2026-01-01') {
  return {
    shortName,
    name: `refs/heads/${shortName}`,
    hash: `abc${shortName}`,
    date,
    subject: `commit on ${shortName}`,
    upstream: undefined,
    gone: false,
    ahead: 0,
    behind: 0,
  }
}

function makeTag(name: string) {
  return { name, hash: `tag${name}`, subject: `tag ${name}`, date: '2026-01-01', tagger: '' }
}

function makeStash(index: number) {
  return { ref: `stash@{${index}}`, message: `stash ${index}`, hash: `s${index}`, date: '2026-01-01' }
}

function makeWorktree(path: string, branch?: string) {
  return { path, branch, head: `h-${path}`, detached: !branch, bare: false, current: false, dirty: false }
}

function makeSubmodule(path: string, name = path) {
  return { name, path, pinnedSha: `sha-${path}`, flag: 'clean' as const, trackingBranch: undefined, url: undefined }
}

function makeRemote(name: string) {
  return { name, fetchUrl: `git@example.com:${name}.git`, pushUrl: `git@example.com:${name}.git` }
}

describe('computeRefreshRectificationSnapshot (OSS-1001 / #1671)', () => {
  it('returns no entries when no view has a selected*Id set', () => {
    const state = createLogInkState([])
    const context = {
      branches: { localBranches: [makeBranch('main')], remoteBranches: [], currentBranch: 'main', dirty: false },
    } as unknown as LogInkContext
    const snapshot = computeRefreshRectificationSnapshot(state, context)
    expect(hasRefreshRectification(snapshot)).toBe(false)
  })

  it('resolves the branch id to its new index after the list reorders', () => {
    // The cursor was on 'feature-a' at index 3 in some earlier ordering;
    // a background refresh reorders the list so 'feature-a' now sorts
    // (alphabetically, the default mode) to index 1.
    const state = { ...createLogInkState([]), selectedBranchId: 'feature-a', selectedBranchIndex: 3 }
    const context = {
      branches: {
        localBranches: [makeBranch('feature-b'), makeBranch('feature-a'), makeBranch('main')],
        remoteBranches: [],
        currentBranch: 'main',
        dirty: false,
      },
    } as unknown as LogInkContext
    const snapshot = computeRefreshRectificationSnapshot(state, context)
    // Sorted alphabetically: feature-a, feature-b, main
    expect(snapshot.branch).toEqual({ index: 0 })
  })

  it('flags the branch id for clearing when it no longer resolves', () => {
    const state = { ...createLogInkState([]), selectedBranchId: 'deleted-branch', selectedBranchIndex: 0 }
    const context = {
      branches: { localBranches: [makeBranch('main')], remoteBranches: [], currentBranch: 'main', dirty: false },
    } as unknown as LogInkContext
    const snapshot = computeRefreshRectificationSnapshot(state, context)
    expect(snapshot.branch).toEqual({ clear: true })
  })

  it('respects the active filter — a filtered-out id clears rather than resolving to a hidden row', () => {
    const state = {
      ...createLogInkState([]),
      selectedBranchId: 'feature-a',
      selectedBranchIndex: 0,
      filter: 'main',
    }
    const context = {
      branches: {
        localBranches: [makeBranch('feature-a'), makeBranch('main')],
        remoteBranches: [],
        currentBranch: 'main',
        dirty: false,
      },
    } as unknown as LogInkContext
    const snapshot = computeRefreshRectificationSnapshot(state, context)
    expect(snapshot.branch).toEqual({ clear: true })
  })

  it('leaves the branch entry unset (skip) when no id was set, even with an index', () => {
    const state = { ...createLogInkState([]), selectedBranchId: undefined, selectedBranchIndex: 2 }
    const context = {
      branches: {
        localBranches: [makeBranch('a'), makeBranch('b'), makeBranch('c')],
        remoteBranches: [],
        currentBranch: undefined,
        dirty: false,
      },
    } as unknown as LogInkContext
    const snapshot = computeRefreshRectificationSnapshot(state, context)
    expect(snapshot.branch).toBeUndefined()
  })

  it('resolves tag / stash / worktree / submodule / remote ids independently', () => {
    const state = {
      ...createLogInkState([]),
      selectedTagId: 'v2.0',
      selectedTagIndex: 0,
      selectedStashId: 'stash@{1}',
      selectedStashIndex: 0,
      selectedWorktreeListId: '/repo/wt-b',
      selectedWorktreeListIndex: 0,
      selectedSubmoduleId: 'libs/b',
      selectedSubmoduleIndex: 0,
      selectedRemoteId: 'upstream',
      selectedRemoteIndex: 0,
    }
    const context = {
      tags: { tags: [makeTag('v3.0'), makeTag('v1.0'), makeTag('v2.0')] },
      stashes: { stashes: [makeStash(0), makeStash(1), makeStash(2)] },
      worktreeList: { worktrees: [makeWorktree('/repo/wt-a'), makeWorktree('/repo/wt-b')] },
      submodules: { entries: [makeSubmodule('libs/a'), makeSubmodule('libs/b')] },
      remotes: { entries: [makeRemote('origin'), makeRemote('upstream')] },
    } as unknown as LogInkContext
    const snapshot = computeRefreshRectificationSnapshot(state, context)
    // Default tag sort is 'recent' (date desc, name asc tiebreak); all
    // three fixtures share a date, so it sorts to v1.0, v2.0, v3.0 —
    // 'v2.0' lands at index 1.
    expect(snapshot.tag).toEqual({ index: 1 })
    expect(snapshot.stash).toEqual({ index: 1 })
    expect(snapshot.worktreeList).toEqual({ index: 1 })
    expect(snapshot.submodule).toEqual({ index: 1 })
    expect(snapshot.remote).toEqual({ index: 1 })
  })

  it('does not clear a worktree id that a filter hides but the unfiltered list still resolves (review gap #1)', () => {
    // getSelectedWorktree (selection.ts) falls back to searching the FULL
    // unfiltered list when an active filter hides every row — a palette
    // action can still fire with a stale filter applied. The rectification
    // snapshot must not clear an id the selector would still resolve.
    const state = {
      ...createLogInkState([]),
      selectedWorktreeListId: '/repo/wt-a',
      selectedWorktreeListIndex: 0,
      filter: 'does-not-match-anything',
    }
    const context = {
      worktreeList: { worktrees: [makeWorktree('/repo/wt-a'), makeWorktree('/repo/wt-b')] },
    } as unknown as LogInkContext
    const snapshot = computeRefreshRectificationSnapshot(state, context)
    // No rectification for this view — the id is left exactly as-is
    // rather than being cleared, since getSelectedWorktree would still
    // find it via its unfiltered-list fallback tier.
    expect(snapshot.worktreeList).toBeUndefined()
  })

  it('still clears a worktree id that is genuinely gone from both the filtered and unfiltered lists', () => {
    const state = {
      ...createLogInkState([]),
      selectedWorktreeListId: '/repo/deleted',
      selectedWorktreeListIndex: 0,
      filter: 'does-not-match-anything',
    }
    const context = {
      worktreeList: { worktrees: [makeWorktree('/repo/wt-a'), makeWorktree('/repo/wt-b')] },
    } as unknown as LogInkContext
    const snapshot = computeRefreshRectificationSnapshot(state, context)
    expect(snapshot.worktreeList).toEqual({ clear: true })
  })

  it('does not clear a submodule/remote id filtered out of the visible list either (review gap #1)', () => {
    const state = {
      ...createLogInkState([]),
      selectedSubmoduleId: 'libs/a',
      selectedSubmoduleIndex: 0,
      selectedRemoteId: 'origin',
      selectedRemoteIndex: 0,
      filter: 'does-not-match-anything',
    }
    const context = {
      submodules: { entries: [makeSubmodule('libs/a'), makeSubmodule('libs/b')] },
      remotes: { entries: [makeRemote('origin'), makeRemote('upstream')] },
    } as unknown as LogInkContext
    const snapshot = computeRefreshRectificationSnapshot(state, context)
    expect(snapshot.submodule).toBeUndefined()
    expect(snapshot.remote).toBeUndefined()
  })

  it('skips a view entirely (rather than clearing) when its section is absent from a failed refresh fetch (review gap #2)', () => {
    // useContextRefresh.loadLogInkContext wraps each section's fetch in
    // safe(), which swallows a thrown error and resolves to undefined for
    // just that key. A single flaky fetch (e.g. a hiccuping git submodule
    // subprocess) must not permanently clear a valid id — unlike the
    // context merge itself, a cleared id has no self-healing recovery on
    // the next successful refresh.
    const state = {
      ...createLogInkState([]),
      selectedSubmoduleId: 'libs/a',
      selectedSubmoduleIndex: 0,
    }
    const context = {
      // submodules key entirely absent — this round's fetch failed.
    } as unknown as LogInkContext
    const snapshot = computeRefreshRectificationSnapshot(state, context)
    expect(snapshot.submodule).toBeUndefined()
    expect(hasRefreshRectification(snapshot)).toBe(false)
  })
})
