import { SimpleGit } from 'simple-git'

type GetCommitLogRangeOptions = { git: SimpleGit; noMerges?: boolean }

export async function getCommitLogRange(
  from: string,
  to: string,
  { noMerges, git }: GetCommitLogRangeOptions
): Promise<string[]> {
  try {
    const output = await git.raw([
      'log',
      `${from}..${to}`,
      '--pretty=format:%s', // This tells git to output only the commit messages.
      
      // Include '--no-merges' here if you want to exclude merge commits.
      noMerges ? '--no-merges' : null,
    ].filter(Boolean) as string[]) // filter(Boolean) removes any null values from the array

    const messages = output.split('\n').filter(Boolean)
    return messages
  } catch (error) {
    // If there's an error, handle it appropriately
    console.error('Error getting commit messages:', error)
    throw error
  }
}
