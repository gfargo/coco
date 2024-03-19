import { SimpleGit } from 'simple-git'
import { Logger } from '../utils/logger'
import { getCommitLogRange } from './getCommitLogRange'
import { getCurrentBranchName } from './getCurrentBranchName'

export type GetCommitLogCurrentBranch = {
  git: SimpleGit
  logger?: Logger
  comparisonBranch?: string
  comparisonRemote?: string
}

/**
 * Retrieves the commit log for the current branch.
 * 
 * @param {Object} options - The options for retrieving the commit log.
 * @param {SimpleGit} options.git - The SimpleGit instance.
 * @param {Logger} options.logger - The logger for logging messages.
 * @param {string} [options.comparisonBranch='main'] - The branch to compare against.
 * @param {string} [options.comparisonRemote='origin'] - The remote to compare against.
 * @returns {Promise<string[]>} The array of commit messages in the commit log.
 */
export async function getCommitLogCurrentBranch({
  git,
  logger,
  comparisonBranch = 'main',
  comparisonRemote = 'origin',
}: GetCommitLogCurrentBranch): Promise<string[]> {
  try {
    // Get the current branch name
    const branch = await getCurrentBranchName({ git })

    // Check if the current branch has any commits
    const hasCommits = (await git.raw(['rev-list', '--count', branch])) !== '0'
    if (!hasCommits) {
      logger?.log('No commits on the current branch.')
      return []
    }

    // Get the list of commits that are unique to the current branch
    let uniqueCommits;
    if (comparisonBranch === branch) {
      // If the comparison branch is the same as the current branch, we compare against the remote.
      uniqueCommits = (await git.raw(['rev-list', `${comparisonRemote}/${comparisonBranch}..${branch}`]))
          .split('\n')
          .filter(Boolean)
          .reverse();
    } else {
      // Your existing code for different branches
      uniqueCommits = (await git.raw(['rev-list', `${comparisonBranch}..${branch}`]))
          .split('\n')
          .filter(Boolean)
          .reverse();
    }

    logger?.verbose(`Found ${uniqueCommits.length} unique commits on "${branch}"`, { color: 'blue' })

    const firstCommit = uniqueCommits[0]
    const lastCommit = uniqueCommits[uniqueCommits.length - 1]

    if (!firstCommit || !lastCommit) {
      logger?.log('Unable to determine first and last commit on the current branch', { color: 'yellow' })
      return []
    }

    // Retrieve commit log with messages
    return await getCommitLogRange(firstCommit, lastCommit, { git, noMerges: true })
  } catch (error) {
    logger?.log('Encountered an error getting commit log from current branch', { color: 'red' })
  }

  return []
}
