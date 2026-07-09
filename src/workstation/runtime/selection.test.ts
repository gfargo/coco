/**
 * Tests for the id-based selection selectors (#1452).
 *
 * These verify that the selectors produce the correct id from the
 * legacy index-based state — proving the bridge is correct before
 * consumers start migrating to read through it.
 */
import { createLogInkState } from './inkViewModel'
import type { LogInkContext } from './types'
import { getSelectedBranchId, getSelectedTagId, getSelectedStashId } from './selection'

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
})
