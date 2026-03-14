import { CommitResult, SimpleGit } from 'simple-git'

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

/**
 * Creates a commit with the specified commit message.
 * Handles the case where pre-commit hooks modify files (e.g. black, prettier):
 * when detected, stages the hook-modified files and retries the commit once.
 *
 * @param message The commit message.
 * @param git The SimpleGit instance.
 * @param onHookModifiedFiles Optional callback invoked before the auto-retry so callers can notify the user.
 * @returns A Promise that resolves to the CommitResult.
 */
export async function createCommit(
  message: string,
  git: SimpleGit,
  onHookModifiedFiles?: () => void | Promise<void>
): Promise<CommitResult> {
  try {
    return await git.commit(message)
  } catch (error) {
    if (isPreCommitHookModifiedFilesError(error)) {
      // Notify caller (e.g. to show a spinner message or log)
      if (onHookModifiedFiles) {
        await onHookModifiedFiles()
      }

      // Stage all hook-modified files and retry the commit once
      await git.add('.')
      return await git.commit(message)
    }

    throw error
  }
}
