import { DiffNode, FileChange } from '../../../types'
import { Logger } from '../../../utils/logger'
import { DiffTreeNode } from './createDiffTree'
import { TokenCounter } from '../../../utils/tokenizer'

/**
 * Asynchronously collect diffs for a given node and its children.
 */
export async function collectDiffs(
  node: DiffTreeNode,
  getFileDiff: (change: FileChange) => Promise<string>,
  tokenizer: TokenCounter,
  logger: Logger
): Promise<DiffNode> {
  // Collect diffs for the files of the current node
  const diffPromises = node.files.map(async (nodeFile) => {
    const diff = await getFileDiff(nodeFile)
    const tokenCount = tokenizer(diff)

    logger.verbose(`Collected diff for ${nodeFile.filePath} (${tokenCount} tokens)`, {
      color: 'magenta',
    })

    return {
      file: nodeFile.filePath,
      summary: nodeFile.summary,
      diff,
      tokenCount,
    }
  })

  // Collect diffs for the children of the current node
  const childrenPromises = Array.from(node.children.values()).map(async (child) =>
    collectDiffs(child, getFileDiff, tokenizer, logger)
  )

  const [diffs, children] = await Promise.all([
    Promise.all(diffPromises),
    Promise.all(childrenPromises),
  ])

  return {
    path: node.getPath(),
    diffs,
    children,
  }
}
