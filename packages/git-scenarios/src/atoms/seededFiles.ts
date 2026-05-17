import {
  writeSeededFiles as writeSeededFilesImperative,
  type SeededFileSpec,
} from '../scenarios/shared/seededFiles'
import type { Step } from './types'

export type { SeededFileSpec } from '../scenarios/shared/seededFiles'

/**
 * Write a batch of deterministically-generated files into the
 * working directory. Each spec carries a target token count; the
 * underlying generator produces realistic-looking content of that
 * size, seeded so re-runs are byte-identical.
 *
 *   seededFiles({
 *     files: [
 *       { path: 'src/index.ts', tokens: 60 },
 *       { path: 'src/widget.ts', tokens: 120 },
 *     ],
 *     seed: 0xfeedc0de,
 *   })
 *
 * Each file's content is derived from `(path, tokens, seed)`, so
 * passing the same `seed` across two `seededFiles` calls with the
 * same path produces identical content — meaning the second commit
 * would be a no-op. When a scenario re-touches the same file across
 * multiple commits, vary the seed (`seed + 1`, `seed + 2`) to get
 * distinct content per commit.
 *
 * Does NOT stage — pair with `addCommit({ message })` or `stageFiles`
 * to land the files in a commit.
 */
export function seededFiles(opts: { files: SeededFileSpec[]; seed: number }): Step {
  return async (repo) => {
    await writeSeededFilesImperative(repo, opts.files, opts.seed)
  }
}
