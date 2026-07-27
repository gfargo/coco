/**
 * Session-scoped undo stack for destructive workstation actions
 * (OSS-1606). Bounded and in-memory only — nothing here persists across
 * a `coco ui` restart, and popping it never touches pushed/remote
 * history.
 *
 * Only actions with a real git-level inverse are eligible: branch
 * delete (recreate at the recorded sha), stash drop (`git stash store`
 * the recorded hash), reset (`reset --hard` back to the recorded HEAD),
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
 * Each entry carries the repo-frame `depth` (#1384/#1607 convention) it
 * was captured at, mirroring `lastDroppedStashRef` in
 * `useWorkflowAction.ts` — an entry captured in a parent repo frame must
 * never be applied against a submodule's `git` handle (or vice versa),
 * so the consumer refuses rather than pop across a frame boundary.
 */
import { SimpleGit } from 'simple-git'
import { restoreDeletedBranch } from '../../git/branchActions'
import { restoreDeletedTag } from '../../git/tagActions'
import { restoreStash } from '../../git/stashActions'
import { restorePreviousHead } from '../../git/historyActions'

export const MAX_UNDO_STACK_SIZE = 20

export type UndoEntry =
  | { kind: 'delete-branch'; label: string; depth: number; name: string; sha: string }
  | { kind: 'drop-stash'; label: string; depth: number; hash: string; message: string }
  | { kind: 'reset-to-commit'; label: string; depth: number; previousSha: string }
  | { kind: 'delete-tag'; label: string; depth: number; name: string; sha: string }

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

/** Run the recorded git-level inverse for a single undo entry. */
export function performUndo(git: SimpleGit, entry: UndoEntry): Promise<UndoActionResult> {
  switch (entry.kind) {
    case 'delete-branch':
      return restoreDeletedBranch(git, entry.name, entry.sha)
    case 'drop-stash':
      return restoreStash(git, entry.hash, entry.message)
    case 'reset-to-commit':
      return restorePreviousHead(git, entry.previousSha)
    case 'delete-tag':
      return restoreDeletedTag(git, entry.name, entry.sha)
  }
}
