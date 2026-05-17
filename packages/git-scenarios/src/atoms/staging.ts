import type { Step } from './types'

/**
 * Stage paths into the index. With no arguments, stages everything
 * in the working directory (`git add .`). With one or more paths,
 * stages only those.
 *
 * Pathspec semantics follow git's: a directory stages everything
 * under it; glob patterns are passed through to git. See `git
 * add --help` for the full syntax.
 *
 *   stageFiles()                   // git add .
 *   stageFiles('src/foo.ts')       // git add src/foo.ts
 *   stageFiles('src/', 'tests/')   // git add src/ tests/
 */
export function stageFiles(...paths: string[]): Step {
  return async (repo) => {
    if (paths.length === 0) {
      await repo.git.add('.')
      return
    }
    for (const path of paths) {
      await repo.git.add(path)
    }
  }
}

/**
 * Commit the currently-staged set with the given message. Does NOT
 * touch the working directory or stage anything — pair with
 * `stageFiles` (or use `addCommit` for the common write-stage-commit
 * sequence).
 *
 * The commit runs through the underlying `simple-git` instance which
 * was configured at repo init with `commit.gpgsign=false` and a
 * deterministic user identity, so commits are byte-stable across
 * runs.
 *
 * Pass `date` to pin author + committer dates (see `addCommit`).
 */
export function commit(message: string, options: { date?: string } = {}): Step {
  return async (repo) => {
    if (options.date) {
      await repo.git
        .env({ GIT_AUTHOR_DATE: options.date, GIT_COMMITTER_DATE: options.date })
        .raw(['commit', '-m', message])
    } else {
      await repo.git.commit(message)
    }
  }
}
