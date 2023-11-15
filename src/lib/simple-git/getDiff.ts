import { SimpleGit } from 'simple-git'
import { createTwoFilesPatch } from 'diff'
import { FileChange } from '../types'
import { Logger } from '../utils/logger'

const parseDefaultFileDiff = async (
  nodeFile: FileChange,
  commit = '--staged',
  git: SimpleGit
): Promise<string> => {

  if(commit !== '--staged') {
    return await git.diff([`${commit}~1..${commit}`, '--', nodeFile.filePath]);
  }

  return await git.diff([commit, nodeFile.filePath])
}

const parseRenamedFileDiff = async (
  nodeFile: FileChange,
  commit: string,
  git: SimpleGit,
  logger: Logger
): Promise<string> => {
  let result = ''
  const oldFilePath = nodeFile?.oldFilePath || nodeFile.filePath

  let previousCommitHash = 'HEAD'
  let newCommitHash = ''

  if (commit !== '--staged') {
    try {
      previousCommitHash = await git.revparse([`${commit}~1`])
    } catch (err) {
      logger.verbose(`Error getting previous commit hash for ${nodeFile.filePath}`, {
        color: 'red',
      })
    }
    newCommitHash = commit
  }

  try {
    const [previousContent, newContent] = await Promise.all([
      git.show([`${previousCommitHash}:${oldFilePath}`]),
      git.show([`${newCommitHash}:${nodeFile.filePath}`]),
    ])

    if (previousContent !== newContent) {
      result = createTwoFilesPatch(
        oldFilePath,
        nodeFile.filePath,
        previousContent,
        newContent,
        '',
        '',
        {
          context: 3,
        }
      )
      // remove the first 4 lines of the patch (they contain the old and new file names)
      result = result.split('\n').slice(4).join('\n')
    } else {
      result = 'File contents are unchanged.'
    }
  } catch (err) {
    logger.verbose(`Error comparing file contents for ${nodeFile.filePath}`, { color: 'red' })
    result = 'Error comparing file contents.'
  }
  return result
}

export const getDiff = async (
  nodeFile: FileChange,
  commit: string,
  {
    git,
    logger,
  }: {
    git: SimpleGit
    logger: Logger
  }
): Promise<string> => {
  if (nodeFile.status === 'deleted') {
    return 'This file has been deleted.'
  }

  if (nodeFile.status === 'renamed' && nodeFile.oldFilePath) {
    const renamedDiff = await parseRenamedFileDiff(nodeFile, commit, git, logger)
    return renamedDiff
  }

  // If not deleted or renamed, get the diff from the index
  const defaultDiff = await parseDefaultFileDiff(nodeFile, commit, git)
  return defaultDiff
}
