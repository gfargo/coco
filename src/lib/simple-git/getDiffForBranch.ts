import { SimpleGit } from 'simple-git'
import { Logger } from '../utils/logger'
import { GetChangesResult, FileChange } from '../types'
import { getSummaryText } from './getSummaryText'

export type GetDiffForBranch = {
  git: SimpleGit
  logger?: Logger
  baseBranch: string
  headBranch: string
  options?: {
    ignoredFiles?: string[]
    ignoredExtensions?: string[]
    ignoredPaths?: string[]
  }
}

/**
 * Retrieves the diff between the current branch and a specified target branch.
 *
 * @param {Object} options - The options for retrieving the diff.
 * @param {SimpleGit} options.git - The SimpleGit instance.
 * @param {Logger} options.logger - The logger for logging messages.
 * @param {string} options.baseBranch - The base branch to compare against.
 * @param {string} options.headBranch - The head branch to compare.
 * @param {string[]} options.ignoredFiles - Array of specific files to ignore.
 * @param {string[]} options.ignoredExtensions - Array of file extensions to ignore.
 * @returns {Promise<GetChangesResult>} The diff between the current branch and the target branch.
 */
export async function getDiffForBranch({
  git,
  logger,
  baseBranch,
  headBranch,
  options,
}: GetDiffForBranch): Promise<GetChangesResult> {
  try {
    logger?.verbose(`Getting diff for branches: baseBranch="${baseBranch}", headBranch="${headBranch}"`, {
      color: 'blue',
    })

    // Validate branch names
    if (!baseBranch || !headBranch) {
      throw new Error(`Invalid branch names: baseBranch="${baseBranch}", headBranch="${headBranch}"`)
    }

    const { ignoredFiles = [], ignoredExtensions = [] } = options || {}
    // Prepare ignore patterns
    const ignorePatterns = [
      ...ignoredFiles.map((file) => `:!${file}`),
      ...ignoredExtensions.map((ext) => `:!*${ext}`),
    ]

    // Construct the diff command
    const diffArgs = [`${baseBranch}..${headBranch}`]
    if (ignorePatterns.length > 0) {
      diffArgs.push('--')
      diffArgs.push(...ignorePatterns)
    }

    logger?.verbose(`Running git diff with args: ${diffArgs.join(' ')}`, {
      color: 'blue',
    })

    // Get the diff
    const diff = await git.diff(diffArgs)

    logger?.verbose(`Generated diff between "${headBranch}" and "${baseBranch}"`, {
      color: 'blue',
    })

    const changes: FileChange[] = diff.split('diff --git').slice(1).map((fileDiff) => {
      const lines = fileDiff.split('\n')
      const filePathLine = lines[0]
      const filePath = filePathLine.split('b/')[1]?.split(' ')[0]
      const oldFilePath = filePathLine.split('a/')[1]?.split(' ')[0]

      // Determine status based on diff headers
      let status: FileChange['status'] = 'modified'
      if (fileDiff.includes('new file mode')) {
        status = 'added'
      } else if (fileDiff.includes('deleted file mode')) {
        status = 'deleted'
      } else if (fileDiff.includes('rename from')) {
        status = 'renamed'
      }

      return {
        filePath: filePath || '',
        oldFilePath: oldFilePath || '',
        status,
        summary: getSummaryText({ path: filePath || '', index: '', working_dir: '' }, { filePath: filePath || '', status }),
      }
    })

    return {
      staged: changes,
      unstaged: [],
      untracked: [],
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('Error in getDiffForBranch:', error)
    logger?.log(`Encountered an error getting diff between branches: ${errorMessage}`, { color: 'red' })
    logger?.log(`Branch details: baseBranch="${baseBranch}", headBranch="${headBranch}"`, { color: 'red' })
    
    // Re-throw the error so the caller can handle it appropriately
    throw error
  }
}