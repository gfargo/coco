import type { Step } from './types'

/**
 * Create a tag. With no `message`, produces a **lightweight** tag (a
 * named pointer to a commit). With a `message`, produces an
 * **annotated** tag (a real tag object that stores the message,
 * tagger, date — what `git describe` cares about).
 *
 *   createTag('v1.0.0')                            // lightweight, points at HEAD
 *   createTag('v1.0.0', { message: 'first release' })  // annotated
 *   createTag('v0.9.0', { sha: 'abc1234' })        // lightweight, on a specific commit
 *
 * `sha` can be any ref git understands (`HEAD~3`, `feat/x`, full sha,
 * short sha). Defaults to current HEAD.
 */
export function createTag(
  name: string,
  options: { message?: string; sha?: string } = {},
): Step {
  return async (repo) => {
    const args = ['tag']
    if (options.message) {
      args.push('-a', name, '-m', options.message)
    } else {
      args.push(name)
    }
    if (options.sha) {
      args.push(options.sha)
    }
    await repo.git.raw(args)
  }
}

/**
 * Delete a tag (`git tag -d <name>`). Useful when a scenario needs to
 * test "tag missing" states or the user-visible behavior of
 * tag-deletion workflows.
 */
export function deleteTag(name: string): Step {
  return async (repo) => {
    await repo.git.raw(['tag', '-d', name])
  }
}
