import { CommitResult, SimpleGit } from 'simple-git'

/**
 * Creates a commit with the specified commit message.
 * 
 * @param message The commit message.
 * @param git The SimpleGit instance.
 * @returns A Promise that resolves to the CommitResult.
 */
export async function createCommit(message: string, git: SimpleGit): Promise<CommitResult> {
  return await git.commit(message)
}
