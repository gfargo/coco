import * as path from 'node:path'
import { getRepo } from '../../lib/simple-git/getRepo'
import { BaseArgvOptions } from '../types'

/**
 * Apply the global `--repo <dir>` (alias `--cwd`) flag — the part
 * that doesn't need git. Performs the chdir if the flag is set and
 * returns the resolved absolute path (or `process.cwd()` when
 * omitted).
 *
 * Use this from non-git commands (cache, doctor, init) where the
 * full `applyRepoFlag` would allocate a SimpleGit instance the
 * handler never touches.
 *
 * Why chdir up-front:
 *   Many config / discovery paths (loadConfig's project-config lookup,
 *   which resolves `.coco.json` against the git repo root rather than
 *   cwd — #1616 — commitlint config detection, etc.) read
 *   `process.cwd()` directly. If we don't chdir, those would
 *   resolve against the original cwd — leading to "coco is
 *   reading config from somewhere else" surprises.
 */
export function applyRepoCwd(argv: Pick<BaseArgvOptions, 'repo'>): string {
  if (!argv.repo) {
    return process.cwd()
  }
  const repoPath = path.resolve(argv.repo)
  process.chdir(repoPath)
  return repoPath
}

/**
 * Apply the global `--repo <dir>` flag for git-using commands.
 * Performs the chdir AND returns a SimpleGit instance bound to the
 * targeted path.
 *
 * Composes `applyRepoCwd` so the chdir semantics are identical
 * across git / non-git handlers.
 *
 * ```ts
 * export const handler: CommandHandler<CommitArgv> = async (argv) => {
 *   const git = applyRepoFlag(argv)
 *   const config = loadConfig(argv)
 *   // ... rest of handler uses git + config
 * }
 * ```
 */
export function applyRepoFlag(argv: Pick<BaseArgvOptions, 'repo'>): ReturnType<typeof getRepo> {
  const repoPath = applyRepoCwd(argv)
  return argv.repo ? getRepo(repoPath) : getRepo()
}
