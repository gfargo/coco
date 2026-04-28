import { SimpleGit } from 'simple-git'
import { BranchActionResult } from './branchActions'
import { WorktreeEntry } from './worktreeData'

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

export function createWorktree(
  git: SimpleGit,
  path: string,
  ref: string
): Promise<BranchActionResult> {
  const trimmedPath = path.trim()

  if (!trimmedPath) {
    return Promise.resolve({
      ok: false,
      message: 'Worktree cancelled: empty path.',
    })
  }

  return runAction(
    () => git.raw(['worktree', 'add', trimmedPath, ref]),
    `Created worktree ${trimmedPath} from ${ref}`
  )
}

export function createBranchWorktree(
  git: SimpleGit,
  path: string,
  branchName: string,
  startPoint: string
): Promise<BranchActionResult> {
  const trimmedPath = path.trim()
  const trimmedBranch = branchName.trim()

  if (!trimmedPath || !trimmedBranch) {
    return Promise.resolve({
      ok: false,
      message: 'Worktree cancelled: empty path or branch name.',
    })
  }

  return runAction(
    () => git.raw(['worktree', 'add', '-b', trimmedBranch, trimmedPath, startPoint]),
    `Created worktree ${trimmedPath} on ${trimmedBranch}`
  )
}

export function removeWorktree(git: SimpleGit, worktree: WorktreeEntry): Promise<BranchActionResult> {
  if (worktree.current) {
    return Promise.resolve({
      ok: false,
      message: 'Cannot remove the current worktree.',
    })
  }

  if (worktree.dirty) {
    return Promise.resolve({
      ok: false,
      message: `Cannot remove dirty worktree ${worktree.path}. Clean or stash it first.`,
    })
  }

  return runAction(
    () => git.raw(['worktree', 'remove', worktree.path]),
    `Removed worktree ${worktree.path}`
  )
}

export function worktreePathAction(worktree: WorktreeEntry): BranchActionResult {
  return {
    ok: true,
    message: `Worktree path: ${worktree.path}`,
  }
}
