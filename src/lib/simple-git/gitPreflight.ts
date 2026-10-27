import { execFile } from 'child_process'
import type { SimpleGit } from 'simple-git'

/**
 * Startup checks for the git the TUI is about to drive (#2205). The code
 * uses `git restore` / `git switch` (2.23) and `--end-of-options` (2.24),
 * so older distros (Debian buster, CentOS 7) fail with "not a git
 * command" on the first stage or checkout. A bare repo, a directory
 * outside any repo, or a missing git binary would otherwise open a TUI
 * full of errors.
 */
export const MIN_GIT_VERSION = [2, 24, 0] as const

export type GitVersion = { major: number; minor: number; patch: number; raw: string }

/** Parses `git version 2.39.2`, `2.39.3 (Apple Git-146)`, `2.43.0.windows.1`. */
export function parseGitVersion(output: string): GitVersion | undefined {
  const match = /git version (\d+)\.(\d+)(?:\.(\d+))?/.exec(output)
  if (!match) return undefined
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3] ?? 0),
    raw: output.trim(),
  }
}

export function isSupportedGitVersion(version: GitVersion): boolean {
  const [major, minor, patch] = MIN_GIT_VERSION
  if (version.major !== major) return version.major > major
  if (version.minor !== minor) return version.minor > minor
  return version.patch >= patch
}

export function formatMinGitVersion(): string {
  return MIN_GIT_VERSION.join('.')
}

export type GitBinaryProbe =
  | { ok: true; version: GitVersion }
  | { ok: false; reason: 'missing' | 'unparseable' | 'too-old'; message: string; version?: GitVersion }

/** Runs `git --version` directly so a missing binary (ENOENT) is told apart from a git error. */
export function probeGitBinary(
  run: (callback: (error: NodeJS.ErrnoException | null, stdout: string) => void) => void = (callback) =>
    execFile('git', ['--version'], (error, stdout) => callback(error as NodeJS.ErrnoException | null, String(stdout)))
): Promise<GitBinaryProbe> {
  return new Promise((resolve) => {
    run((error, stdout) => {
      if (error) {
        resolve({
          ok: false,
          reason: 'missing',
          message:
            error.code === 'ENOENT'
              ? 'git was not found on PATH. Install git and try again.'
              : `Could not run git: ${error.message}`,
        })
        return
      }
      const version = parseGitVersion(stdout)
      if (!version) {
        resolve({ ok: false, reason: 'unparseable', message: `Could not read the git version from "${stdout.trim()}".` })
        return
      }
      if (!isSupportedGitVersion(version)) {
        resolve({
          ok: false,
          reason: 'too-old',
          version,
          message: `git ${version.major}.${version.minor}.${version.patch} is too old; coco needs ${formatMinGitVersion()} or newer (it uses git switch, git restore and --end-of-options).`,
        })
        return
      }
      resolve({ ok: true, version })
    })
  })
}

export type RepoProbe = { ok: true } | { ok: false; reason: 'no-repo' | 'bare' | 'no-worktree'; message: string }

/** Checks that `git`'s working directory is inside a non-bare work tree. */
export async function probeWorkTree(git: SimpleGit): Promise<RepoProbe> {
  let output: string
  try {
    output = await git.raw(['rev-parse', '--is-bare-repository', '--is-inside-work-tree'])
  } catch (error) {
    const text = (error as Error).message || ''
    if (/not a git repository/i.test(text)) {
      return { ok: false, reason: 'no-repo', message: 'Not inside a git repository. Run coco from a repo, or pass --repo <dir>.' }
    }
    throw error
  }
  const [isBare, isInsideWorkTree] = output.trim().split(/\s+/)
  if (isBare === 'true') {
    return { ok: false, reason: 'bare', message: 'This is a bare repository; coco ui needs a working tree. Use a clone or a git worktree.' }
  }
  if (isInsideWorkTree !== 'true') {
    return { ok: false, reason: 'no-worktree', message: 'This directory is inside .git, not a working tree. Run coco from the repository root or pass --repo <dir>.' }
  }
  return { ok: true }
}

/** Throws a user-facing error when the TUI cannot run against `git`. */
export async function assertGitReadyForTui(
  git: SimpleGit,
  probeBinary: () => Promise<GitBinaryProbe> = probeGitBinary
): Promise<void> {
  const binary = await probeBinary()
  if (!binary.ok) throw new Error(binary.message)
  const repo = await probeWorkTree(git)
  if (!repo.ok) throw new Error(repo.message)
}
