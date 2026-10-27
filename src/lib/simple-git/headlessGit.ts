import { simpleGit, SimpleGit } from 'simple-git'

/**
 * Git hardening for full-screen sessions (`coco ui`, `coco workspace`).
 * Nothing in a TUI can answer a prompt git opens on /dev/tty — an HTTPS
 * username, an SSH host-key or passphrase question — so those must fail
 * fast with a message instead of blocking the spinner forever (#2199).
 * Background refreshes must also not take the optional index lock, or the
 * user's own `git commit` in another terminal can lose the race (#2201).
 */

/**
 * No output for this long kills the git child. Generous on purpose: piped
 * git is silent during a slow clone, fetch, or push, and this is only the
 * backstop for a stalled connection, not a latency budget.
 */
export const HEADLESS_GIT_BLOCK_TIMEOUT_MS = 300_000

const SSH_BATCH_MODE = '-o BatchMode=yes'

/**
 * Sets the guard variables on `env` (default `process.env`), which every
 * git child inherits. Idempotent. A user-set `GIT_SSH_COMMAND` is kept and
 * extended, never replaced.
 */
export function applyHeadlessGitEnv(env: NodeJS.ProcessEnv = process.env): void {
  env.GIT_TERMINAL_PROMPT = '0'
  env.GCM_INTERACTIVE = 'never'
  env.GIT_OPTIONAL_LOCKS = '0'

  const ssh = env.GIT_SSH_COMMAND?.trim()
  if (!ssh) {
    env.GIT_SSH_COMMAND = `ssh ${SSH_BATCH_MODE}`
  } else if (!/BatchMode/i.test(ssh)) {
    env.GIT_SSH_COMMAND = `${ssh} ${SSH_BATCH_MODE}`
  }
}

export function createHeadlessGit(baseDir?: string): SimpleGit {
  return simpleGit({
    ...(baseDir ? { baseDir } : {}),
    timeout: { block: HEADLESS_GIT_BLOCK_TIMEOUT_MS },
  })
}
