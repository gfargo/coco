import { SimpleGit } from 'simple-git'

/**
 * Fetches the diff for the given commit ID.
 *
 * @param commitId The commit ID for which the diff is to be retrieved.
 * @returns A promise that resolves to the diff of the commit.
 */
export async function getDiffForCommit(
  commitId: string,
  {
    git,
  }: {
    git: SimpleGit
  }
): Promise<string> {
  try {
    return await git.diff(['-p', `${commitId}^..${commitId}`])
  } catch (error) {
    throw new Error(`Error fetching diff for commit ${commitId}: ${(error as Error).message}`)
  }
}
