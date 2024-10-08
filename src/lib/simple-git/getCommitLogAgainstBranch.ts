import { SimpleGit } from 'simple-git'
import { Logger } from '../utils/logger'
import { getCommitLogRange } from './getCommitLogRange'
import { getCurrentBranchName } from './getCurrentBranchName'

export type GetCommitLogAgainstBranch = {
  git: SimpleGit
  logger?: Logger
  targetBranch: string
}

/**
 * Retrieves the commit log between the current branch and a specified target branch.
 *
 * @param {Object} options - The options for retrieving the commit log.
 * @param {SimpleGit} options.git - The SimpleGit instance.
 * @param {Logger} options.logger - The logger for logging messages.
 * @param {string} options.targetBranch - The target branch to compare against.
 * @returns {Promise<string[]>} The array of commit messages in the commit log.
 */
export async function getCommitLogAgainstBranch({
  git,
  logger,
  targetBranch,
}: GetCommitLogAgainstBranch): Promise<string[]> {
  try {
    // Get the current branch name
    const currentBranch = await getCurrentBranchName({ git })

    // Get the list of commits that are unique to the current branch compared to the target branch
    const uniqueCommits = (await git.raw(['rev-list', `${targetBranch}..${currentBranch}`]))
      .split('\n')
      .filter(Boolean)
      .reverse()

    logger?.verbose(
      `Found ${uniqueCommits.length} unique commits between "${currentBranch}" and "${targetBranch}"`,
      { color: 'blue' }
    )

    const firstCommit = uniqueCommits[0]
    const lastCommit = uniqueCommits[uniqueCommits.length - 1]

    if (!firstCommit || !lastCommit) {
      logger?.log('Unable to determine first and last commit between branches', { color: 'yellow' })
      return []
    }

    // Retrieve commit log with messages
    return await getCommitLogRange(firstCommit, lastCommit, { git, noMerges: true })
  } catch (error) {
    logger?.log('Encountered an error getting commit log between branches', { color: 'red' })
  }

  return []
}
