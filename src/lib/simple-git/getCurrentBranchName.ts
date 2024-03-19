import { SimpleGit } from 'simple-git'

export type GetCurrentBranchName = {
  git: SimpleGit
}

/**
 * Retrieves the name of the current branch.
 * 
 * @param {GetCurrentBranchName} options - The options for retrieving the branch name.
 * @returns {Promise<string>} - A promise that resolves to the name of the current branch.
 */
export async function getCurrentBranchName({ git }: GetCurrentBranchName): Promise<string> {
  return await git.revparse(['--abbrev-ref', 'HEAD'])
}
