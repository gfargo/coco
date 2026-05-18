/**
 * Extract a branch-tip chip from a commit's refs. The chip is shown
 * as a colored prefix before the commit message in full-graph mode so
 * branch tips read as distinct visual anchors rather than getting
 * lost in the trailing `[ref] [ref]` list.
 *
 * Selection priority:
 *   1. `HEAD -> X` — current branch wins. Returned with `kind: 'head'`.
 *   2. The first local branch (not a tag, not a HEAD marker, not a
 *      ref prefixed by a known remote name) — `kind: 'local'`.
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
 * **The `remoteNames` parameter**: pass the repository's actual remote
 * names (e.g. `['origin', 'upstream']`) to get a precise local-vs-remote
 * classification. Refs starting with `<remoteName>/` are classified as
 * remote; everything else with a slash (`feat/x`, `release/2.0`) stays
 * local. When omitted, the function falls back to a "any slash is
 * remote-like" heuristic — workable for the common single-remote case
 * but misclassifies local feature branches with slashes.
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
 * list keeps everything else — including remote-tracking variants
 * (`origin/X`) and `origin/HEAD` — because those convey "remote is
 * also at this commit" info the chip alone doesn't.
 *
 * Removes:
 *   - exact match of the chipped name (`main`, `feat/foo`)
 *   - `HEAD -> <name>` for the chipped name
 *   - bare `HEAD` when the chip is the HEAD branch (only paranoia;
 *     git typically emits `HEAD -> name` not both, but a detached
 *     fixup commit may have produced both)
 */
export function filterChippedRefs(refs: string[], chip: BranchTipChip | undefined): string[] {
  if (!chip) return refs
  const headDecoration = `HEAD -> ${chip.name}`
  return refs.filter((ref) => {
    if (ref === chip.name) return false
    if (ref === headDecoration) return false
    if (chip.isHead && ref === 'HEAD') return false
    return true
  })
}

/**
 * Returns true if `ref` is a remote-tracking ref under one of the
 * supplied remote names — i.e. it starts with `<remoteName>/` for some
 * `remoteName` in `remoteNames`.
 *
 * When `remoteNames` is empty (or undefined), the caller's intent is
 * "I don't know the remotes" — we fall back to the legacy heuristic
 * of "any ref containing a slash is treated as remote-like." That keeps
 * the single-remote default behavior intact for callers without
 * branch overview data on hand.
 */
function isRemoteTrackingRef(ref: string, remoteNames: string[] | undefined): boolean {
  if (remoteNames && remoteNames.length > 0) {
    return remoteNames.some((name) => ref.startsWith(`${name}/`))
  }
  return ref.includes('/')
}

export function getBranchTipChip(
  refs: string[],
  remoteNames?: string[]
): BranchTipChip | undefined {
  for (const ref of refs) {
    if (ref.startsWith('HEAD -> ')) {
      const name = ref.slice('HEAD -> '.length).trim()
      if (name) return { name, isHead: true, kind: 'head' }
    }
  }

  // Pass 2: prefer local refs. With `remoteNames` provided, a local
  // ref is anything that isn't `<remoteName>/...`, isn't a tag, and
  // isn't a HEAD decoration — so `feat/x` correctly stays local.
  // Without `remoteNames`, fall back to "no slash" as the local check.
  for (const ref of refs) {
    if (
      ref === 'HEAD' ||
      ref.startsWith('HEAD -> ') ||
      ref.startsWith('tag: ')
    ) {
      continue
    }
    if (isRemoteTrackingRef(ref, remoteNames)) {
      continue
    }
    if (ref.trim()) return { name: ref.trim(), isHead: false, kind: 'local' }
  }

  // Pass 3: fall back to a remote-tracking ref. Same skip rules but
  // we accept the remote-ish refs now.
  for (const ref of refs) {
    if (ref.startsWith('tag: ') || ref === 'HEAD' || ref.startsWith('HEAD -> ')) {
      continue
    }
    if (isRemoteTrackingRef(ref, remoteNames) && ref.trim()) {
      return { name: ref.trim(), isHead: false, kind: 'remote' }
    }
  }

  return undefined
}
