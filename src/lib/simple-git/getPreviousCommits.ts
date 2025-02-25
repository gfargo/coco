import { SimpleGit } from 'simple-git'
import { formatSingleCommit } from './formatSingleCommit'

export interface GetPreviousCommitsOptions {
  git: SimpleGit
  count?: number
}

/**
 * Get the specified number of previous commits
 * @param options - Options for getting previous commits
 * @returns Formatted commit logs
 */
export async function getPreviousCommits(options: GetPreviousCommitsOptions): Promise<string> {
  const { git, count = 1 } = options

  if (count <= 0) {
    return ''
  }

  try {
    const logs = await git.log({ maxCount: count })
    
    if (!logs || logs.total === 0) {
      return ''
    }

    // Format the commit logs
    const formattedLogs = logs.all.map((commit) => {
      return formatSingleCommit(commit)
    }).join('\n\n')

    return formattedLogs
  } catch (error) {
    console.error(`Error getting previous commits: ${(error as Error).message}`)
    return ''
  }
}