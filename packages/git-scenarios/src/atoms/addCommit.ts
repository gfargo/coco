import { chain } from './chain'
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
 */
export function addCommit(opts: { message: string; files?: FileMap }): Step {
  const steps: Step[] = []
  if (opts.files && Object.keys(opts.files).length > 0) {
    steps.push(writeFiles(opts.files))
  }
  steps.push(async (repo) => {
    await repo.commitAll(opts.message)
  })
  return chain(...steps)
}
