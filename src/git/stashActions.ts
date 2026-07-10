import { SimpleGit } from 'simple-git'
import { BranchActionResult } from './branchActions'
import { checkoutOrDeleteFromRef } from './historyActions'
import { StashEntry } from './stashData'

async function runAction(action: () => Promise<unknown>, successMessage: string): Promise<BranchActionResult> {
  try {
    await action()

    return {
      ok: true,
      message: successMessage,
    }
  } catch (error) {
    return {
      ok: false,
      message: (error as Error).message,
    }
  }
}

export type CreateStashOptions = {
  /** `--keep-index`: stash everything but leave the index intact. */
  keepIndex?: boolean
  /** `--staged`: stash only the staged (index) changes. */
  stagedOnly?: boolean
  /**
   * `-- <paths>`: stash only the matching pathspecs (partial stash).
   * Explicit list — NOT a whitespace-tokenized string (#1397): a
   * single path containing a space (`my file.ts`) must reach git as
   * one pathspec, or a fragment can match a real directory and stash
   * far more than asked. Callers that accept typed input own the
   * tokenization decision at their boundary.
   */
  paths?: string[]
}

export function createStash(
  git: SimpleGit,
  message: string,
  options: CreateStashOptions = {}
): Promise<BranchActionResult> {
  const trimmedMessage = message.trim()
  const args = ['stash', 'push']

  // `--staged` is index-only, so untracked / `--keep-index` don't apply;
  // every other mode includes untracked (`-u`). `--keep-index` leaves the
  // index populated for an immediate follow-up commit.
  if (options.stagedOnly) {
    args.push('--staged')
  } else {
    args.push('-u')
    if (options.keepIndex) args.push('--keep-index')
  }

  if (trimmedMessage) args.push('-m', trimmedMessage)

  const paths = (options.paths ?? []).map((path) => path.trim()).filter(Boolean)
  if (paths.length > 0) args.push('--', ...paths)

  const what = options.stagedOnly
    ? 'staged changes'
    : paths.length > 0
      ? `“${paths.join(' ')}”`
      : options.keepIndex
        ? 'changes (index kept)'
        : ''
  const success = trimmedMessage
    ? `Created stash: ${trimmedMessage}`
    : what
      ? `Stashed ${what}`
      : 'Created WIP stash'

  return runAction(() => git.raw(args), success)
}

/**
 * Apply a stash while restoring the original staged/unstaged split via
 * `--index`. Faithfully reinstates what was staged at stash time; git
 * errors (surfaced to the user) if the index can no longer be replayed,
 * in which case plain `applyStash` is the fallback.
 */
export function applyStashKeepIndex(git: SimpleGit, stash: StashEntry): Promise<BranchActionResult> {
  return runAction(
    () => git.raw(['stash', 'apply', '--index', stash.ref]),
    `Applied ${stash.ref} (index restored)`
  )
}

/**
 * Create a new branch from a stash's base commit, apply the stash onto
 * it, and drop the stash on success — `git stash branch`. The canonical
 * recovery when a stash no longer applies cleanly onto the current
 * branch (the branch starts at the exact commit the stash was made on).
 */
export function stashBranch(git: SimpleGit, stash: StashEntry, branchName: string): Promise<BranchActionResult> {
  const trimmed = branchName.trim()
  if (!trimmed) {
    return Promise.resolve({ ok: false, message: 'Cancelled: empty branch name.' })
  }
  return runAction(
    () => git.raw(['stash', 'branch', trimmed, stash.ref]),
    `Created branch ${trimmed} from ${stash.ref}`
  )
}

/**
 * Rename a stash. Git has no native rename, so: drop the original entry,
 * then re-store the SAME commit under the new message.
 *
 * Order matters — and it's the OPPOSITE of what you'd guess. `git stash
 * store` SILENTLY NO-OPS when the commit is already referenced in the
 * stash reflog (verified empirically), so storing first does nothing and
 * a follow-up drop removes the wrong entry. Dropping first removes the
 * reflog reference (the commit object survives), so the subsequent
 * `store` actually re-adds it — landing at `stash@{0}` with the new
 * message. The commit is captured by hash beforehand, so the drop→store
 * window can't lose it.
 */
