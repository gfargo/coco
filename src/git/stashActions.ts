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

export function createStash(git: SimpleGit, message: string): Promise<BranchActionResult> {
  const trimmedMessage = message.trim()

  // Empty message → a quick WIP stash. Naming is optional: git generates
  // its own `WIP on <branch>: <sha> <subject>` message, same as a bare
  // `git stash`. Both paths pass `-u` so untracked files come along.
  if (!trimmedMessage) {
    return runAction(
      () => git.raw(['stash', 'push', '-u']),
      'Created WIP stash'
    )
  }

  return runAction(
    () => git.raw(['stash', 'push', '-u', '-m', trimmedMessage]),
    `Created stash: ${trimmedMessage}`
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
