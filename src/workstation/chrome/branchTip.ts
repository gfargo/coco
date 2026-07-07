/**
 * Extract a branch-tip chip from a commit's refs. The chip is shown
 * as a colored prefix before the commit message in full-graph mode so
 * branch tips read as distinct visual anchors rather than getting
 * lost in the trailing `[ref] [ref]` list.
 *
 * Selection priority:
 *   1. `HEAD -> X` — current branch wins. Returned with `kind: 'head'`.
 *   2. The first "plain" local branch (not a tag, not a HEAD marker,
 *      not a remote ref) — `kind: 'local'`.
 *   3. The first remote-tracking branch (`origin/X`) — `kind: 'remote'`,
 *      last-resort so a commit at the tip of a remote branch you don't
 *      have locally still gets a chip with a distinct color.
 *
 * `isHead` is kept for backwards compatibility with consumers that
 * only care about "is this the current branch"; `kind` is the richer
 * source of truth for renderers that want to colour remote-tracking
 * tips differently from local ones (the "where is upstream?" cue).
 *
 * Tags are deliberately excluded from chip selection — they belong in
 * the trailing ref list so the chip column stays branch-only and the
 * eye can rely on "leading chip = branch tip".
 *
 * Returns `undefined` when nothing chip-worthy is present; the
 * renderer then skips the prefix entirely so unmarked commits don't
 * pay any width budget.
 */
export type BranchTipChipKind = 'head' | 'local' | 'remote'

export type BranchTipChip = {
  name: string
  isHead: boolean
  kind: BranchTipChipKind
}

/**
 * Strip refs that are already represented by a branch tip chip so the
 * trailing `[ref] [ref]` list doesn't repeat what the chip is already
 * showing. The chip carries the primary branch name; the trailing
 * list keeps everything else (tags, `origin/HEAD`).
 *
 * Removes:
 *   - exact match of the chipped name (`main`, `feat/foo`)
 *   - `HEAD -> <name>` for the chipped name
 *   - bare `HEAD` when the chip is the HEAD branch
 *   - remote-tracking twin(s) of the chipped name (`origin/<name>`,
 *     `upstream/<name>`) — these duplicate the chip's information
 *     and consume subject-line budget (#1367 item 1)
 */
export function filterChippedRefs(
  refs: string[],
  chip: BranchTipChip | undefined,
  remoteNames?: string[],
): string[] {
  if (!chip) return refs
  const headDecoration = `HEAD -> ${chip.name}`
  // Build a set of remote-tracking variants to exclude.
  const remoteTrackingTwins = new Set<string>()
  if (remoteNames && remoteNames.length > 0) {
    for (const remote of remoteNames) {
      if (remote) remoteTrackingTwins.add(`${remote}/${chip.name}`)
    }
  } else {
    // Fallback: assume "origin" when no remote list is available.
    remoteTrackingTwins.add(`origin/${chip.name}`)
  }
  return refs.filter((ref) => {
    if (ref === chip.name) return false
    if (ref === headDecoration) return false
    if (chip.isHead && ref === 'HEAD') return false
    if (remoteTrackingTwins.has(ref)) return false
    return true
  })
}

/**
 * `remoteNames` lets the caller pass the repository's actual remote
 * names (e.g. `['origin', 'upstream']`) so refs are classified by
 * remote-prefix rather than by "contains a slash". Without it a local
 * feature branch like `feat/x` looks identical to a remote-tracking
 * `origin/x` and gets the wrong colour. When the list is omitted the
 * function falls back to the legacy slash-as-remote heuristic — the
 * sensible default before branch data has loaded and a back-compat
 * affordance for callers that have no remote data to hand.
 */
export function getBranchTipChip(
  refs: string[],
  remoteNames?: string[]
): BranchTipChip | undefined {
  // Empty list is treated the same as omitted: branch data hasn't
  // loaded yet, so we don't have ground truth and the legacy "slash =
  // remote" heuristic is the best guess for first paint.
  const hasRemoteList = Array.isArray(remoteNames) && remoteNames.length > 0
  const isRemoteRef = (ref: string): boolean => {
    if (!ref.includes('/')) return false
    if (!hasRemoteList) return true
    return remoteNames!.some((remote) => remote && ref.startsWith(`${remote}/`))
  }

  for (const ref of refs) {
    if (ref.startsWith('HEAD -> ')) {
      const name = ref.slice('HEAD -> '.length).trim()
      if (name) return { name, isHead: true, kind: 'head' }
    }
  }

  for (const ref of refs) {
    if (
      ref === 'HEAD' ||
      ref.startsWith('HEAD -> ') ||
      ref.startsWith('tag: ') ||
      isRemoteRef(ref)
    ) {
      continue
    }
    if (ref.trim()) {
      return { name: ref.trim(), isHead: false, kind: 'local' }
    }
  }

  for (const ref of refs) {
    if (ref.startsWith('tag: ') || ref === 'HEAD' || ref.startsWith('HEAD -> ')) {
      continue
    }
    if (isRemoteRef(ref) && ref.trim()) {
      return { name: ref.trim(), isHead: false, kind: 'remote' }
    }
  }

  return undefined
}
