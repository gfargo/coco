import { SimpleGit } from 'simple-git'
import { Logger } from '../utils/logger'
import { getCommitLogRange } from './getCommitLogRange'
import { getCurrentBranchName } from './getCurrentBranchName'

export type GetCommitLogCurrentBranch = {
  git: SimpleGit
  logger?: Logger
  comparisonBranch?: string
}

export async function getCommitLogCurrentBranch({
  git,
  logger,
  comparisonBranch = 'main',
}: GetCommitLogCurrentBranch): Promise<string[]> {
  try {
    // Get the current branch name
    const branch = await getCurrentBranchName({ git })

    // Check if the current branch has any commits
    const hasCommits = (await git.raw(['rev-list', '--count', branch])) !== '0'
    if (!hasCommits) {
      console.log('No commits on the current branch.')
      return []
    }

    // Get the list of commits that are unique to the current branch
    const uniqueCommits = (await git.raw(['rev-list', `${comparisonBranch}..${branch}`]))
      .split('\n')
      .filter(Boolean)
      .reverse()

    const firstCommit = uniqueCommits[0]
    const lastCommit = uniqueCommits[uniqueCommits.length - 1]

    // Retrieve commit log with messages
    return await getCommitLogRange(firstCommit, lastCommit, { git, noMerges: true })
  } catch (error) {
    logger?.log('Encountered an error getting commit log from current branch', { color: 'red' })
  }

  return []
}
