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
