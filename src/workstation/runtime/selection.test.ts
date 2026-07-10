/**
 * Tests for the id-based selection selectors (#1452).
 *
 * These verify that the selectors produce the correct id from the
 * legacy index-based state — proving the bridge is correct before
 * consumers start migrating to read through it.
 */
import { createLogInkState } from './inkViewModel'
import type { LogInkContext } from './types'
import { getSelectedBranchId, getSelectedTagId, getSelectedStashId, getSelectedWorktree } from './selection'

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

describe('selection selectors (#1452)', () => {
  const context = {
    branches: {
      localBranches: [makeBranch('main'), makeBranch('feature'), makeBranch('hotfix')],
      remoteBranches: [],
      currentBranch: 'main',
      dirty: false,
    },
    tags: { tags: [makeTag('v1.0'), makeTag('v2.0'), makeTag('v3.0')] },
    stashes: { stashes: [makeStash(0), makeStash(1), makeStash(2)] },
  } as unknown as LogInkContext

  describe('getSelectedBranchId', () => {
    it('returns the branch shortName at the selected index', () => {
      // Default sort is 'name' (alphabetical): feature, hotfix, main
      const state = { ...createLogInkState([]), selectedBranchIndex: 1 }
      expect(getSelectedBranchId(state, context)).toBe('hotfix')
    })

    it('clamps out-of-range index to last item', () => {
      const state = { ...createLogInkState([]), selectedBranchIndex: 99 }
      // Sorted: feature, hotfix, main — last is 'main'
      expect(getSelectedBranchId(state, context)).toBe('main')
    })

    it('returns undefined for empty branch list', () => {
      const state = { ...createLogInkState([]), selectedBranchIndex: 0 }
      const emptyCtx = { branches: { localBranches: [], remoteBranches: [], currentBranch: undefined, dirty: false } } as unknown as LogInkContext
      expect(getSelectedBranchId(state, emptyCtx)).toBeUndefined()
    })

    it('respects the active filter', () => {
      const state = { ...createLogInkState([]), selectedBranchIndex: 0, filter: 'hot' }
      // Only 'hotfix' matches 'hot'
      expect(getSelectedBranchId(state, context)).toBe('hotfix')
    })
  })

  describe('getSelectedTagId', () => {
    it('returns the tag name at the selected index', () => {
      const state = { ...createLogInkState([]), selectedTagIndex: 2 }
      expect(getSelectedTagId(state, context)).toBe('v3.0')
    })

    it('returns undefined for empty tags', () => {
      const state = { ...createLogInkState([]), selectedTagIndex: 0 }
      expect(getSelectedTagId(state, { tags: { tags: [] } })).toBeUndefined()
    })
  })

  describe('getSelectedStashId', () => {
    it('returns the stash ref at the selected index', () => {
      const state = { ...createLogInkState([]), selectedStashIndex: 1 }
      expect(getSelectedStashId(state, context)).toBe('stash@{1}')
    })
  })

  // #1452 flip — the id mirror wins over the index when both are set and
  // the id still resolves, so the cursor follows the same logical item
  // across a context refresh that reorders the sorted+filtered list
  // (rendering, which still reads the raw index, is untouched by this —
  // only action-target resolution through these selectors changes).
  describe('id-first resolution (#1452 flip)', () => {
    it('prefers selectedBranchId over selectedBranchIndex when both are set', () => {
      // Sorted: feature, hotfix, main — index 0 is 'feature', but the id
      // mirror points at 'main'.
      const state = { ...createLogInkState([]), selectedBranchIndex: 0, selectedBranchId: 'main' }
      expect(getSelectedBranchId(state, context)).toBe('main')
    })

    it('falls back to the index when selectedBranchId is undefined', () => {
      const state = { ...createLogInkState([]), selectedBranchIndex: 0, selectedBranchId: undefined }
      expect(getSelectedBranchId(state, context)).toBe('feature')
    })

    it('falls back to the index when selectedBranchId no longer resolves (deleted / filtered out)', () => {
      const state = { ...createLogInkState([]), selectedBranchIndex: 1, selectedBranchId: 'gone' }
      expect(getSelectedBranchId(state, context)).toBe('hotfix')
    })

    it('prefers selectedTagId over selectedTagIndex when both are set', () => {
      const state = { ...createLogInkState([]), selectedTagIndex: 0, selectedTagId: 'v3.0' }
      expect(getSelectedTagId(state, context)).toBe('v3.0')
    })

    it('prefers selectedStashId over selectedStashIndex when both are set', () => {
      const state = { ...createLogInkState([]), selectedStashIndex: 0, selectedStashId: 'stash@{2}' }
      expect(getSelectedStashId(state, context)).toBe('stash@{2}')
    })

    // The actual scenario the flip exists to fix: a background context
    // refresh (fetch completing, ahead/behind counts changing, a new
    // branch appearing) can reorder the sorted+filtered list WITHOUT any
    // reducer action touching the index. Before the flip, the selector
    // blindly re-indexed into the new order and silently resolved to a
    // different branch than the one the user had cursored — a stale
    // index pointing at the wrong logical item. After the flip, the id
    // mirror (written once when the user last moved the cursor) keeps
    // resolving to the SAME branch even though its position moved.
    it('keeps resolving to the same branch after a context refresh reorders the list', () => {
      const before = {
        branches: {
          localBranches: [makeBranch('delta'), makeBranch('echo'), makeBranch('foxtrot')],
          remoteBranches: [],
          currentBranch: 'delta',
          dirty: false,
        },
      } as unknown as LogInkContext
      // User moved the cursor to 'echo' (index 1) — moveBranch's dual-write
      // sets both fields together.
      const state = { ...createLogInkState([]), selectedBranchIndex: 1, selectedBranchId: 'echo' }
      expect(getSelectedBranchId(state, before)).toBe('echo')

      // Background refresh: a new branch sorts alphabetically ahead of
      // 'echo', shifting it from index 1 to index 2. No reducer action
      // fired — `state` (index + id) is byte-identical to before.
      const after = {
        branches: {
          localBranches: [makeBranch('alpha'), makeBranch('delta'), makeBranch('echo'), makeBranch('foxtrot')],
          remoteBranches: [],
          currentBranch: 'delta',
          dirty: false,
        },
      } as unknown as LogInkContext
      // Sorted: alpha, delta, echo, foxtrot — index 1 is now 'delta', NOT
      // 'echo'. An index-only lookup would silently return the wrong
      // branch here; the id-first selector still returns 'echo'.
      expect(getSelectedBranchId(state, after)).toBe('echo')
    })
  })

  describe('getSelectedWorktree', () => {
    const worktreeContext = {
      worktreeList: {
        worktrees: [
          makeWorktree('/repo', 'main'),
          makeWorktree('/repo-feature', 'feature'),
        ],
      },
    } as unknown as LogInkContext

    it('returns the worktree at the selected index', () => {
      const state = { ...createLogInkState([]), selectedWorktreeListIndex: 1 }
      expect(getSelectedWorktree(state, worktreeContext)?.path).toBe('/repo-feature')
    })

    // A worktree action reachable from the palette (rather than the
    // worktrees view) can fire with a stale filter still applied — the
    // cursor should still resolve against the unfiltered list rather
    // than going target-less.
    it('falls back to the unfiltered list when the filter hides every worktree', () => {
      const state = {
        ...createLogInkState([]),
        selectedWorktreeListIndex: 1,
        filter: 'does-not-match-anything',
      }
      expect(getSelectedWorktree(state, worktreeContext)?.path).toBe('/repo-feature')
    })

    it('returns undefined when there are no worktrees at all', () => {
      const state = { ...createLogInkState([]), selectedWorktreeListIndex: 0 }
      const emptyCtx = { worktreeList: { worktrees: [] } } as unknown as LogInkContext
      expect(getSelectedWorktree(state, emptyCtx)).toBeUndefined()
    })
  })
})
