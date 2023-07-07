import { Repository, Diff, Blob, Tree, Index } from 'nodegit'
import { createTwoFilesPatch } from 'diff'

import { FileChange } from '../types'
import { readFile } from '../utils/readFile'
import { Logger } from '../utils/logger'

const parseDefaultFileDiff = async (
  nodeFile: FileChange,
  repo: Repository,
  headTree: Tree,
  index: Index,
): Promise<string> => {
  let result = ''
  
  const diff = await Diff.treeToIndex(repo, headTree, index, {
    flags: Diff.OPTION.SHOW_UNTRACKED_CONTENT | Diff.OPTION.RECURSE_UNTRACKED_DIRS,
    pathspec: nodeFile.filepath,
  });

  const patches = await diff.patches()

  for (const patch of patches) {
    const hunks = await patch.hunks()
    for (const hunk of hunks) {
      const lines = await hunk.lines()
      result += lines.map((line) => String.fromCharCode(line.origin()) + line.content()).join('')
    }
  }

  return result
}

const parseRenamedFileDiff = async (
  nodeFile: FileChange,
  repo: Repository,
  headTree: Tree,
  index: Index,
  logger: Logger
): Promise<string> => {
  let result = ''
  const oldFilepath = nodeFile?.oldFilepath || nodeFile.filepath

  try {
    const headEntry = await headTree.entryByPath(oldFilepath) // use old name to look up in latest commit
    const indexEntry = index.getByPath(nodeFile.filepath) // use new name to look up in index

    // Compare the file contents in the latest commit and index
    const headBlob = await Blob.lookup(repo, headEntry.sha())
    const indexBlobContent = await readFile(indexEntry.path) // read file from filesystem
    const headContent = headBlob.content().toString()
    const indexContent = indexBlobContent.toString()

    if (headContent !== indexContent) {
      result = createTwoFilesPatch(
        oldFilepath,
        nodeFile.filepath,
        headContent,
        indexContent,
        '',
        '',
        { context: 3 }
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

export const parseFileDiff = async (
  nodeFile: FileChange,
  repo: Repository,
  headTree: Tree,
  index: Index,
  logger: Logger
): Promise<string> => {
  if (nodeFile.status === 'deleted') {
    return 'This file has been deleted.'
  }

  if (nodeFile.status === 'renamed' && nodeFile.oldFilepath) {
    return parseRenamedFileDiff(nodeFile, repo, headTree, index, logger)
  }

  // If not deleted or renamed, get the diff from the index
  return parseDefaultFileDiff(nodeFile, repo, headTree, index)
}
