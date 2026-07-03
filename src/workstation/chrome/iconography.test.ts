import {
  STAGE_STATUS_DOT,
  branchRowMarker,
  formatBranchDivergence,
  formatBranchLastTouched,
  formatUpstreamAheadBanner,
  getBranchRowMarkerColor,
  getPullRequestStateGlyph,
  getStageStatusDotColor,
  sidebarTabCount,
} from './iconography'
import { createLogInkTheme } from './theme'

const colorTheme = createLogInkTheme({ preset: 'default', noColor: false })
const monoTheme = createLogInkTheme({ preset: 'monochrome' })
const asciiTheme = createLogInkTheme({ preset: 'default', ascii: true, noColor: false })

describe('log Ink iconography', () => {
  describe('formatBranchDivergence (P3.1)', () => {
    it('reports no upstream for tracking-less branches', () => {
      expect(formatBranchDivergence({ ahead: 0, behind: 0 })).toBe('no upstream')
    })

    it('returns an empty string when even with upstream (the boring default)', () => {
      // The row marker conveys "synced" — repeating "even with X" on every
      // row is noise that dominates the line.
      expect(formatBranchDivergence({ upstream: 'origin/main', ahead: 0, behind: 0 }))
        .toBe('')
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

  describe('formatUpstreamAheadBanner', () => {
    it('returns undefined when the branch ref is missing (detached HEAD)', () => {
      expect(formatUpstreamAheadBanner(undefined)).toBeUndefined()
    })

    it('returns undefined when there is no upstream configured', () => {
      expect(formatUpstreamAheadBanner({ ahead: 0, behind: 0 })).toBeUndefined()
      expect(formatUpstreamAheadBanner({ ahead: 3, behind: 0 })).toBeUndefined()
    })

    it('returns undefined when behind === 0 (synced or ahead-only)', () => {
      expect(formatUpstreamAheadBanner(
        { upstream: 'origin/main', ahead: 0, behind: 0 }
      )).toBeUndefined()
      expect(formatUpstreamAheadBanner(
        { upstream: 'origin/main', ahead: 5, behind: 0 }
      )).toBeUndefined()
    })

    describe('behind-only', () => {
      it('formats N commits behind with fetch + pull hints', () => {
        expect(formatUpstreamAheadBanner(
          { upstream: 'origin/main', ahead: 0, behind: 2 }
        )).toBe('↓ 2 commits behind origin/main · F fetch · U pull')
      })

      it('uses singular noun for behind === 1', () => {
        expect(formatUpstreamAheadBanner(
          { upstream: 'origin/main', ahead: 0, behind: 1 }
        )).toBe('↓ 1 commit behind origin/main · F fetch · U pull')
      })

      it('handles arbitrary upstream ref names', () => {
        expect(formatUpstreamAheadBanner(
          { upstream: 'upstream/develop', ahead: 0, behind: 7 }
        )).toBe('↓ 7 commits behind upstream/develop · F fetch · U pull')
      })

      it('falls back to v + . under ASCII', () => {
        expect(formatUpstreamAheadBanner(
          { upstream: 'origin/main', ahead: 0, behind: 2 },
          { ascii: true }
        )).toBe('v 2 commits behind origin/main . F fetch . U pull')
      })
    })

    describe('diverged', () => {
      it('formats diverged from <upstream> with both ahead/behind counts', () => {
        expect(formatUpstreamAheadBanner(
          { upstream: 'origin/main', ahead: 2, behind: 2 }
        )).toBe('↑2 ↓2 diverged from origin/main · F fetch · U pull --rebase')
      })

      it('uses pull --rebase hint (fast-forward impossible when local has work)', () => {
        const banner = formatUpstreamAheadBanner(
          { upstream: 'origin/main', ahead: 1, behind: 5 }
        )
        expect(banner).toContain('pull --rebase')
        expect(banner).not.toMatch(/U pull(?! --rebase)/)
      })

      it('falls back to +N -N under ASCII', () => {
        expect(formatUpstreamAheadBanner(
          { upstream: 'origin/main', ahead: 2, behind: 2 },
          { ascii: true }
        )).toBe('+2 -2 diverged from origin/main . F fetch . U pull --rebase')
      })
    })
  })

  describe('branchRowMarker (P3.1)', () => {
    it('marks the current branch with * regardless of upstream state', () => {
      expect(branchRowMarker({ current: true, upstream: 'origin/main' }))
        .toEqual({ glyph: '*', kind: 'head' })
      expect(branchRowMarker({ current: true }))
        .toEqual({ glyph: '*', kind: 'head' })
      expect(branchRowMarker({ current: true, upstream: 'origin/main', ahead: 3 }))
        .toEqual({ glyph: '*', kind: 'head' })
    })

    it('uses ◌ + kind no-upstream for non-current branches without upstream', () => {
      expect(branchRowMarker({ current: false }))
        .toEqual({ glyph: '◌', kind: 'no-upstream' })
    })

    it('uses ? as ASCII fallback for non-current branches without upstream', () => {
      expect(branchRowMarker({ current: false }, { ascii: true }))
        .toEqual({ glyph: '?', kind: 'no-upstream' })
    })

    it('uses ≡ + kind synced for non-current branches synced with their upstream', () => {
      expect(branchRowMarker({ current: false, upstream: 'origin/feat', ahead: 0, behind: 0 }))
        .toEqual({ glyph: '≡', kind: 'synced' })
      // Default ahead/behind to 0 when not provided.
      expect(branchRowMarker({ current: false, upstream: 'origin/feat' }))
        .toEqual({ glyph: '≡', kind: 'synced' })
    })

    it('uses = as ASCII fallback for synced branches', () => {
      expect(branchRowMarker(
        { current: false, upstream: 'origin/feat', ahead: 0, behind: 0 },
        { ascii: true }
      )).toEqual({ glyph: '=', kind: 'synced' })
    })

    it('uses ↓ + kind behind for branches that are behind only', () => {
      expect(branchRowMarker({ current: false, upstream: 'origin/feat', ahead: 0, behind: 3 }))
        .toEqual({ glyph: '↓', kind: 'behind' })
    })

    it('uses v as ASCII fallback for behind branches', () => {
      expect(branchRowMarker(
        { current: false, upstream: 'origin/feat', ahead: 0, behind: 2 },
        { ascii: true }
      )).toEqual({ glyph: 'v', kind: 'behind' })
    })

    it('uses ↑ + kind ahead for branches that are ahead only', () => {
      expect(branchRowMarker({ current: false, upstream: 'origin/feat', ahead: 4, behind: 0 }))
        .toEqual({ glyph: '↑', kind: 'ahead' })
    })

    it('uses ^ as ASCII fallback for ahead branches', () => {
      expect(branchRowMarker(
        { current: false, upstream: 'origin/feat', ahead: 5, behind: 0 },
        { ascii: true }
      )).toEqual({ glyph: '^', kind: 'ahead' })
    })

    it('uses ⇅ + kind diverged for branches that are both ahead and behind', () => {
      expect(branchRowMarker({ current: false, upstream: 'origin/feat', ahead: 2, behind: 2 }))
        .toEqual({ glyph: '⇅', kind: 'diverged' })
      expect(branchRowMarker({ current: false, upstream: 'origin/feat', ahead: 1, behind: 5 }))
        .toEqual({ glyph: '⇅', kind: 'diverged' })
    })

    it('uses ~ as ASCII fallback for diverged branches', () => {
      expect(branchRowMarker(
        { current: false, upstream: 'origin/feat', ahead: 1, behind: 1 },
        { ascii: true }
      )).toEqual({ glyph: '~', kind: 'diverged' })
    })
  })

  describe('getBranchRowMarkerColor', () => {
    it('returns success for head', () => {
      expect(getBranchRowMarkerColor('head', colorTheme)).toBe(colorTheme.colors.success)
    })

    it('returns warning for behind and diverged', () => {
      expect(getBranchRowMarkerColor('behind', colorTheme)).toBe(colorTheme.colors.warning)
      expect(getBranchRowMarkerColor('diverged', colorTheme)).toBe(colorTheme.colors.warning)
    })

    it('returns info for ahead', () => {
      expect(getBranchRowMarkerColor('ahead', colorTheme)).toBe(colorTheme.colors.info)
    })

    it('returns undefined for synced and no-upstream (the neutral cases)', () => {
      expect(getBranchRowMarkerColor('synced', colorTheme)).toBeUndefined()
      expect(getBranchRowMarkerColor('no-upstream', colorTheme)).toBeUndefined()
    })

    it('returns undefined under noColor / monochrome regardless of kind', () => {
      expect(getBranchRowMarkerColor('head', monoTheme)).toBeUndefined()
      expect(getBranchRowMarkerColor('behind', monoTheme)).toBeUndefined()
      expect(getBranchRowMarkerColor('ahead', monoTheme)).toBeUndefined()
      expect(getBranchRowMarkerColor('diverged', monoTheme)).toBeUndefined()
    })
  })

  describe('formatBranchLastTouched', () => {
    const now = new Date(Date.UTC(2026, 4, 2)) // 2026-05-02

    it('returns "today" for same-day commits', () => {
      expect(formatBranchLastTouched('2026-05-02', now)).toBe('today')
    })

    it('returns "Nd ago" for the past two weeks', () => {
      expect(formatBranchLastTouched('2026-05-01', now)).toBe('1d ago')
      expect(formatBranchLastTouched('2026-04-30', now)).toBe('2d ago')
      expect(formatBranchLastTouched('2026-04-19', now)).toBe('13d ago')
    })

    it('switches to weeks once we cross 14 days', () => {
      expect(formatBranchLastTouched('2026-04-18', now)).toBe('2w ago')
      expect(formatBranchLastTouched('2026-03-15', now)).toBe('6w ago')
    })

    it('switches to months once we cross ~9 weeks', () => {
      expect(formatBranchLastTouched('2026-02-15', now)).toBe('2mo ago')
      expect(formatBranchLastTouched('2025-08-15', now)).toBe('8mo ago')
    })

    it('switches to years for >= 12 months old', () => {
      expect(formatBranchLastTouched('2024-05-02', now)).toBe('2y ago')
      expect(formatBranchLastTouched('2023-01-01', now)).toBe('3y ago')
    })

    it('collapses future-dated inputs (clock skew) to "today"', () => {
      expect(formatBranchLastTouched('2026-05-10', now)).toBe('today')
    })

    it('returns "" for missing or malformed input', () => {
      expect(formatBranchLastTouched(undefined, now)).toBe('')
      expect(formatBranchLastTouched('', now)).toBe('')
      expect(formatBranchLastTouched('not-a-date', now)).toBe('')
    })

    it('tolerates full ISO timestamps (uses the date prefix only)', () => {
      expect(formatBranchLastTouched('2026-04-30T18:33:42Z', now)).toBe('2d ago')
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
    it('maps staged → green, unstaged → yellow, untracked → muted (#1353 — git convention)', () => {
      // Matches git porcelain / lazygit / gitui: staged is the "safe,
      // ready" green, unstaged the "modified" yellow. The old mapping
      // (staged yellow, unstaged red) was inverted from every peer and
      // drained red of its destructive meaning.
      expect(getStageStatusDotColor('staged', colorTheme)).toBe(
        colorTheme.colors.gitAdded ?? colorTheme.colors.success
      )
      expect(getStageStatusDotColor('unstaged', colorTheme)).toBe(
        colorTheme.colors.gitModified ?? colorTheme.colors.warning
      )
      expect(getStageStatusDotColor('untracked', colorTheme)).toBe('gray')
      // Never the danger red — that's reserved for destructive actions.
      expect(getStageStatusDotColor('unstaged', colorTheme)).not.toBe(colorTheme.colors.danger)
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
