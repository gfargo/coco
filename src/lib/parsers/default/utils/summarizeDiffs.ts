import { DirectoryDiff, DiffNode } from '../../../types'
import { Logger } from '../../../utils/logger'
import { getPathFromFilePath } from '../../../utils/getPathFromFilePath'
import { SummarizeContext, summarize } from '../../../langchain/chains/summarize'
import { TokenCounter } from '../../../utils/tokenizer'
import { preprocessLargeFiles } from './summarizeLargeFiles'

/**
 * Create groups from a given node info.
 * @param {DiffNode} node - The node info to start grouping.
 * @returns {DirectoryDiff[]} The groups created.
 */
export function createDirectoryDiffs(node: DiffNode): DirectoryDiff[] {
  const groupByPath: Record<string, DirectoryDiff> = {}

  function traverse(node: DiffNode) {
    node.diffs.forEach((diff) => {
      const path = getPathFromFilePath(diff.file)
      if (!groupByPath[path]) {
        groupByPath[path] = { diffs: [], path, tokenCount: 0 }
      }
      groupByPath[path].diffs.push(diff)
      groupByPath[path].tokenCount += diff.tokenCount
    })

    node.children.forEach(traverse)
  }

  traverse(node)
  return Object.values(groupByPath)
}

type SummarizeDirectoryDiffOptions = {
  tokenizer: TokenCounter
} & SummarizeContext

/**
 * Summarize a directory diff asynchronously.
 */
export async function summarizeDirectoryDiff(
  directory: DirectoryDiff,
  { chain, textSplitter, tokenizer }: SummarizeDirectoryDiffOptions
): Promise<DirectoryDiff> {
  try {
    const directorySummary = await summarize(
      directory.diffs.map((diff) => ({
        pageContent: diff.diff,
        metadata: {
          file: diff.file,
          summary: diff.summary,
        },
      })),
      {
        chain,
        textSplitter,
        options: {
          returnIntermediateSteps: true,
        },
      }
    )

    const newTokenTotal = tokenizer(directorySummary)

    return {
      diffs: directory.diffs,
      path: directory.path,
      summary: directorySummary,
      tokenCount: newTokenTotal,
    }
  } catch (error) {
    console.error(error)
    return directory
  }
}

/**
 * Default output formatter for directory diffs.
 *
 * TODO: Future improvements to consider:
 * - Hierarchical output showing file -> directory -> overall summary
 * - Configurable verbosity levels (compact, standard, detailed)
 * - Machine-readable format option (JSON) for programmatic use
 * - Semantic grouping by change type (added/modified/deleted) or feature area
 * - Visual diff indicators showing magnitude of changes
 */
const defaultOutputCallback = (group: DirectoryDiff) => {
  let output = `
-------\n* changes in "/${group.path}"\n\n`

  if (group.summary) {
    output += `${group.diffs.map((diff) => ` • ${diff.summary}`).join('\n')}\n\nSummary:\n\n${
      group.summary
    }\n\n`
  } else {
    output += `${group.diffs.map((diff) => ` • ${diff.summary}\n\n${diff.diff}`).join('\n\n')}\n\n`
  }

  return output
}

export type SummarizeDiffsOptions = {
  tokenizer: TokenCounter
  logger: Logger
  maxTokens: number
  /**
   * Minimum token count for a directory group to be eligible for summarization.
   * @default 400
   */
  minTokensForSummary?: number
  /**
   * Maximum tokens for a single file before pre-summarization.
   * Defaults to 25% of maxTokens if not specified.
   */
  maxFileTokens?: number
  /**
   * Maximum concurrent summarization requests per wave.
   * @default 6
   */
  maxConcurrent?: number
  handleOutput?: typeof defaultOutputCallback
} & SummarizeContext

/**
 * Process directory summarization in waves to respect concurrency limits
 * while maintaining predictable behavior.
 */
