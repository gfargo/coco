/**
 * Extract a branch-tip chip from a commit's refs. The chip is shown
 * as a colored prefix before the commit message in full-graph mode so
 * branch tips read as distinct visual anchors rather than getting
 * lost in the trailing `[ref] [ref]` list.
 *
 * Selection priority:
 *   1. `HEAD -> X` — current branch wins. Returned with `isHead: true`.
 *   2. The first "plain" local branch (not a tag, not a HEAD marker,
 *      not a remote ref) — typical for commits that are tips of
 *      other local branches.
 *   3. The first remote-tracking branch (`origin/X`) — last-resort
 *      so a commit at the tip of a remote branch you don't have
 *      locally still gets a chip.
 *
 * Tags are deliberately excluded from chip selection — they belong in
 * the trailing ref list so the chip column stays branch-only and the
 * eye can rely on "leading chip = branch tip".
 *
 * Returns `undefined` when nothing chip-worthy is present; the
 * renderer then skips the prefix entirely so unmarked commits don't
 * pay any width budget.
 */
export type BranchTipChip = {
  name: string
  isHead: boolean
}

export function getBranchTipChip(refs: string[]): BranchTipChip | undefined {
  for (const ref of refs) {
    if (ref.startsWith('HEAD -> ')) {
      const name = ref.slice('HEAD -> '.length).trim()
      if (name) return { name, isHead: true }
    }
  }

  for (const ref of refs) {
    if (
      ref === 'HEAD' ||
      ref.startsWith('HEAD -> ') ||
      ref.startsWith('tag: ') ||
      ref.includes('/')
    ) {
      continue
    }
    if (ref.trim()) return { name: ref.trim(), isHead: false }
  }

  for (const ref of refs) {
    if (ref.startsWith('tag: ') || ref === 'HEAD' || ref.startsWith('HEAD -> ')) {
      continue
    }
    if (ref.includes('/') && ref.trim()) {
      return { name: ref.trim(), isHead: false }
    }
  }

  return undefined
}
