import { DiffNode, FileChange } from '../../../types'
import { Logger } from '../../../utils/logger'
import { DiffTreeNode } from './createDiffTree'
import { TokenCounter } from '../../../utils/tokenizer'

type Limit = <T>(operation: () => Promise<T>) => Promise<T>

function createLimit(maxConcurrent: number): Limit {
  const limit = Math.max(1, maxConcurrent)
  let active = 0
  const queue: (() => void)[] = []

  const runNext = () => {
    active--
    const next = queue.shift()
    if (next) next()
  }

  return async <T>(operation: () => Promise<T>): Promise<T> => {
    if (active >= limit) {
      await new Promise<void>((resolve) => queue.push(resolve))
    }

    active++

    try {
      return await operation()
    } finally {
      runNext()
    }
  }
}

/**
 * Asynchronously collect diffs for a given node and its children.
 */
export async function collectDiffs(
  node: DiffTreeNode,
  getFileDiff: (change: FileChange) => Promise<string>,
  tokenizer: TokenCounter,
  logger: Logger,
  maxConcurrent = 6,
  limit: Limit = createLimit(maxConcurrent)
): Promise<DiffNode> {
  // Collect diffs for the files of the current node
  const diffPromises = node.files.map((nodeFile) => limit(async () => {
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
  }))

  // Collect diffs for the children of the current node
  const childrenPromises = Array.from(node.children.values()).map(async (child) =>
    collectDiffs(child, getFileDiff, tokenizer, logger, maxConcurrent, limit)
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