async function summarizeInWaves(
  directories: DirectoryDiff[],
  options: {
    totalTokenCount: number
    maxTokens: number
    minTokensForSummary: number
    maxConcurrent: number
    logger: Logger
  } & SummarizeDirectoryDiffOptions
): Promise<{ directories: DirectoryDiff[]; totalTokenCount: number }> {
  const {
    totalTokenCount: initialTotal,
    maxTokens,
    minTokensForSummary,
    maxConcurrent,
    logger,
    chain,
    textSplitter,
    tokenizer,
  } = options

  let totalTokenCount = initialTotal
  const results = [...directories]

  // Create sorted indices by token count (descending) for prioritized processing
  const sortedIndices = directories
    .map((d, i) => ({ index: i, tokens: d.tokenCount }))
    .sort((a, b) => b.tokens - a.tokens)

  let cursor = 0

  while (totalTokenCount > maxTokens && cursor < sortedIndices.length) {
    // Select wave candidates: directories that exceed minTokensForSummary
    const wave: number[] = []

    for (let i = cursor; i < sortedIndices.length && wave.length < maxConcurrent; i++) {
      const { index, tokens } = sortedIndices[i]

      // Skip directories below the minimum threshold
      if (tokens < minTokensForSummary) {
        cursor = i + 1
        continue
      }

      // Skip directories that have already been summarized
      if (results[index].summary) {
        cursor = i + 1
        continue
      }

      wave.push(index)
      cursor = i + 1
    }

    // No more eligible candidates
    if (wave.length === 0) {
      break
    }

    logger.verbose(`\nProcessing wave of ${wave.length} directories...`, { color: 'blue' })

    // Process wave in parallel
    const waveResults = await Promise.all(
      wave.map((idx) =>
        summarizeDirectoryDiff(results[idx], { chain, textSplitter, tokenizer })
      )
    )

    // Update results and recalculate total
    waveResults.forEach((result, i) => {
      const idx = wave[i]
      const originalTokens = results[idx].tokenCount
      const newTokens = result.tokenCount
      const reduction = originalTokens - newTokens

      totalTokenCount -= reduction
      results[idx] = result

      logger.verbose(` • Summarized "/${result.path}": ${originalTokens} -> ${newTokens} tokens`, {
        color: 'magenta',
      })
    })

    logger.verbose(`Total token count: ${totalTokenCount}`, {
      color: totalTokenCount > maxTokens ? 'yellow' : 'green',
    })

    // Check if we're now under budget
    if (totalTokenCount <= maxTokens) {
      logger.verbose(`Under token budget, stopping summarization.`, { color: 'green' })
      break
    }
  }

  return { directories: results, totalTokenCount }
}

/**
 * Summarize diffs using a three-phase approach:
 *
 * Phase 1: Pre-process large files to prevent any single file from dominating
 * Phase 2: Group diffs by directory and assess total token count
 * Phase 3: Wave-based parallel summarization until under budget
 *
 * This approach ensures:
 * - Large files don't bias the summary
 * - Small changes preserve their detail (minTokensForSummary threshold)
 * - Efficient parallel processing with predictable behavior
 * - Early exit when under token budget
 */
export async function summarizeDiffs(
  rootDiffNode: DiffNode,
  {
    tokenizer,
    logger,
    maxTokens = 2048,
    minTokensForSummary = 400,
    maxFileTokens,
    maxConcurrent = 6,
    textSplitter,
    chain,
    handleOutput = defaultOutputCallback,
  }: SummarizeDiffsOptions
): Promise<string> {
  // Calculate maxFileTokens as 25% of maxTokens if not specified
  const effectiveMaxFileTokens = maxFileTokens ?? Math.floor(maxTokens * 0.25)

  // PHASE 1: Pre-process large files
  logger.startTimer().startSpinner(`Pre-processing large files...`, { color: 'blue' })

  const preprocessedNode = await preprocessLargeFiles(rootDiffNode, {
    maxFileTokens: effectiveMaxFileTokens,
    minTokensForSummary,
    maxConcurrent,
    tokenizer,
    logger,
    chain,
    textSplitter,
  })

  logger.stopSpinner('Files pre-processed').stopTimer()

  // PHASE 2: Directory grouping & assessment
  logger.startTimer().startSpinner(`Organizing Diffs...`, { color: 'blue' })
  const directoryDiffs = createDirectoryDiffs(preprocessedNode)

  // Sort by token count descending for consistent output ordering
  directoryDiffs.sort((a, b) => b.tokenCount - a.tokenCount)

  const totalTokenCount = directoryDiffs.reduce((sum, group) => sum + group.tokenCount, 0)

  logger.stopSpinner('Diffs Organized').stopTimer()

  logger.verbose(`Total token count: ${totalTokenCount}, max allowed: ${maxTokens}`, {
    color: totalTokenCount > maxTokens ? 'yellow' : 'green',
  })

  // Early exit if already under budget
  if (totalTokenCount <= maxTokens) {
    logger.verbose(`Already under token budget, skipping summarization.`, { color: 'green' })
    return directoryDiffs.map(handleOutput).join('')
  }

  // PHASE 3: Wave-based summarization
  logger.startTimer().startSpinner(`Consolidating Diffs...`, { color: 'blue' })

  const { directories: summarizedDiffs } = await summarizeInWaves(directoryDiffs, {
    totalTokenCount,
    maxTokens,
    minTokensForSummary,
    maxConcurrent,
    logger,
    chain,
    textSplitter,
    tokenizer,
  })

  logger.stopSpinner(`Diffs Consolidated`).stopTimer()

  return summarizedDiffs.map(handleOutput).join('')
}
