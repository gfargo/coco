import { SimpleGit } from 'simple-git'
import { Logger } from '../utils/logger'
import { getCurrentBranchName } from './getCurrentBranchName'

export type GetDiffForBranch = {
  git: SimpleGit
  logger?: Logger
  targetBranch: string
  ignoredFiles?: string[]
  ignoredExtensions?: string[]
  ignoredPaths?: string[]
}

/**
 * Retrieves the diff between the current branch and a specified target branch.
 *
 * @param {Object} options - The options for retrieving the diff.
 * @param {SimpleGit} options.git - The SimpleGit instance.
 * @param {Logger} options.logger - The logger for logging messages.
 * @param {string} options.targetBranch - The target branch to compare against.
 * @param {string[]} options.ignoredFiles - Array of specific files to ignore.
 * @param {string[]} options.ignoredExtensions - Array of file extensions to ignore.
 * @returns {Promise<string>} The diff between the current branch and the target branch.
 */
export async function getDiffForBranch({
  git,
  logger,
  targetBranch,
  ignoredFiles = [],
  ignoredExtensions = [],
}: GetDiffForBranch): Promise<string> {
  try {
    // Get the current branch name
    const currentBranch = await getCurrentBranchName({ git })

    // Prepare ignore patterns
    const ignorePatterns = [
      ...ignoredFiles.map((file) => `:!${file}`),
      ...ignoredExtensions.map((ext) => `:!*${ext}`),
    ]

    // Construct the diff command
    const diffArgs = [`${targetBranch}..${currentBranch}`]
    if (ignorePatterns.length > 0) {
      diffArgs.push('--')
      diffArgs.push(...ignorePatterns)
    }

    // Get the diff
    const diff = await git.diff(diffArgs)

    logger?.verbose(`Generated diff between "${currentBranch}" and "${targetBranch}"`, {
      color: 'blue',
    })

    return diff
  } catch (error) {
    console.error('Error in getDiffForBranch:', error)
    logger?.log('Encountered an error getting diff between branches', { color: 'red' })
    return ''
  }
}
