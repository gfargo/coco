import { SimpleGit } from 'simple-git'
import { BranchActionResult } from './branchActions'

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

async function isHeadCommit(git: SimpleGit, commitHash: string): Promise<boolean> {
  const head = await git.revparse(['HEAD'])
  const normalizedHead = head.trim()
  const normalizedCommit = commitHash.trim()

  return normalizedHead === normalizedCommit || normalizedHead.startsWith(normalizedCommit)
}

export async function amendHeadCommit(
  git: SimpleGit,
  selectedCommitHash: string | undefined
): Promise<BranchActionResult> {
  if (!selectedCommitHash || !(await isHeadCommit(git, selectedCommitHash))) {
    return {
      ok: false,
      message: 'Amend is limited to HEAD. Select the latest commit first.',
    }
  }

  return runAction(
    () => git.raw(['commit', '--amend', '--no-edit']),
    'Amended HEAD with staged changes'
  )
}

export async function rewordHeadCommit(
  git: SimpleGit,
  selectedCommitHash: string | undefined,
  message: string
): Promise<BranchActionResult> {
  const trimmedMessage = message.trim()

  if (!selectedCommitHash || !(await isHeadCommit(git, selectedCommitHash))) {
    return {
      ok: false,
      message: 'Reword is limited to HEAD. Select the latest commit first.',
    }
  }

  if (!trimmedMessage) {
    return {
      ok: false,
      message: 'Reword cancelled: empty message.',
    }
  }

  return runAction(
    () => git.raw(['commit', '--amend', '-m', trimmedMessage]),
    'Reworded HEAD commit'
  )
}

export const historyActionTestInternals = {
  isHeadCommit,
}
