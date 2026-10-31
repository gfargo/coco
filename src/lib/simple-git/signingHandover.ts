import { execFileSync, spawnSync } from 'child_process'
import type { CommitResult, SimpleGit } from 'simple-git'
import { interactiveGitEnv } from './headlessGit'

/**
 * Signed commits inside a full-screen session (#2199).
 *
 * With `commit.gpgsign=true`, git asks gpg to sign, and a key that needs a
 * passphrase makes gpg-agent run a terminal pinentry. That prompt draws on
 * the tty and reads from it while the TUI holds the alt screen in raw mode:
 * keystrokes are split between pinentry and coco, and the loader spins until
 * the user gives up. `GIT_TERMINAL_PROMPT` does not cover it.
 *
 * So a commit that will sign runs with the terminal handed over, the way an
 * editor does: leave the alt screen, drop to cooked mode, run git with the
 * user's terminal, then take the screen back. The handover is blocking on
 * purpose. While it runs the event loop is stopped, so Ink cannot repaint
 * over the prompt.
 *
 * The lib layer cannot import the workstation, so the TUI registers how to
 * hand the terminal over. Without a registration (the CLI, agents, MCP,
 * tests) nothing changes.
 */

export type TerminalHandoff = <T>(run: () => T) => T

let handoff: TerminalHandoff | undefined

/** The TUI calls this once its terminal is up, and with `undefined` on exit. */
export function registerTerminalHandoff(next: TerminalHandoff | undefined): void {
  handoff = next
}

/**
 * Whether this commit will be signed: `-S` / `--gpg-sign` force it,
 * `--no-gpg-sign` prevents it, otherwise `commit.gpgsign`.
 */
export async function isCommitSigningEnabled(git: SimpleGit, args: readonly string[] = []): Promise<boolean> {
  if (args.includes('--no-gpg-sign')) return false
  if (args.some((arg) => arg === '-S' || arg.startsWith('--gpg-sign'))) return true
  try {
    // `--bool` rather than `--type=bool`: it predates git 2.18.
    return (await git.raw(['config', '--bool', '--get', 'commit.gpgsign'])).trim() === 'true'
  } catch {
    // Exit 1 when the key is unset.
    return false
  }
}

/** Thrown when a handed-over git command fails; its output was shown on the terminal. */
export class InteractiveGitError extends Error {
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null

  constructor(command: string, exitCode: number | null, signal: NodeJS.Signals | null) {
    super(
      signal
        ? `${command} was interrupted (${signal}).`
        : `${command} failed (exit ${exitCode}). Its output was shown while coco was suspended; run it in a shell to see it again.`
    )
    this.name = 'InteractiveGitError'
    this.exitCode = exitCode
    this.signal = signal
  }
}

async function shouldHandOver(git: SimpleGit, args: readonly string[]): Promise<boolean> {
  if (!handoff || !process.stdin.isTTY) return false
  return isCommitSigningEnabled(git, args)
}

/**
 * gpg finds the terminal for its pinentry from `GPG_TTY`, or failing that
 * from its own stdin, which under git is a pipe: "Inappropriate ioctl for
 * device". A shell profile normally exports it, but not every launch path
 * does, so fill it in from the terminal we are handing over.
 */
function withGpgTty(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (env.GPG_TTY || process.platform === 'win32') return env
  try {
    const tty = execFileSync('tty', { encoding: 'utf8', stdio: ['inherit', 'pipe', 'ignore'] }).trim()
    return tty.startsWith('/dev/') ? { ...env, GPG_TTY: tty } : env
  } catch {
    return env
  }
}

/** Blocks until Enter, so a failure's output can be read before the TUI repaints. */
function waitForEnter(): void {
  const prompt = '\n\u001b[1mPress Enter to return to coco\u001b[0m '
  try {
    if (process.platform === 'win32') {
      spawnSync('cmd', ['/c', 'pause'], { stdio: 'inherit' })
    } else {
      spawnSync('sh', ['-c', 'printf "%b" "$1"; read _', 'sh', prompt], { stdio: 'inherit' })
    }
  } catch {
    // Nothing to wait on; carry on.
  }
}

async function runHandedOver(git: SimpleGit, args: readonly string[]): Promise<void> {
  const cwd = (await git.revparse(['--show-toplevel'])).trim()
  const run = handoff as TerminalHandoff
  const outcome = run(() => {
    // Ctrl-C at a pinentry cancels the signing. In cooked mode the tty sends
    // SIGINT to the whole foreground group, coco included, and an unhandled
    // one would kill the session with the draft in it. A listener keeps coco
    // alive; git still gets the signal and stops.
    const keepAlive = () => undefined
    process.on('SIGINT', keepAlive)
    try {
      const result = spawnSync('git', [...args], { cwd, stdio: 'inherit', env: withGpgTty(interactiveGitEnv()) })
      if (result.error) throw result.error
      if (result.status !== 0 && !result.signal) waitForEnter()
      return result
    } finally {
      process.removeListener('SIGINT', keepAlive)
    }
  })
  if (outcome.status !== 0) {
    throw new InteractiveGitError(`git ${args[0]}`, outcome.status, outcome.signal)
  }
}

/**
 * `git commit ...` as `git.raw(args)` would run it, except that a commit that
 * will sign gets the terminal. Resolves to git's stdout, or `''` when the
 * terminal was handed over (git's output went to the screen).
 */
export async function runCommitCommand(git: SimpleGit, args: string[]): Promise<string> {
  if (!(await shouldHandOver(git, args))) return git.raw(args)
  await runHandedOver(git, args)
  return ''
}

/**
 * `git.commit(message, flags)` that hands the terminal over when it will sign.
 * A handed-over commit loses two things the captured path has: simple-git's
 * parsed summary (only the short hash is filled in) and the hook-modified
 * files auto-retry, which reads git's captured stderr. The user saw the hook
 * output and re-stages by hand.
 */
export async function commitWithSigningHandover(
  git: SimpleGit,
  message: string,
  flags: string[]
): Promise<CommitResult> {
  const args = ['commit', '-m', message, ...flags]
  if (!(await shouldHandOver(git, args))) return git.commit(message, flags)
  await runHandedOver(git, args)
  const commit = (await git.revparse(['--short', 'HEAD'])).trim()
  return { author: null, branch: '', commit, root: false, summary: { changes: 0, insertions: 0, deletions: 0 } }
}
