import { BranchRef } from './branchData'
import { GitTagRef } from './tagData'
import {
  BRANCH_SORT_MODES,
  TAG_SORT_MODES,
  cycleBranchSort,
  cycleTagSort,
  formatSortIndicator,
  sortBranches,
  sortTags,
} from './inkSorting'

const branch = (overrides: Partial<BranchRef>): BranchRef => ({
  type: 'local',
  name: `refs/heads/${overrides.shortName || 'x'}`,
  shortName: 'x',
  hash: '0000000',
  upstream: undefined,
  current: false,
  remote: undefined,
  date: '',
  subject: '',
  ahead: 0,
  behind: 0,
  ...overrides,
})

const tag = (overrides: Partial<GitTagRef>): GitTagRef => ({
  name: 'x',
  hash: '0000000',
  date: '',
  subject: '',
  ...overrides,
})

describe('log Ink sorting (P4.2)', () => {
  describe('cycleBranchSort', () => {
    it('cycles through every mode in order', () => {
      let mode = BRANCH_SORT_MODES[0]
      const seen: string[] = []
      for (let i = 0; i < BRANCH_SORT_MODES.length + 1; i += 1) {
        seen.push(mode)
        mode = cycleBranchSort(mode)
      }
      expect(seen.slice(0, BRANCH_SORT_MODES.length)).toEqual(BRANCH_SORT_MODES)
      // After one full revolution we land back on the first mode.
      expect(seen[BRANCH_SORT_MODES.length]).toBe(BRANCH_SORT_MODES[0])
    })

    it('falls back to the first mode for an unknown current value', () => {
      // @ts-expect-error -- exercising the recovery path
      expect(cycleBranchSort('not-a-mode')).toBe(BRANCH_SORT_MODES[0])
    })
  })

  describe('sortBranches', () => {
    const sample: BranchRef[] = [
      branch({ shortName: 'feat/zeta', date: '2026-04-01', ahead: 0, behind: 5 }),
      branch({ shortName: 'main', date: '2026-04-30', ahead: 1, behind: 0 }),
      branch({ shortName: 'feat/alpha', date: '2026-04-20', ahead: 8, behind: 2 }),
    ]

    it('sorts by name (alphabetical, stable)', () => {
      expect(sortBranches(sample, 'name').map((b) => b.shortName))
        .toEqual(['feat/alpha', 'feat/zeta', 'main'])
    })

    it('sorts by recent (newest date first)', () => {
      expect(sortBranches(sample, 'recent').map((b) => b.shortName))
        .toEqual(['main', 'feat/alpha', 'feat/zeta'])
    })

    it('sorts by ahead (most unmerged work first)', () => {
      expect(sortBranches(sample, 'ahead').map((b) => b.shortName))
        .toEqual(['feat/alpha', 'main', 'feat/zeta'])
    })

    it('returns a copy — never mutates the input', () => {
      const before = sample.map((b) => b.shortName)
      sortBranches(sample, 'name')
      sortBranches(sample, 'recent')
      sortBranches(sample, 'ahead')
      expect(sample.map((b) => b.shortName)).toEqual(before)
    })

    // Visual feedback after 0.38.0: the active branch should always
    // sit at the top of the list so the cursor lands on it by default.
    // Pin is mode-agnostic — applies to name / recent / ahead alike.
    describe('pins the current branch at index 0', () => {
      const withCurrent: BranchRef[] = [
        branch({ shortName: 'feat/zeta', date: '2026-04-01', ahead: 0, behind: 5 }),
        branch({ shortName: 'main', date: '2026-04-30', ahead: 1, behind: 0 }),
        branch({ shortName: 'feat/alpha', date: '2026-04-20', ahead: 8, behind: 2 }),
        branch({ shortName: 'feat/current', date: '2026-04-10', ahead: 3, behind: 0, current: true }),
      ]

      it('lands the current branch at position 0 under name sort', () => {
        const sorted = sortBranches(withCurrent, 'name').map((b) => b.shortName)
        expect(sorted[0]).toBe('feat/current')
        // The remaining branches stay in alphabetical order.
        expect(sorted.slice(1)).toEqual(['feat/alpha', 'feat/zeta', 'main'])
      })

      it('lands the current branch at position 0 under recent sort', () => {
        // Even though `main` is the freshest commit, `feat/current` still
        // pins to position 0 — pin overrides the configured mode.
        const sorted = sortBranches(withCurrent, 'recent').map((b) => b.shortName)
        expect(sorted[0]).toBe('feat/current')
        expect(sorted.slice(1)).toEqual(['main', 'feat/alpha', 'feat/zeta'])
      })

      it('lands the current branch at position 0 under ahead sort', () => {
        // `feat/alpha` has the most ahead but `feat/current` still pins.
        const sorted = sortBranches(withCurrent, 'ahead').map((b) => b.shortName)
        expect(sorted[0]).toBe('feat/current')
        expect(sorted.slice(1)).toEqual(['feat/alpha', 'main', 'feat/zeta'])
      })

      it('falls through to plain sort when no branch is marked current', () => {
        // Detached HEAD or fresh state — nothing to pin, sort the rest
        // by mode only.
        const noneCurrent = withCurrent.map((b) => ({ ...b, current: false }))
        expect(sortBranches(noneCurrent, 'name').map((b) => b.shortName))
          .toEqual(['feat/alpha', 'feat/current', 'feat/zeta', 'main'])
      })
    })
  })

  describe('cycleTagSort', () => {
    it('cycles through every mode in order', () => {
      const seen: string[] = []
      let mode = TAG_SORT_MODES[0]
      for (let i = 0; i < TAG_SORT_MODES.length + 1; i += 1) {
        seen.push(mode)
        mode = cycleTagSort(mode)
      }
      expect(seen.slice(0, TAG_SORT_MODES.length)).toEqual(TAG_SORT_MODES)
      expect(seen[TAG_SORT_MODES.length]).toBe(TAG_SORT_MODES[0])
    })
  })

  describe('sortTags', () => {
    const sample: GitTagRef[] = [
      tag({ name: 'v0.9.0', date: '2026-01-01' }),
      tag({ name: 'v1.0.0', date: '2026-04-01' }),
      tag({ name: 'v0.10.0', date: '2026-03-01' }),
    ]

    it('sorts by name (alphabetical)', () => {
      expect(sortTags(sample, 'name').map((t) => t.name))
        .toEqual(['v0.10.0', 'v0.9.0', 'v1.0.0'])
    })

    it('sorts by recent (newest date first)', () => {
      expect(sortTags(sample, 'recent').map((t) => t.name))
        .toEqual(['v1.0.0', 'v0.10.0', 'v0.9.0'])
    })
  })

  describe('formatSortIndicator', () => {
    it('uses ▼ glyph by default', () => {
      expect(formatSortIndicator('recent')).toBe('▼ recent')
      expect(formatSortIndicator('name')).toBe('▼ name')
    })

    it('falls back to v under ASCII', () => {
      expect(formatSortIndicator('recent', { ascii: true })).toBe('v recent')
    })
  })
})
