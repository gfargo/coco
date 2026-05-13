import { formatRemainingWorktreeHint } from './postApplyHints'

describe('formatRemainingWorktreeHint', () => {
  it('returns an empty string when nothing is left to commit', () => {
    // The caller branches on remaining > 0 before invoking, but
    // belt-and-suspenders empty-input handling keeps the helper safe
    // to call unconditionally.
    expect(formatRemainingWorktreeHint(0, 0)).toBe('')
  })

  it('combines unstaged and untracked counts in one hint', () => {
    const hint = formatRemainingWorktreeHint(6, 3)
    expect(hint).toContain('6 unstaged')
    expect(hint).toContain('3 untracked')
    expect(hint).toContain('press gs to stage')
    expect(hint).toContain('I to draft AI commit message')
  })

  it('elides untracked when the count is zero', () => {
    const hint = formatRemainingWorktreeHint(6, 0)
    expect(hint).toContain('6 unstaged')
    expect(hint).not.toContain('untracked')
    // Unstaged-only hint still suggests reviewing before drafting.
    expect(hint).toContain('press gs to stage')
  })

  it('elides unstaged when the count is zero', () => {
    const hint = formatRemainingWorktreeHint(0, 3)
    expect(hint).toContain('3 untracked')
    expect(hint).not.toContain('unstaged')
    // Untracked-only path uses slightly different action copy since
    // there's nothing to "review" — the files are new additions.
    expect(hint).toContain('press gs to stage them, then I for an AI draft')
  })

  it('does not invent action hints when no files match a category', () => {
    // Defensive — negative inputs treated like zero (clamped at the
    // caller, but the helper doesn't blow up on them).
    expect(formatRemainingWorktreeHint(-1, -1)).toBe('')
    expect(formatRemainingWorktreeHint(-5, 3)).toContain('3 untracked')
    expect(formatRemainingWorktreeHint(5, -3)).toContain('5 unstaged')
  })
})
