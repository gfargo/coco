import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { SimpleGit } from 'simple-git'
import { BranchActionResult, deleteBranch } from './branchActions'
import { BranchRef } from './branchData'
import { WorktreeEntry } from './worktreeData'
import { retryOnIndexLock } from './actionErrors'

async function runAction(action: () => Promise<unknown>, successMessage: string): Promise<BranchActionResult> {
  try {
    await retryOnIndexLock(action)

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

/**
 * Where a new worktree goes when the user typed only a branch: next to the
 * current one, named `<dir>-<branch>` with slashes flattened
 * (`/work/coco` + `feat/x` -> `/work/coco-feat-x`).
 */
export function defaultWorktreePath(currentPath: string, branch: string): string {
  const slug = branch.replace(/[\\/]+/g, '-').replace(/^-+|-+$/g, '')
  return join(dirname(currentPath), `${basename(currentPath)}-${slug}`)
}

/**
 * Parse the add-worktree prompt: `<branch> [path]`. The first word is the
 * branch; anything after it is the path (relative paths resolve against the
 * current worktree). Returns undefined for an empty entry.
 */
export function parseAddWorktreeInput(
  input: string,
  currentPath: string
): { branch: string; path: string } | undefined {
  const trimmed = input.trim()
  if (!trimmed) return undefined
  const [branch, ...rest] = trimmed.split(/\s+/)
  const given = rest.join(' ')
  return {
    branch,
    path: given
      ? (isAbsolute(given) ? given : resolve(currentPath, given))
      : defaultWorktreePath(currentPath, branch),
  }
}

/**
 * `git worktree add` for a branch. An existing local branch is checked out
 * in the new worktree; otherwise the branch is created from the current
 * HEAD. Git refuses a branch that is already checked out elsewhere, and that
 * message is passed through.
 */
export async function addWorktree(
  git: SimpleGit,
  branch: string,
  path: string
): Promise<BranchActionResult> {
  const exists = await git
    .raw(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])
    .then(() => true, () => false)
  return runAction(
    () => git.raw(exists
      ? ['worktree', 'add', path, branch]
      : ['worktree', 'add', '-b', branch, path]),
    exists
      ? `Added worktree ${path} on ${branch}`
      : `Added worktree ${path} on new branch ${branch}`
  )
}
