import { CommitResult, GitError, SimpleGit } from 'simple-git'

/**
 * Error thrown when a pre-commit hook blocks a commit (e.g. a linter exits non-zero).
 * Contains the raw hook output so callers can present it cleanly to the user.
 */
export class PreCommitHookError extends Error {
  readonly hookOutput: string

  constructor(hookOutput: string) {
    super(`Pre-commit hook failed:\n${hookOutput}`)
    this.name = 'PreCommitHookError'
    this.hookOutput = hookOutput
  }
}

/**
 * Detects whether a GitError was caused by a pre-commit hook that modified files.
 * These hooks (e.g. black, prettier) reformat files and exit non-zero on the first run,
 * but the commit can succeed once the modified files are re-staged.
 */
export function isPreCommitHookModifiedFilesError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const msg = error.message
  // pre-commit framework outputs "files were modified by this hook"
  // git itself outputs "modified files exist in working tree" in some hook setups
  return (
    msg.includes('files were modified by this hook') ||
    msg.includes('modified by this hook') ||
    msg.includes('hook id:')
  )
}

export interface CreateCommitOptions {
  /** When true, passes --no-verify to git commit, skipping pre-commit and commit-msg hooks. */
  noVerify?: boolean
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
  const flags = options?.noVerify ? ['--no-verify'] : []

  try {
    return await git.commit(message, flags)
  } catch (error) {
    if (isPreCommitHookModifiedFilesError(error)) {
      // Notify caller (e.g. to show a spinner message or log)
      if (onHookModifiedFiles) {
        await onHookModifiedFiles()
      }

      // Stage all hook-modified files and retry the commit once
      await git.add('.')
      return await git.commit(message, flags)
    }

    // Wrap any other GitError so callers can present it cleanly rather than
    // showing a raw Node.js stack trace originating from simple-git internals.
    if (error instanceof GitError) {
      throw new PreCommitHookError(error.message)
    }

    throw error
  }
}
