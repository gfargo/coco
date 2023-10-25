import GPT3Tokenizer from 'gpt3-tokenizer'
import { DiffNode, FileChange } from '../../../types'
import { Logger } from '../../../utils/logger'
import { DiffTreeNode } from './createDiffTree'

/**
 * Asynchronously collect diffs for a given node and its children.
 */
export async function collectDiffs(
  node: DiffTreeNode,
  getFileDiff: (change: FileChange) => Promise<string>,
  tokenizer: GPT3Tokenizer,
  logger: Logger
): Promise<DiffNode> {
  // Collect diffs for the files of the current node
  const diffPromises = node.files.map(async (nodeFile) => {
    const diff = await getFileDiff(nodeFile)
    
    // TODO: Swap out the GPT3Tokenizer for LangChain tokenizer
    const tokenizedDiff = tokenizer.encode(diff).text
    const tokenCount = tokenizedDiff.length

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
