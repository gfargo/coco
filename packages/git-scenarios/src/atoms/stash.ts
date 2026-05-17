import type { Step } from './types'

/**
 * Push the current worktree state onto the stash (`git stash push`).
 * Requires changes to actually stash — git stash is a no-op if the
 * worktree is clean. The standard pattern is to write some files
 * first, optionally stage, then stash:
 *
 *   chain(
 *     writeFiles({ 'src/foo.ts': '…' }),
 *     stashChanges({ message: 'wip: foo' }),
 *   )
 *
 * Options:
 *   - `message` — annotation that surfaces in `git stash list`. The
 *     stash view's "drop / apply by message" workflows rely on these
 *     reading distinctly across multiple stashes.
 *   - `includeUntracked` — pass `-u` so brand-new files (not yet
 *     `git add`-ed) also enter the stash. Without this, `git stash`
 *     ignores untracked files and leaves them in the worktree.
 *   - `keepIndex` — pass `--keep-index` so already-staged changes
 *     stay staged after the stash. Useful for "stash the worktree
 *     diff, leave the index alone" patterns.
 */
export function stashChanges(
  options: { message?: string; includeUntracked?: boolean; keepIndex?: boolean } = {},
): Step {
  return async (repo) => {
    const args = ['push']
    if (options.message) {
      args.push('-m', options.message)
    }
    if (options.includeUntracked) {
      args.push('-u')
    }
    if (options.keepIndex) {
      args.push('--keep-index')
    }
    await repo.git.stash(args)
  }
}

/**
 * Apply a stash without dropping it (`git stash apply`). Defaults to
 * the top of the stack (`stash@{0}`); pass `ref` to target a specific
 * one.
 *
 * Conflicts during apply leave the worktree in a conflicted state
 * (same shape as a merge conflict), which downstream tools' conflicts
 * view exercises — useful for testing that flow.
 */
export function applyStash(options: { ref?: string } = {}): Step {
  return async (repo) => {
    const args = ['apply']
    if (options.ref) {
      args.push(options.ref)
    }
    await repo.git.stash(args)
  }
}

/**
 * Apply the top stash and drop it (`git stash pop`). Equivalent to
 * `applyStash` followed by `dropStash`, but atomic — if the apply
 * fails (conflicts), the stash stays.
 */
export function popStash(options: { ref?: string } = {}): Step {
  return async (repo) => {
    const args = ['pop']
    if (options.ref) {
      args.push(options.ref)
    }
    await repo.git.stash(args)
  }
}

/**
 * Drop a stash without applying it (`git stash drop`). Defaults to
 * the top of the stack.
 */
export function dropStash(options: { ref?: string } = {}): Step {
  return async (repo) => {
    const args = ['drop']
    if (options.ref) {
      args.push(options.ref)
    }
    await repo.git.stash(args)
  }
}
