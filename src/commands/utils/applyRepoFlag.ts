import * as path from 'node:path'
import { getRepo } from '../../lib/simple-git/getRepo'
import { BaseArgvOptions } from '../types'

/**
 * Apply the global `--repo <dir>` (alias `--cwd`) flag for any
 * command handler. Returns the bound simple-git instance.
 *
 * Behavior:
 *   - When `argv.repo` is set, resolves the path to absolute,
 *     `process.chdir`s up-front, and returns `getRepo(repoPath)`.
 *   - When omitted, returns `getRepo()` (defaults to cwd) — original
 *     behavior, no surprise for users on the `cd && coco ...` path.
 *
 * Why chdir up-front:
 *   Many config / discovery paths (loadConfig's findUp for
 *   `.coco.config.json`, commitlint config detection, etc.) read
 *   `process.cwd()` directly. If we only changed simple-git's
 *   baseDir without chdir-ing, those would resolve against the
 *   original cwd — leading to "coco is reading this repo but
 *   loading config from somewhere else" surprises.
 *
 * Returns the SimpleGit instance so callers can use it directly:
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
  if (!argv.repo) {
    return getRepo()
  }
  const repoPath = path.resolve(argv.repo)
  process.chdir(repoPath)
  return getRepo(repoPath)
}
