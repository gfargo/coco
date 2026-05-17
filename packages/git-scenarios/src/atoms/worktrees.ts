import type { Step } from './types'

/**
 * Add a **linked worktree** (`git worktree add`). Linked worktrees
 * let one repository have multiple working directories, each on its
 * own branch. Tools that surface worktree state (the `worktrees`
 * view in the workstation, IDE multi-checkout panels, etc.) need
 * scenarios that exercise this without the test runner crossing
 * filesystem boundaries.
 *
 *   addWorktree('/tmp/feat-x', { branch: 'feat/x' })
 *     // git worktree add -b feat/x /tmp/feat-x
 *
 *   addWorktree('/tmp/release-branch', { checkout: 'release/v1' })
 *     // git worktree add /tmp/release-branch release/v1 (existing branch)
 *
 *   addWorktree('/tmp/detached', { checkout: 'HEAD~5', detach: true })
 *     // git worktree add --detach /tmp/detached HEAD~5
 *
 * `path` is the filesystem path the new worktree mounts at — absolute
 * or relative to the primary worktree. Best practice in scenarios is
 * to keep it under the primary worktree's parent so cleanup is one
 * step:
 *
 *   const repo = await createTempGitRepo()
 *   await addWorktree(join(repo.path, '..', 'sibling'))(repo)
 *
 * Options:
 *   - `branch` — create a NEW branch at `path` (uses `-b`). Cannot
 *     combine with `checkout`.
 *   - `checkout` — check out an EXISTING ref at `path`. Cannot
 *     combine with `branch`.
 *   - `detach` — detach HEAD in the new worktree (uses `--detach`).
 *   - `from` — start point for the new branch (passes after `branch`).
 *     Only relevant when `branch` is set.
 */
export function addWorktree(
  path: string,
  options: {
    branch?: string
    checkout?: string
    detach?: boolean
    from?: string
  } = {},
): Step {
  if (options.branch && options.checkout) {
    throw new Error(
      'addWorktree: cannot pass both `branch` (new branch) and `checkout` (existing ref).',
    )
  }
  return async (repo) => {
    const args = ['worktree', 'add']
    if (options.detach) {
      args.push('--detach')
    }
    if (options.branch) {
      args.push('-b', options.branch, path)
      if (options.from) {
        args.push(options.from)
      }
    } else if (options.checkout) {
      args.push(path, options.checkout)
    } else {
      args.push(path)
    }
    await repo.git.raw(args)
  }
}

/**
 * Remove a linked worktree (`git worktree remove <path>`). Refuses
 * to remove a worktree with uncommitted changes unless `force: true`.
 */
export function removeWorktree(path: string, options: { force?: boolean } = {}): Step {
  return async (repo) => {
    const args = ['worktree', 'remove']
    if (options.force) {
      args.push('--force')
    }
    args.push(path)
    await repo.git.raw(args)
  }
}
