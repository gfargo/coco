import { SimpleGit } from 'simple-git'
import { createTwoFilesPatch} from 'diff'
import { FileChange } from '../types'
import { Logger } from '../utils/logger'

const parseDefaultFileDiff = async (nodeFile: FileChange, git: SimpleGit): Promise<string> => {
  return await git.diff(['--staged', nodeFile.filepath])
}

const parseRenamedFileDiff = async (
  nodeFile: FileChange,
  git: SimpleGit,
  logger: Logger
): Promise<string> => {
  let result = ''
  const oldFilepath = nodeFile?.oldFilepath || nodeFile.filepath

  try {
    const [headContent, indexContent] = await Promise.all([
      git.show([`HEAD:${oldFilepath}`]),
      git.show([`:${nodeFile.filepath}`]),
    ])

    if (headContent !== indexContent) {
      result = createTwoFilesPatch(
        oldFilepath,
        nodeFile.filepath,
        headContent,
        indexContent,
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
    logger.verbose(`Error comparing file contents for ${nodeFile.filepath}`, { color: 'red' })
    result = 'Error comparing file contents.'
  }
  return result
}

export const getDiff = async (
  nodeFile: FileChange,
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

  if (nodeFile.status === 'renamed' && nodeFile.oldFilepath) {
    const renamedDiff = await parseRenamedFileDiff(nodeFile, git, logger)
    return renamedDiff
  }

  // If not deleted or renamed, get the diff from the index
  const defaultDiff = await parseDefaultFileDiff(nodeFile, git)
  return defaultDiff
}