export function renameStash(git: SimpleGit, stash: StashEntry, newMessage: string): Promise<BranchActionResult> {
  const trimmed = newMessage.trim()
  if (!trimmed) {
    return Promise.resolve({ ok: false, message: 'Rename cancelled: empty message.' })
  }
  if (!stash.hash) {
    return Promise.resolve({ ok: false, message: 'Cannot rename: stash commit hash unavailable.' })
  }

  // Preserve git's `On <branch>: <subject>` convention so the renamed
  // stash keeps its origin-branch context. The list + inspector parse the
  // branch out of that prefix (`parseStashSubject`); a bare message would
  // render `on <unknown>`. Falls back to the bare message when the branch
  // is unknown so we never store a misleading `On <unknown>:`.
  const branch = stash.branch && stash.branch !== '<unknown>' ? stash.branch : ''
  const storedMessage = branch ? `On ${branch}: ${trimmed}` : trimmed

  return runAction(async () => {
    await git.raw(['stash', 'drop', stash.ref])
    await git.raw(['stash', 'store', '-m', storedMessage, stash.hash])
  }, `Renamed ${stash.ref} → ${trimmed}`)
}

/**
 * Re-store a previously dropped stash by its commit hash — the undo for
 * a `dropStash`. The dropped stash's commit stays in the object database
 * until git gc, so storing it back recreates the entry (at `stash@{0}`).
 */
export function restoreStash(git: SimpleGit, hash: string, message: string): Promise<BranchActionResult> {
  if (!hash) {
    return Promise.resolve({ ok: false, message: 'Nothing to restore.' })
  }
  return runAction(
    () => git.raw(['stash', 'store', '-m', message || 'restored stash', hash]),
    'Restored dropped stash'
  )
}

export function applyStash(git: SimpleGit, stash: StashEntry): Promise<BranchActionResult> {
  return runAction(
    () => git.raw(['stash', 'apply', stash.ref]),
    `Applied ${stash.ref}`
  )
}

export function popStash(git: SimpleGit, stash: StashEntry): Promise<BranchActionResult> {
  return runAction(
    () => git.raw(['stash', 'pop', stash.ref]),
    `Popped ${stash.ref}`
  )
}

export function dropStash(git: SimpleGit, stash: StashEntry): Promise<BranchActionResult> {
  return runAction(
    () => git.raw(['stash', 'drop', stash.ref]),
    `Dropped ${stash.ref}`
  )
}

/** Parse the `N` out of a `stash@{N}` ref; NaN for anything else. */
function stashRefIndex(ref: string): number {
  const match = ref.match(/^stash@\{(\d+)\}$/)
  return match ? Number(match[1]) : NaN
}

/**
 * Drop several stashes (#1361 batch delete). MUST drop in descending
 * `stash@{N}` order: dropping `stash@{0}` renumbers every later entry
 * down by one, so an ascending or unordered loop targets the wrong
 * stash from the second drop onward. Continues past a per-stash
 * failure (mirrors `deleteBranches`) and reports a summary; per-stash
 * failure messages ride in `details`.
 */
export async function dropStashes(
  git: SimpleGit,
  stashes: StashEntry[]
): Promise<BranchActionResult> {
  if (stashes.length === 0) {
    return { ok: false, message: 'No stashes selected.' }
  }
  if (stashes.length === 1) {
    return dropStash(git, stashes[0])
  }

  const ordered = [...stashes].sort((a, b) => stashRefIndex(b.ref) - stashRefIndex(a.ref))
  const dropped: string[] = []
  const failures: string[] = []
  for (const stash of ordered) {
    const result = await dropStash(git, stash)
    if (result.ok) {
      dropped.push(stash.ref)
    } else {
      failures.push(`${stash.ref}: ${result.message}`)
    }
  }

  if (failures.length === 0) {
    return { ok: true, message: `Dropped ${dropped.length} stashes: ${dropped.join(', ')}` }
  }
  return {
    ok: false,
    message: `Dropped ${dropped.length} of ${stashes.length} stashes — ${failures.length} refused`,
    details: failures,
  }
}

/**
 * Materialize a single file's contents from a stash into the working
 * tree, leaving the rest of the stash untouched. Equivalent to
 * `git checkout <stashRef> -- <path>` for additions/modifications. When
 * the path doesn't exist at <stashRef> — i.e. the stash recorded a
 * deletion — mirror that deletion in the worktree.
 *
 * Important: this overwrites the file in the working tree. The caller
 * is responsible for confirming with the user when the working tree
 * already has uncommitted changes to that path.
 */
export function checkoutFileFromStash(
  git: SimpleGit,
  stashRef: string,
  path: string
): Promise<BranchActionResult> {
  return checkoutOrDeleteFromRef(git, stashRef, path, stashRef)
}
