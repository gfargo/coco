import { SimpleGit } from 'simple-git'

export type GetCommitLogRangeInput = {
  git: SimpleGit
  from: string
  to: string
}

export async function getCommitLogRange({
  git,
  from,
  to,
}: GetCommitLogRangeInput): Promise<string[]> {
  try {
    // Using the 'raw' method to execute the 'git log' command with the desired options.
    const output = await git.raw([
      'log',
      `${from}..${to}`,
      '--pretty=format:%s', // This tells git to output only the commit messages.
      // You could also include '--no-merges' here if you want to exclude merge commits.
    ])

    // The 'output' will be a string with each commit message on a new line.
    // Split the output by new lines to create an array of commit messages.
    const messages = output.split('\n').filter(Boolean) // filter(Boolean) removes any empty strings
    return messages
  } catch (error) {
    // If there's an error, handle it appropriately
    console.error('Error getting commit messages:', error)
    throw error
  }
}
