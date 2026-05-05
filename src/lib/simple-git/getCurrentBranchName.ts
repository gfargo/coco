import { SimpleGit } from 'simple-git'

export type GetCurrentBranchName = {
  git: SimpleGit
}

/**
 * Retrieve the name of the current branch.
 *
 * The first-choice path uses `git rev-parse --abbrev-ref HEAD`, which
 * returns the active branch on a normal repo. On an initial-commit
 * repo (fresh `git init` with no commits yet) HEAD does not resolve
 * and rev-parse fails fatally — but `git symbolic-ref --short HEAD`
 * still reports the configured initial branch name, so we fall
 * through to that. Final fallback is an empty string for genuinely
 * detached / corrupt states; every caller treats that as "no branch
 * context", which is the right semantics for a no-HEAD repo.
 *
 * Without this resilience, every command that depends on the branch
 * name (e.g. the post-summary step in `coco commit`) would crash
 * with `fatal: ambiguous argument 'HEAD'` after the entire diff
 * pipeline already ran (#844).
 */
export async function getCurrentBranchName({ git }: GetCurrentBranchName): Promise<string> {
  try {
    return await git.revparse(['--abbrev-ref', 'HEAD'])
  } catch {
    try {
      const ref = await git.raw(['symbolic-ref', '--short', 'HEAD'])
      return ref.trim()
    } catch {
      return ''
    }
  }
}
