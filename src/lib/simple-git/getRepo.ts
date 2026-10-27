import { simpleGit, SimpleGit } from 'simple-git'
import { commandExit } from '../utils/commandExit'
import { createHeadlessGit } from './headlessGit'

/**
 * Retrieves a SimpleGit instance for a repository.
 *
 * @param baseDir Optional path to the repo root. When omitted, simple-git
 *   uses `process.cwd()`. Pass this when launching coco against an
 *   arbitrary directory (e.g. `coco ui --repo <dir>`) so the workstation
 *   targets that path instead of wherever the user happened to run the
 *   command from. Useful for testing, scripting, and editor / shell
 *   integrations that don't want to `cd` first.
 * @param options.headless Build the instance for a full-screen session:
 *   adds a block timeout so a stalled git child can't spin forever. The
 *   caller also runs `applyHeadlessGitEnv()` for the prompt/lock guards.
 */
export const getRepo = (baseDir?: string, options: { headless?: boolean } = {}) => {
  let git: SimpleGit

  try {
    git = options.headless
      ? createHeadlessGit(baseDir)
      : baseDir ? simpleGit(baseDir) : simpleGit()
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    process.stderr.write(
      `Error initializing git repo${baseDir ? ` at ${baseDir}` : ''}: ${message}\n`
    )
    commandExit(1)
  }

  return git
}
