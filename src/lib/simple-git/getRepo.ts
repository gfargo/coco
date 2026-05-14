import { simpleGit, SimpleGit } from 'simple-git'
import { commandExit } from '../utils/commandExit'

/**
 * Retrieves a SimpleGit instance for a repository.
 *
 * @param baseDir Optional path to the repo root. When omitted, simple-git
 *   uses `process.cwd()`. Pass this when launching coco against an
 *   arbitrary directory (e.g. `coco ui --repo <dir>`) so the workstation
 *   targets that path instead of wherever the user happened to run the
 *   command from. Useful for testing, scripting, and editor / shell
 *   integrations that don't want to `cd` first.
 */
export const getRepo = (baseDir?: string) => {
  let git: SimpleGit

  try {
    git = baseDir ? simpleGit(baseDir) : simpleGit()
  } catch (e) {
    console.log('Error initializing git repo', e)
    commandExit(1)
  }

  return git
}
