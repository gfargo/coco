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
  /** `-- <paths>`: stash only the matching paths (partial stash). */
  pathspec?: string
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

  const paths = options.pathspec?.trim()
  if (paths) args.push('--', ...paths.split(/\s+/))

  const what = options.stagedOnly
    ? 'staged changes'
    : paths
      ? `“${paths}”`
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

  return runAction(async () => {
    await git.raw(['stash', 'drop', stash.ref])
    await git.raw(['stash', 'store', '-m', trimmed, stash.hash])
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
