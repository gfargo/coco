import { CommitResult, GitError, SimpleGit } from 'simple-git'

/**
 * Error thrown when a pre-commit hook blocks a commit (e.g. a linter exits non-zero).
 * Contains the raw hook output so callers can present it cleanly to the user.
 */
export class PreCommitHookError extends Error {
  readonly hookOutput: string

  constructor(hookOutput: string) {
    super('Pre-commit hook failed')
    this.name = 'PreCommitHookError'
    this.hookOutput = hookOutput
  }
}

/**
 * Detects whether a GitError was caused by a pre-commit hook that modified files.
 * These hooks (e.g. black, prettier) reformat files and exit non-zero on the first run,
 * but the commit can succeed once the modified files are re-staged.
 *
 * Deliberately NARROW: it must match only the "hook reformatted files"
 * signature, not any failing hook. The pre-commit framework prints
 * `- hook id: <name>` for EVERY failing hook — plain lint failures
 * included — and matching on that used to auto-stage-and-retry a
 * commit whose hook genuinely rejected it, silently sweeping the whole
 * worktree into the commit (see the retry in `createCommit`).
 */
export function isPreCommitHookModifiedFilesError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const msg = error.message
  // pre-commit framework outputs "files were modified by this hook"
  // git itself outputs "modified files exist in working tree" in some hook setups
  return (
    msg.includes('files were modified by this hook') ||
    msg.includes('modified by this hook')
  )
}

/**
 * Non-hook commit failures that must not be reported as "blocked by
 * hook": git exits non-zero for these with hooks entirely out of the
 * picture, and wrapping them in PreCommitHookError pointed users at
 * their hook config for a problem that has nothing to do with it.
 */
function isKnownNonHookCommitFailure(message: string): boolean {
  return (
    message.includes('nothing to commit') ||
    message.includes('no changes added to commit') ||
    message.includes('nothing added to commit')
  )
}

/**
 * Whether a GitError's message actually indicates a hook rejected the
 * commit, as opposed to some other commit failure (GPG signing, an
 * index.lock left by a crashed process, an unborn branch, a missing
 * `user.name`/`user.email`) that git also reports via a non-zero exit
 * with hooks entirely out of the picture. Deliberately narrow — err
 * toward rethrowing the real GitError over misclassifying it, since the
 * hook-failure UX (retry / skip hooks / abort) actively misdirects the
 * user for these: `--no-verify` doesn't disable GPG signing, so "skip
 * hooks" on a signing failure silently fails again the same way (#1886).
 */
function isLikelyHookFailure(message: string): boolean {
  return /\bhook\b/i.test(message) || message.includes('pre-commit') || message.includes('commit-msg')
}

export interface CreateCommitOptions {
  /** When true, passes --no-verify to git commit, skipping pre-commit and commit-msg hooks. */
  noVerify?: boolean
  /** When true, passes --amend to rewrite the most recent commit (`coco amend`). */
  amend?: boolean
}

/**
 * Creates a commit with the specified commit message.
 * Handles the case where pre-commit hooks modify files (e.g. black, prettier):
 * when detected, stages the hook-modified files and retries the commit once.
 * Any other GitError (e.g. hook lint failure) is wrapped in a PreCommitHookError
 * so callers can present it cleanly instead of showing a raw stack trace.
 *
 * @param message The commit message.
 * @param git The SimpleGit instance.
 * @param onHookModifiedFiles Optional callback invoked before the auto-retry so callers can notify the user.
 * @param options Optional commit options (e.g. noVerify).
 * @returns A Promise that resolves to the CommitResult.
 */
export async function createCommit(
  message: string,
  git: SimpleGit,
  onHookModifiedFiles?: () => void | Promise<void>,
  options?: CreateCommitOptions
): Promise<CommitResult> {
  const flags = [
    ...(options?.amend ? ['--amend'] : []),
    ...(options?.noVerify ? ['--no-verify'] : []),
  ]

  try {
    return await git.commit(message, flags)
  } catch (error) {
    if (isPreCommitHookModifiedFilesError(error)) {
      // Notify caller (e.g. to show a spinner message or log)
      if (onHookModifiedFiles) {
        await onHookModifiedFiles()
      }

      // Re-stage ONLY the files that were already in the index — the
      // hook reformatted those in the worktree, so `add` picks up the
      // new content. `git add .` here used to sweep the ENTIRE
      // worktree (deliberately-unstaged edits, untracked scratch
      // files, and — in the split flow, where everything else sits
      // unstaged after the up-front reset — every other group's
      // changes) into this one commit.
      const staged = (await git.raw(['diff', '--cached', '--name-only', '-z']))
        .split('\0')
        .filter(Boolean)
      if (staged.length > 0) {
        await git.raw(['add', '--', ...staged])
      }
      return await git.commit(message, flags)
    }

    if (error instanceof GitError) {
      // Known non-hook failures pass through untouched: "nothing to
      // commit" reported as "Commit blocked by hook: …" sent users
      // debugging hooks that never ran.
      if (isKnownNonHookCommitFailure(error.message)) {
        throw error
      }
      // Only wrap when the message actually indicates a hook — GPG
      // signing failures, index.lock contention, unborn-branch and
      // missing-identity errors all reach here too, and misclassifying
      // them as a blocked hook pointed users at hook config / --no-verify
      // for a problem neither one touches (#1886).
      if (isLikelyHookFailure(error.message)) {
        throw new PreCommitHookError(error.message)
      }
      throw error
    }

    throw error
  }
}
