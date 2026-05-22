import { formatRemainingWorktreeHint, formatSplitApplySuccess } from './postApplyHints'

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

describe('formatSplitApplySuccess', () => {
  it('surfaces the commit count + nav cue + remaining-work hint', () => {
    const msg = formatSplitApplySuccess(5, 6, 3)
    expect(msg).toContain('Created 5 commits')
    expect(msg).toContain('press gh to view them in history')
    expect(msg).toContain('6 unstaged')
    expect(msg).toContain('3 untracked')
    expect(msg).toContain('press gs to stage')
  })

  it('uses singular grammar when exactly one commit was created', () => {
    // "Created 1 commits" reads as broken English; the helper
    // branches on count for the singular case.
    const msg = formatSplitApplySuccess(1, 0, 0)
    expect(msg).toContain('Created 1 commit')
    expect(msg).not.toContain('Created 1 commits')
  })

  it('elides the remaining-work hint when the worktree is clean', () => {
    const msg = formatSplitApplySuccess(3, 0, 0)
    expect(msg).toContain('Created 3 commits')
    expect(msg).toContain('Worktree is clean')
    expect(msg).not.toContain('remaining')
  })

  it('always surfaces the nav cue regardless of remaining work', () => {
    // The nav cue ("press gh to view them in history") is the key
    // closure for the "what should I expect to see?" confusion — it
    // should appear in every successful apply, whether or not there's
    // residue.
    expect(formatSplitApplySuccess(5, 0, 0)).toContain('gh')
    expect(formatSplitApplySuccess(5, 6, 3)).toContain('gh')
    expect(formatSplitApplySuccess(1, 0, 3)).toContain('gh')
  })

  it('prefixes a fallback note when the planner exhausted retries', () => {
    // When the split planner falls back to a single-group plan, the
    // apply still succeeds — but the user needs to know the result
    // isn't a real LLM-driven multi-group split. The success message
    // should be unmistakable: prefixed with "Split planner fallback
    // applied" and include the reason so the user can decide whether
    // to re-roll or accept the combined commit.
    const msg = formatSplitApplySuccess(1, 0, 0, {
      reason: 'plan included duplicate hunks after retries',
    })
    expect(msg).toContain('Split planner fallback applied')
    expect(msg).toContain('combined commit')
    expect(msg).toContain('duplicate hunks after retries')
    // Nav cue + clean-worktree tail still present.
    expect(msg).toContain('press gh to view them in history')
    expect(msg).toContain('Worktree is clean')
  })

  it('omits the fallback prefix when no fallback descriptor is passed', () => {
    const msg = formatSplitApplySuccess(3, 0, 0)
    expect(msg).not.toContain('fallback')
  })
})
