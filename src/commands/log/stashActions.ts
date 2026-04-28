import { SimpleGit } from 'simple-git'
import { BranchActionResult } from './branchActions'
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

  if (!trimmedMessage) {
    return Promise.resolve({
      ok: false,
      message: 'Stash cancelled: empty message.',
    })
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
