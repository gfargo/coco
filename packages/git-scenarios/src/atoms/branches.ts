import type { Step } from './types'

/**
 * Create a new branch from the current HEAD and check it out (`git
 * checkout -b <name>`). Equivalent to `git switch -c <name>` on
 * modern git. The new branch becomes the active branch; the previous
 * branch is unchanged.
 *
 * For "branch off a specific ref" (rather than current HEAD), pass
 * `from`:
 *
 *   switchToBranch('feat/x', { from: 'main' })   // git checkout -b feat/x main
 *
 * For "switch to an existing branch" (no creation), use
 * `checkoutBranch` instead.
 */
export function switchToBranch(name: string, options: { from?: string } = {}): Step {
  return async (repo) => {
    if (options.from) {
      await repo.git.checkoutBranch(name, options.from)
    } else {
      await repo.git.checkoutLocalBranch(name)
    }
  }
}

/**
 * Check out an existing branch or ref (`git checkout <name>`). Does
 * NOT create — fails if the branch doesn't exist. Use when a scenario
 * needs to bounce between branches that have already been created.
 */
export function checkoutBranch(name: string): Step {
  return async (repo) => {
    await repo.git.checkout(name)
  }
}

/**
 * Create a branch without checking it out (`git branch <name>` or
 * `git branch <name> <startPoint>`). Useful when a scenario needs a
 * branch to exist for ref tooling — `branches` view, `gP` triage —
 * but doesn't want to disturb the working tree.
 */
export function createBranch(name: string, options: { from?: string } = {}): Step {
  return async (repo) => {
    if (options.from) {
      await repo.git.branch([name, options.from])
    } else {
      await repo.git.branch([name])
    }
  }
}

/**
 * Delete a local branch (`git branch -d <name>`). Pass `force: true`
 * to use `-D` instead (drops branches with unmerged commits without a
 * safety check). The active branch can't be deleted — check out
 * another branch first.
 */
export function deleteBranch(name: string, options: { force?: boolean } = {}): Step {
  return async (repo) => {
    await repo.git.deleteLocalBranch(name, options.force)
  }
}
