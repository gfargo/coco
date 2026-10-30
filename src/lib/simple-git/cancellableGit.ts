import { SimpleGit } from 'simple-git'
import { createSimpleGit } from './createSimpleGit'
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
  // createSimpleGit, so simple-git 4 still passes the headless guards
  // (GIT_TERMINAL_PROMPT, the BatchMode SSH command) to the network op.
  const git = createSimpleGit(baseDir, {
    timeout: { block: HEADLESS_GIT_BLOCK_TIMEOUT_MS },
    abort: controller.signal,
  })
  return {
    git,
    cancel: () => controller.abort(),
    wasCancelled: () => controller.signal.aborted,
  }
}
