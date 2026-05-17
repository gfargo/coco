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
