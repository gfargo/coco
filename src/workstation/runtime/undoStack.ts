/**
 * Session-scoped undo stack for destructive workstation actions
 * (OSS-1606). Bounded and in-memory only — nothing here persists across
 * a `coco ui` restart, and popping it never touches pushed/remote
 * history.
 *
 * Only actions with a real git-level inverse are eligible: branch
 * delete (recreate at the recorded sha), stash drop (`git stash store`
 * the recorded hash), reset (reset back to the recorded HEAD using the
 * ORIGINAL reset's mode, not always `--hard` — see `restorePreviousHead`),
 * and tag delete (recreate at the recorded sha). PR/issue close and
 * anything that rewrites already-pushed history are deliberately never
 * pushed here — see the callers in `hooks/useWorkflowAction.ts`.
 *
 * `pullRequestTriage`'s close is intentionally excluded, not an
 * oversight: "undo" for a forge-side close would mean reopening via the
 * GitHub/GitLab API, which isn't a git-level inverse at all (no local
 * sha/hash to restore from) and would need its own auth/network path
 * distinct from everything else on this stack. Scoped out of OSS-1606;
 * a forge-reopen affordance is a separate feature if wanted.
 *
 * Each entry carries the repo-frame `depth` (#1384/#1607 convention) AND
 * the frame's `workdir` it was captured at. Depth alone isn't a stable
 * frame identity: popping out of a submodule and drilling into a
 * *different* sibling submodule lands back at the same depth with a
 * different `git` handle, so a depth-only guard would happily replay a
 * stale entry against the wrong repo. `workdir` disambiguates that case;
 * the consumer refuses the undo unless both match.
 *
 * `undo-drop-stash` (the per-view `u` shortcut on the stash surface,
 * #1607) and `undo-last-action` (`gu`, OSS-1606) both resolve their
 * entry from THIS SAME stack — there is exactly one source of truth for
 * "what got dropped/deleted/reset and how to undo it." Earlier revisions
 * of OSS-1606 kept a second, independent pointer (`lastDroppedStashRef`)
 * for `undo-drop-stash`; it never stayed in sync with pops made via
 * `gu`, so one path could re-apply an inverse the other had already
 * consumed. Removed in favor of this single stack.
 */
import { SimpleGit } from 'simple-git'
import { restoreDeletedBranch } from '../../git/branchActions'
import { restoreDeletedTag } from '../../git/tagActions'
import { restoreStash } from '../../git/stashActions'
import { restorePreviousHead, ResetMode } from '../../git/historyActions'

export const MAX_UNDO_STACK_SIZE = 20

export type UndoEntry =
  | { kind: 'delete-branch'; label: string; depth: number; workdir?: string; name: string; sha: string }
  | { kind: 'drop-stash'; label: string; depth: number; workdir?: string; hash: string; message: string }
  | { kind: 'reset-to-commit'; label: string; depth: number; workdir?: string; previousSha: string; mode: ResetMode }
  | { kind: 'delete-tag'; label: string; depth: number; workdir?: string; name: string; sha: string }

export type UndoActionResult = { ok: boolean; message: string }

/** Bounded push — the oldest entry drops once the stack exceeds `MAX_UNDO_STACK_SIZE`. */
export function pushUndoEntry(stack: UndoEntry[], entry: UndoEntry): UndoEntry[] {
  const next = [...stack, entry]
  return next.length > MAX_UNDO_STACK_SIZE ? next.slice(next.length - MAX_UNDO_STACK_SIZE) : next
}

/** Pop the most recent entry off the stack; a no-op tuple when empty. */
export function popUndoEntry(stack: UndoEntry[]): { entry: UndoEntry | undefined; stack: UndoEntry[] } {
  if (stack.length === 0) return { entry: undefined, stack }
  return { entry: stack[stack.length - 1], stack: stack.slice(0, -1) }
}

/**
 * Remove one specific entry from the stack by identity, wherever it
 * sits — not necessarily the top. `undo-drop-stash` resolves a
 * `drop-stash` entry that may not be the most recently pushed action
 * (e.g. a tag delete could have landed on top of it since), so it can't
 * use `popUndoEntry`'s "top of stack" assumption.
 */
export function removeUndoEntry(stack: UndoEntry[], entry: UndoEntry): UndoEntry[] {
  return stack.filter((candidate) => candidate !== entry)
}

/** Most recent entry of a given kind, respecting stack order (last pushed first); undefined if none. */
export function findMostRecentUndoEntry<K extends UndoEntry['kind']>(
  stack: UndoEntry[],
  kind: K,
): Extract<UndoEntry, { kind: K }> | undefined {
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    const candidate = stack[i]
    if (candidate.kind === kind) return candidate as Extract<UndoEntry, { kind: K }>
  }
  return undefined
}

/** Run the recorded git-level inverse for a single undo entry. */
export function performUndo(git: SimpleGit, entry: UndoEntry): Promise<UndoActionResult> {
  switch (entry.kind) {
    case 'delete-branch':
      return restoreDeletedBranch(git, entry.name, entry.sha)
    case 'drop-stash':
      return restoreStash(git, entry.hash, entry.message)
    case 'reset-to-commit':
      return restorePreviousHead(git, entry.previousSha, entry.mode)
    case 'delete-tag':
      return restoreDeletedTag(git, entry.name, entry.sha)
  }
}
