/**
 * Status-line hints for "what to do next" after a workflow that
 * mutates the worktree (split-apply, etc.). Pure formatting — the
 * runtime computes the counts and the helpers turn them into
 * directive copy.
 *
 * The goal is to keep momentum after a successful operation. An
 * empty success message ("Applied 4 commits.") reads as a dead end
 * when there are still uncommitted changes to deal with. A directive
 * hint ("Applied 4 commits. 6 unstaged + 3 untracked remaining —
 * press gs to stage, I to draft AI commit message.") tells the user
 * exactly what their next move can be without forcing them to scan
 * panes for state.
 */

/**
 * Format the "what's left after the split" suffix that follows a
 * successful split-apply message. Returns a string suitable for
 * concatenation, NOT a standalone sentence.
 *
 * Inputs are non-negative integer counts; behavior is undefined for
 * negatives (the caller should clamp before passing). The hint
 * elides categories with zero counts so we don't say "0 untracked"
 * — just the non-zero ones.
 *
 * Examples:
 *   formatRemainingWorktreeHint(6, 3)
 *     → "6 unstaged + 3 untracked remaining — press gs to stage, I to draft AI commit message."
 *   formatRemainingWorktreeHint(0, 3)
 *     → "3 untracked remaining — press gs to stage them, then I for an AI draft."
 *   formatRemainingWorktreeHint(6, 0)
 *     → "6 unstaged remaining — press gs to review, I to draft AI commit message."
 *   formatRemainingWorktreeHint(0, 0)
 *     → ''  (caller should branch on "remaining > 0" before calling)
 */
export function formatRemainingWorktreeHint(unstaged: number, untracked: number): string {
  if (unstaged <= 0 && untracked <= 0) {
    return ''
  }
  const parts: string[] = []
  if (unstaged > 0) parts.push(`${unstaged} unstaged`)
  if (untracked > 0) parts.push(`${untracked} untracked`)
  const counts = parts.join(' + ')
  // Tailor the action hint slightly based on whether there's
  // anything to actually review-and-stage vs just track. With
  // untracked-only, "review" doesn't fit — the files are new
  // additions, not diffs to scan.
  if (unstaged > 0) {
    return `${counts} remaining — press gs to stage, I to draft AI commit message.`
  }
  return `${counts} remaining — press gs to stage them, then I for an AI draft.`
}

/**
 * Lightweight descriptor matching `SplitPlanFallbackInfo` from
 * `splitPlanGenerator`. Duplicated here as a structural type so
 * `postApplyHints` doesn't take a dependency on the commit-split
 * module just to format a status line.
 */
export interface SplitApplyFallbackHint {
  reason: string
}

/**
 * Format the full post-apply success message: count of commits
 * created + where to see them + what's left + how to act on it.
 *
 * The user feedback that motivated this: "I click apply and at the
 * end the staged files just disappear — what should I expect to see
 * in my git history graph when I navigate back to it?" The previous
 * success message was just "Created N split commits" with no nav
 * cue. New users (and even experienced ones returning to the
 * workstation) don't immediately know that the new commits are now
 * in the history view.
 *
 * Output shape:
 *   "Created N commits — press gh to view them in history.
 *    6 unstaged + 3 untracked remaining — press gs to stage, I to draft AI commit message."
 *
 * When the worktree is clean post-apply:
 *   "Created N commits — press gh to view them in history. Worktree is clean."
 *
 * When `fallback` is set, the planner exhausted its retry budget and
 * the apply landed the single-group fallback plan instead of a real
 * multi-group split. Prefix the message so the user knows the result
 * isn't a true LLM split — they may want to re-roll with a different
 * model, or accept the combined commit as-is.
 */
export function formatSplitApplySuccess(
  commitCount: number,
  unstaged: number,
  untracked: number,
  fallback?: SplitApplyFallbackHint
): string {
  const created = commitCount === 1
    ? 'Created 1 commit'
    : `Created ${commitCount} commits`
  const navCue = `${created} — press gh to view them in history.`
  const remainingHint = formatRemainingWorktreeHint(unstaged, untracked)
  const tail = remainingHint ? ` ${remainingHint}` : ' Worktree is clean.'
  if (fallback) {
    return `Split planner fallback applied (combined commit) — ${fallback.reason}. ${navCue}${tail}`
  }
  return `${navCue}${tail}`
}

/**
 * Momentum suffix for a successful manual commit (#1355). The moment a
 * commit lands is exactly when "push it" and "see it in history" are
 * the next moves — an unadorned "Created abc123" reads as a dead end.
 * Concatenated onto the success message, not a standalone sentence.
 */
export const COMMIT_MOMENTUM_HINT = ' — P push · gh history'
