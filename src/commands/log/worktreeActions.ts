import { SimpleGit } from 'simple-git'
import { BranchActionResult, deleteBranch } from './branchActions'
import { BranchRef } from './branchData'
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

/**
 * Remove a worktree AND delete the branch it was tracking (#838). The
 * canonical "I'm done with this side branch" wind-down: removes the
 * worktree directory, then runs `git branch -d` on the previously
 * checked-out branch.
 *
 * Both pre-flight guards inherit from the underlying helpers:
 *   - removeWorktree refuses the current worktree and dirty worktrees
 *   - deleteBranch refuses the current branch and uses `-d` (safe
 *     delete, refuses unmerged commits)
 *
 * Aborts cleanly at any failure point and surfaces a message that
 * names which step broke. When the worktree had no branch (detached
 * HEAD) the branch step is silently skipped — there's nothing to
 * delete and the worktree removal alone counts as success.
 */
export async function removeWorktreeAndBranch(
  git: SimpleGit,
  worktree: WorktreeEntry,
  branchRefs: BranchRef[]
): Promise<BranchActionResult> {
  const removeResult = await removeWorktree(git, worktree)
  if (!removeResult.ok) {
    return removeResult
  }

  const branchName = worktree.branch
  if (!branchName) {
    return {
      ok: true,
      message: `Removed worktree ${worktree.path} (no branch to delete)`,
    }
  }

  // Look up the local BranchRef for the branch this worktree was on.
  // deleteBranch needs the full ref (not just the name) so its
  // current-branch and local-only guards apply correctly.
  const branch = branchRefs.find((entry) =>
    entry.type === 'local' && entry.shortName === branchName
  )
  if (!branch) {
    return {
      ok: true,
      message: `Removed worktree ${worktree.path} (branch ${branchName} not found in local branches)`,
    }
  }

  const deleteResult = await deleteBranch(git, branch)
  if (!deleteResult.ok) {
    return {
      ok: false,
      message: `Removed worktree ${worktree.path}, but branch delete failed: ${deleteResult.message}`,
    }
  }

  return {
    ok: true,
    message: `Removed worktree ${worktree.path} and deleted branch ${branchName}`,
  }
}
