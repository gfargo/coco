import { FileDiff, DiffNode } from '../../../types'
import { SummarizeContext, summarize } from '../../../langchain/chains/summarize'
import { TokenCounter } from '../../../utils/tokenizer'
import { Logger } from '../../../utils/logger'

export type SummarizeLargeFilesOptions = {
  /**
   * Maximum tokens allowed for a single file before it gets pre-summarized.
   */
  maxFileTokens: number
  /**
   * Minimum token count for a file to be eligible for summarization.
   */
  minTokensForSummary: number
  /**
   * Maximum number of concurrent summarization requests.
   */
  maxConcurrent: number
  tokenizer: TokenCounter
  logger: Logger
} & SummarizeContext

/**
 * Summarize a single file diff that exceeds the token threshold.
 */
async function summarizeFileDiff(
  fileDiff: FileDiff,
  { chain, textSplitter, tokenizer }: Pick<SummarizeLargeFilesOptions, 'chain' | 'textSplitter' | 'tokenizer'>
): Promise<FileDiff> {
  try {
    const fileSummary = await summarize(
      [
        {
          pageContent: fileDiff.diff,
          metadata: {
            file: fileDiff.file,
            summary: fileDiff.summary,
          },
        },
      ],
      {
        chain,
        textSplitter,
        options: {
          returnIntermediateSteps: false,
        },
      }
    )

    const newTokenCount = tokenizer(fileSummary)

    return {
      ...fileDiff,
      diff: fileSummary,
      tokenCount: newTokenCount,
    }
  } catch (error) {
    // On error, return original diff unchanged
    console.error(`Failed to summarize file ${fileDiff.file}:`, error)
    return fileDiff
  }
}

/**
 * Process files in waves to respect concurrency limits.
 */
async function processInWaves<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  maxConcurrent: number
): Promise<R[]> {
  const results: R[] = []

  for (let i = 0; i < items.length; i += maxConcurrent) {
    const wave = items.slice(i, i + maxConcurrent)
    const waveResults = await Promise.all(wave.map(processor))
    results.push(...waveResults)
  }

  return results
}

/**
 * Pre-summarize individual files that exceed the maxFileTokens threshold.
 * This prevents large files from dominating the token budget and biasing
 * the final commit message toward a single file's changes.
 *
 * @param diffs - Array of file diffs to process
 * @param options - Configuration options for summarization
 * @returns Array of file diffs with large files summarized
 */
export async function summarizeLargeFiles(
  diffs: FileDiff[],
  options: SummarizeLargeFilesOptions
): Promise<FileDiff[]> {
  const { maxFileTokens, minTokensForSummary, maxConcurrent, tokenizer, logger, chain, textSplitter } =
    options

  // Identify files that need summarization
  const filesToSummarize: { index: number; diff: FileDiff }[] = []
  const results = [...diffs]

  diffs.forEach((diff, index) => {
    if (diff.tokenCount > maxFileTokens && diff.tokenCount >= minTokensForSummary) {
      filesToSummarize.push({ index, diff })
    }
  })

  if (filesToSummarize.length === 0) {
    return results
  }

  logger.verbose(`Pre-summarizing ${filesToSummarize.length} large file(s)...`, { color: 'blue' })

  // Process large files in waves
  const summarizedFiles = await processInWaves(
    filesToSummarize,
    async ({ diff }) => summarizeFileDiff(diff, { chain, textSplitter, tokenizer }),
    maxConcurrent
  )

  // Update results with summarized files
  summarizedFiles.forEach((summarizedDiff, i) => {
    const originalIndex = filesToSummarize[i].index
    const originalTokens = results[originalIndex].tokenCount
    const newTokens = summarizedDiff.tokenCount

    logger.verbose(
      ` - ${summarizedDiff.file}: ${originalTokens} -> ${newTokens} tokens`,
      { color: 'magenta' }
    )

    results[originalIndex] = summarizedDiff
  })

  return results
}

/**
 * Pre-process a DiffNode tree, summarizing large files at the leaf level.
 * Returns a new DiffNode with updated token counts.
 */
export async function preprocessLargeFiles(
  rootNode: DiffNode,
  options: SummarizeLargeFilesOptions
): Promise<DiffNode> {
  // Collect all diffs from the tree
  const allDiffs: FileDiff[] = []

  function collectDiffs(node: DiffNode) {
    allDiffs.push(...node.diffs)
    node.children.forEach(collectDiffs)
  }

  collectDiffs(rootNode)

  // Summarize large files
  const processedDiffs = await summarizeLargeFiles(allDiffs, options)

  // Create a map for quick lookup
  const diffMap = new Map<string, FileDiff>()
  processedDiffs.forEach((diff) => diffMap.set(diff.file, diff))

  // Rebuild tree with processed diffs
  function rebuildNode(node: DiffNode): DiffNode {
    return {
      path: node.path,
      diffs: node.diffs.map((diff) => diffMap.get(diff.file) || diff),
      children: node.children.map(rebuildNode),
    }
  }

  return rebuildNode(rootNode)
}
