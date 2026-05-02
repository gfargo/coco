import {
  STAGE_STATUS_DOT,
  branchRowMarker,
  formatBranchDivergence,
  getPullRequestStateGlyph,
  getStageStatusDotColor,
  sidebarTabCount,
} from './inkIconography'
import { createLogInkTheme } from './inkTheme'

const colorTheme = createLogInkTheme({ preset: 'default', noColor: false })
const monoTheme = createLogInkTheme({ preset: 'monochrome' })
const asciiTheme = createLogInkTheme({ preset: 'default', ascii: true, noColor: false })

describe('log Ink iconography', () => {
  describe('formatBranchDivergence (P3.1)', () => {
    it('reports no upstream for tracking-less branches', () => {
      expect(formatBranchDivergence({ ahead: 0, behind: 0 })).toBe('no upstream')
    })

    it('reports parity when ahead and behind are zero', () => {
      expect(formatBranchDivergence({ upstream: 'origin/main', ahead: 0, behind: 0 }))
        .toBe('even with origin/main')
    })

    it('uses ↑↓ arrows for divergent branches', () => {
      expect(formatBranchDivergence({ upstream: 'origin/main', ahead: 3, behind: 1 }))
        .toBe('↑3 ↓1 origin/main')
    })

    it('omits the zero direction when divergence is one-sided', () => {
      expect(formatBranchDivergence({ upstream: 'origin/main', ahead: 5, behind: 0 }))
        .toBe('↑5 origin/main')
      expect(formatBranchDivergence({ upstream: 'origin/main', ahead: 0, behind: 2 }))
        .toBe('↓2 origin/main')
    })

    it('falls back to legacy +N/-N format under ASCII', () => {
      expect(formatBranchDivergence(
        { upstream: 'origin/main', ahead: 3, behind: 1 },
        { ascii: true }
      )).toBe('+3/-1 origin/main')
    })
  })

  describe('branchRowMarker (P3.1)', () => {
    it('marks the current branch with *', () => {
      expect(branchRowMarker({ current: true, upstream: 'origin/main' })).toBe('*')
      expect(branchRowMarker({ current: true })).toBe('*')
    })

    it('uses ◌ for non-current branches without upstream', () => {
      expect(branchRowMarker({ current: false })).toBe('◌')
    })

    it('uses ? as ASCII fallback for non-current branches without upstream', () => {
      expect(branchRowMarker({ current: false }, { ascii: true })).toBe('?')
    })

    it('renders a space for non-current branches with upstream', () => {
      expect(branchRowMarker({ current: false, upstream: 'origin/feat' })).toBe(' ')
    })
  })

  describe('getPullRequestStateGlyph (P3.2)', () => {
    it('maps OPEN to a green ◉', () => {
      const { glyph, color, dim } = getPullRequestStateGlyph(
        { state: 'OPEN', isDraft: false },
        colorTheme
      )
      expect(glyph).toBe('◉')
      expect(color).toBe('green')
      expect(dim).toBe(false)
    })

    it('maps MERGED to a magenta ●', () => {
      const { glyph, color } = getPullRequestStateGlyph(
        { state: 'MERGED', isDraft: false },
        colorTheme
      )
      expect(glyph).toBe('●')
      expect(color).toBe('magenta')
    })

    it('maps CLOSED to a red ×', () => {
      const { glyph, color } = getPullRequestStateGlyph(
        { state: 'CLOSED', isDraft: false },
        colorTheme
      )
      expect(glyph).toBe('×')
      expect(color).toBe('red')
    })

    it('uses dim ◇ for drafts regardless of state', () => {
      const { glyph, color, dim } = getPullRequestStateGlyph(
        { state: 'OPEN', isDraft: true },
        colorTheme
      )
      expect(glyph).toBe('◇')
      expect(color).toBeUndefined()
      expect(dim).toBe(true)
    })

    it('drops color but keeps the glyph under monochrome', () => {
      expect(getPullRequestStateGlyph({ state: 'OPEN', isDraft: false }, monoTheme).color).toBeUndefined()
      expect(getPullRequestStateGlyph({ state: 'MERGED', isDraft: false }, monoTheme).color).toBeUndefined()
    })

    it('drops the glyph entirely under ASCII', () => {
      expect(getPullRequestStateGlyph({ state: 'OPEN', isDraft: false }, asciiTheme).glyph).toBe('')
      expect(getPullRequestStateGlyph({ state: 'MERGED', isDraft: false }, asciiTheme).glyph).toBe('')
    })
  })

  describe('getStageStatusDotColor (P3.3)', () => {
    it('maps unstaged → danger, staged → warning, untracked → muted', () => {
      expect(getStageStatusDotColor('unstaged', colorTheme)).toBe('red')
      expect(getStageStatusDotColor('staged', colorTheme)).toBe('yellow')
      expect(getStageStatusDotColor('untracked', colorTheme)).toBe('gray')
    })

    it('returns undefined under monochrome (drop the dot — it would carry no info)', () => {
      expect(getStageStatusDotColor('unstaged', monoTheme)).toBeUndefined()
      expect(getStageStatusDotColor('staged', monoTheme)).toBeUndefined()
      expect(getStageStatusDotColor('untracked', monoTheme)).toBeUndefined()
    })

    it('returns undefined under ASCII (raw codes carry meaning alone)', () => {
      expect(getStageStatusDotColor('unstaged', asciiTheme)).toBeUndefined()
    })

    it('exposes ● as the canonical dot character', () => {
      expect(STAGE_STATUS_DOT).toBe('●')
    })
  })

  describe('sidebarTabCount (P3.4)', () => {
    const ctx = {
      worktree: { files: [{}, {}, {}] },
      branches: { localBranches: [{}, {}] },
      tags: { tags: [{}] },
      stashes: { stashes: [{}, {}, {}, {}] },
      worktreeList: { worktrees: [{}] },
    }

    it('reads counts from each overview slot', () => {
      expect(sidebarTabCount('status', ctx)).toBe(3)
      expect(sidebarTabCount('branches', ctx)).toBe(2)
      expect(sidebarTabCount('tags', ctx)).toBe(1)
      expect(sidebarTabCount('stashes', ctx)).toBe(4)
      expect(sidebarTabCount('worktrees', ctx)).toBe(1)
    })

    it('returns undefined when the overview is missing (data still loading)', () => {
      expect(sidebarTabCount('status', {})).toBeUndefined()
      expect(sidebarTabCount('branches', {})).toBeUndefined()
      expect(sidebarTabCount('tags', {})).toBeUndefined()
      expect(sidebarTabCount('stashes', {})).toBeUndefined()
      expect(sidebarTabCount('worktrees', {})).toBeUndefined()
    })
  })
})
