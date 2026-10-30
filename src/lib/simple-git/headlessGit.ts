import { execFileSync } from 'child_process'
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

const GUARDED_KEYS = ['GIT_TERMINAL_PROMPT', 'GCM_INTERACTIVE', 'GIT_OPTIONAL_LOCKS', 'GIT_SSH_COMMAND'] as const
type GuardedKey = (typeof GUARDED_KEYS)[number]

/** What each guarded variable held before the guards replaced it. */
let originalValues: Partial<Record<GuardedKey, string | undefined>> | undefined

export type HeadlessGitEnvOptions = {
  /**
   * The repository's `core.sshCommand`, if any. `GIT_SSH_COMMAND` outranks
   * it, so setting the env var alone would silently replace a configured
   * SSH command (a jump host, an identity file). Defaults to reading git
   * config in the current directory.
   */
  readSshCommandConfig?: () => string | undefined
}

function readCoreSshCommand(): string | undefined {
  try {
    const value = execFileSync('git', ['config', '--get', 'core.sshCommand'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return value || undefined
  } catch {
    return undefined
  }
}

/**
 * Sets the guard variables on `env` (default `process.env`), which every
 * git child inherits. Idempotent. The user's SSH setup is kept: a set
 * `GIT_SSH_COMMAND` or `core.sshCommand` is extended with BatchMode, and a
 * set `GIT_SSH` (a bare program, which takes no options) is left alone.
 */
export function applyHeadlessGitEnv(env: NodeJS.ProcessEnv = process.env, options: HeadlessGitEnvOptions = {}): void {
  if (env === process.env && !originalValues) {
    originalValues = Object.fromEntries(GUARDED_KEYS.map((key) => [key, env[key]]))
  }
  env.GIT_TERMINAL_PROMPT = '0'
  env.GCM_INTERACTIVE = 'never'
  env.GIT_OPTIONAL_LOCKS = '0'

  const ssh = env.GIT_SSH_COMMAND?.trim()
  if (ssh) {
    if (!/BatchMode/i.test(ssh)) env.GIT_SSH_COMMAND = `${ssh} ${SSH_BATCH_MODE}`
    return
  }
  // GIT_SSH_COMMAND would outrank GIT_SSH; with GIT_SSH set, leave both.
  if (env.GIT_SSH?.trim()) return
  const configured = (options.readSshCommandConfig ?? readCoreSshCommand)()?.trim()
  env.GIT_SSH_COMMAND = configured
    ? /BatchMode/i.test(configured) ? configured : `${configured} ${SSH_BATCH_MODE}`
    : `ssh ${SSH_BATCH_MODE}`
}

/**
 * The environment for a process the user interacts with directly (an
 * editor, a terminal handover): `process.env` with the headless guards
 * undone, so git run from there can prompt again and the user's own
 * commands keep their optional locks.
 */
export function interactiveGitEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (!originalValues) return env
  const restored: NodeJS.ProcessEnv = { ...env }
  for (const key of GUARDED_KEYS) {
    const original = originalValues[key]
    if (original === undefined) delete restored[key]
    else restored[key] = original
  }
  return restored
}

/** Test hook: forget the recorded originals. */
export function resetHeadlessGitEnvForTests(): void {
  originalValues = undefined
}

export function createHeadlessGit(baseDir?: string): SimpleGit {
  return simpleGit({
    ...(baseDir ? { baseDir } : {}),
    timeout: { block: HEADLESS_GIT_BLOCK_TIMEOUT_MS },
  })
}
