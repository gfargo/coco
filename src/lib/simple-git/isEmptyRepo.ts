import { SimpleGit } from 'simple-git'

/**
 * Detect whether the repository has any commits yet.
 *
 * A "fresh" repo (one created by `git init` with no commits) has an
 * **unborn HEAD** — the `main` (or configured-default) branch ref
 * exists symbolically but doesn't point at any object. Any plumbing
 * command that tries to resolve HEAD (`git log`, `git show`, `git
 * rev-list`) fails fatally on such a repo with `fatal: your current
 * branch '<X>' does not have any commits yet`.
 *
 * Without an explicit pre-check, callers crash with that raw error
 * (see {@link ../utils/commandExecutor} — the generic-error path
 * just prints whatever was thrown). This helper lets a command
 * short-circuit to a friendly "no commits yet" message instead.
 *
 * Implementation uses `git rev-parse --verify HEAD` because it's the
 * cheapest "does HEAD resolve?" probe — no log walk, no working-tree
 * scan. Returns `true` when rev-parse rejects (unborn HEAD) and
 * `false` when it succeeds.
 *
 * @returns `true` when HEAD is unborn (no commits); `false` otherwise.
 */
export async function isEmptyRepo(git: SimpleGit): Promise<boolean> {
  try {
    await git.revparse(['--verify', 'HEAD'])
    return false
  } catch {
    return true
  }
}
