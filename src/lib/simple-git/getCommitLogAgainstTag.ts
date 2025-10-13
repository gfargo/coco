import { SimpleGit } from 'simple-git'
import { Logger } from '../utils/logger'
import { getCommitLogRangeDetails, CommitDetails } from './getCommitLogRangeDetails'
import { getCurrentBranchName } from './getCurrentBranchName'

export type GetCommitLogAgainstTag = {
  git: SimpleGit
  logger?: Logger
  targetTag: string
}

/**
 * Retrieves the commit log between the current branch and a specified tag.
 *
 * @param {Object} options - The options for retrieving the commit log.
 * @param {SimpleGit} options.git - The SimpleGit instance.
 * @param {Logger} options.logger - The logger for logging messages.
 * @param {string} options.targetTag - The tag to compare against.
 * @returns {Promise<CommitDetails[]>} The array of commit messages in the commit log.
 */
export async function getCommitLogAgainstTag({
  git,
  logger,
  targetTag,
}: GetCommitLogAgainstTag): Promise<CommitDetails[]> {
  try {
    const currentBranch = await getCurrentBranchName({ git })

    const uniqueCommits = (await git.raw(['rev-list', `${targetTag}..${currentBranch}`]))
      .split('\n')
      .filter(Boolean)
      .reverse()

    logger?.verbose(
      `Found ${uniqueCommits.length} unique commits between "${currentBranch}" and tag "${targetTag}"`,
      { color: 'blue' }
    )

    const firstCommit = uniqueCommits[0]
    const lastCommit = uniqueCommits[uniqueCommits.length - 1]

    if (!firstCommit || !lastCommit) {
      logger?.log('Unable to determine first and last commit between branch and tag', { color: 'yellow' })
      return []
    }

    return await getCommitLogRangeDetails(firstCommit, lastCommit, { git, noMerges: true })
  } catch (error) {
    logger?.log('Encountered an error getting commit log between branch and tag', { color: 'red' })
  }

  return []
}
