import type { FileMap, Step } from './types'
import { writeFiles } from './writeFiles'

/**
 * The workhorse atom: write a set of files, stage everything in the
 * working directory, commit with the given message. Used by ~every
 * scenario, often multiple times.
 *
 * `files` is optional — when omitted, this atom is equivalent to
 * `chain(stageFiles(), commit(message))`. Useful for committing
 * content that was written by a previous atom (e.g. `seededFiles`):
 *
 *   chain(
 *     seededFiles({ files: [{ path: 'src/index.ts', tokens: 80 }], seed: 0xfeed }),
 *     addCommit({ message: 'feat: add index' }),
 *   )
 *
 * For the common write-and-commit case, pass `files` inline:
 *
 *   addCommit({
 *     message: 'chore: initial scaffold',
 *     files: {
 *       'README.md': '# repo\n',
 *       'package.json': JSON.stringify({ name: 'repo' }, null, 2),
 *     },
 *   })
 *
 * Important: this calls the repo's `commitAll` helper (`git add . &&
 * git commit -m`), so anything already in the worktree at commit
 * time also enters this commit. If you need partial staging, compose
 * the primitives directly:
 *
 *   chain(
 *     writeFiles({ 'a.ts': '…', 'b.ts': '…' }),
 *     stageFiles('a.ts'),
 *     commit('feat: add a'),
 *   )
 *
 * Pass `date` (any ISO-8601 string git accepts as `GIT_AUTHOR_DATE`)
 * to pin both author and committer dates — both are pinned so
 * `git log --date=short` and downstream bucketing reflect the same
 * date. The `daysAgo(n)` helper produces a deterministic noon-UTC
 * ISO string N days before now for relative date stamping:
 *
 *   addCommit({ message: 'feat: old commit', date: daysAgo(30) })
 */
export function addCommit(opts: {
  message: string
  files?: FileMap
  date?: string
}): Step {
  return async (repo) => {
    if (opts.files && Object.keys(opts.files).length > 0) {
      await writeFiles(opts.files)(repo)
    }
    if (opts.date) {
      await repo.git.add('.')
      await repo.git
        .env({ GIT_AUTHOR_DATE: opts.date, GIT_COMMITTER_DATE: opts.date })
        .raw(['commit', '-m', opts.message])
    } else {
      await repo.commitAll(opts.message)
    }
  }
}
