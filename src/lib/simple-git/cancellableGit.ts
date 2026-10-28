import { simpleGit, SimpleGit } from 'simple-git'
import { HEADLESS_GIT_BLOCK_TIMEOUT_MS } from './headlessGit'

export type CancellableGit = {
  git: SimpleGit
  /** Kills the git child currently running on `git` and rejects the task. */
  cancel: () => void
  wasCancelled: () => boolean
}

/**
 * A git instance for ONE long-running network operation (push / pull /
 * fetch) that the user can abandon with Esc (#2199). simple-git's abort
 * plugin takes its AbortSignal at construction and, once aborted, kills
 * every later spawn on that instance too ("Abort already signaled"). So
 * the instance is single-use: build one per operation, never share it.
 * Same headless block timeout as the other TUI instances.
 */
export function createCancellableGit(baseDir: string): CancellableGit {
  const controller = new AbortController()
  const git = simpleGit({
    baseDir,
    timeout: { block: HEADLESS_GIT_BLOCK_TIMEOUT_MS },
    abort: controller.signal,
  })
  return {
    git,
    cancel: () => controller.abort(),
    wasCancelled: () => controller.signal.aborted,
  }
}
