import { simpleGit, SimpleGit, SimpleGitOptions } from 'simple-git'

/**
 * Builds a SimpleGit instance that passes the user's environment to git.
 *
 * simple-git 4 strips "guarded" ambient variables (every `GIT_*` plus
 * `EDITOR`, `VISUAL`, `PAGER`, `SSH_ASKPASS`, ...) from each spawned git
 * process unless they are allow-listed. That guard targets services that
 * run git on behalf of untrusted callers. coco runs git as the user, so it
 * must see the same environment a shell would: `GIT_ASKPASS` /
 * `GIT_SSH_COMMAND` for remote auth, `GIT_INDEX_FILE` / `GIT_DIR` inside
 * hooks, `GIT_AUTHOR_*` / `GIT_COMMITTER_*` identity overrides, and so on.
 *
 * Only ambient keys are allow-listed. Explicitly supplied variables via
 * `.env()` and the abbreviated-option guard keep simple-git's defaults.
 */
export function createSimpleGit(
  baseDir?: string,
  options: Partial<SimpleGitOptions> = {}
): SimpleGit {
  return simpleGit({
    ...(baseDir ? { baseDir } : {}),
    ...options,
    allowEnvironment: [
      ...Object.keys(process.env),
      ...(options.allowEnvironment ?? []),
    ],
  })
}
