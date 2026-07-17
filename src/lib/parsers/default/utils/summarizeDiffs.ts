import { DirectoryDiff, DiffNode } from '../../../types'
import { Logger } from '../../../utils/logger'
import { getPathFromFilePath } from '../../../utils/getPathFromFilePath'
import { SummarizeContext, summarize } from '../../../langchain/chains/summarize'
import { SUMMARIZE_PROMPT_HASH } from '../../../langchain/chains/summarize/prompt'
import { TokenCounter } from '../../../utils/tokenizer'
import {
  diffSummaryKey,
  readDiffSummary,
  resolveDiffSummaryCacheRepoPath,
  touchDiffSummary,
  writeDiffSummary,
} from './diffSummaryCache'
import { preprocessLargeFiles } from './summarizeLargeFiles'

/**
 * Cache opt-out: COCO_NO_CACHE=1 disables both reads and writes
 * for the diff-summary cache (#845, PR 5). Default is enabled.
 */
function isCacheEnabled(): boolean {
  return !process.env.COCO_NO_CACHE || process.env.COCO_NO_CACHE === '0'
}

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
  logger?: Logger
} & SummarizeContext

/**
 * Summarize a directory diff asynchronously.
 */
export async function summarizeDirectoryDiff(
  directory: DirectoryDiff,
  { chain, textSplitter, tokenizer, logger, metadata }: SummarizeDirectoryDiffOptions
): Promise<DirectoryDiff> {
  // Cache lookup (#845, PR 5). Joined per-file diffs become the
  // payload signature; if every file in the directory is unchanged
  // since the last run (and the model + prompt match), the prior
  // directory-level summary is reused instead of paying for another
  // map_reduce pass.
  const cacheModel = typeof metadata?.model === 'string' ? metadata.model : undefined
  const cacheRepo = resolveDiffSummaryCacheRepoPath()
  const cachePayload = directory.diffs
    .map((diff) => `${diff.file}\x1e${diff.diff}`)
    .join('\x1d')
  const cacheKey = isCacheEnabled() && cacheModel
    ? diffSummaryKey(cachePayload, cacheModel, SUMMARIZE_PROMPT_HASH)
    : undefined

  if (cacheKey) {
    const cached = readDiffSummary(cacheRepo, cacheKey)
    if (cached) {
      logger?.verbose?.(
        ` • Cache hit for "/${directory.path}" (skipped LLM, ${cached.tokens} tokens)`,
        { color: 'cyan' }
      )
      touchDiffSummary(cacheRepo, cacheKey)
      return {
        diffs: directory.diffs,
        path: directory.path,
        summary: cached.summary,
        tokenCount: cached.tokens,
      }
    }
  }

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
        tokenizer,
        logger,
        metadata: {
          ...metadata,
          task: 'summarize-directory-diff',
        },
        options: {
          returnIntermediateSteps: true,
        },
      }
    )

    const newTokenTotal = tokenizer(directorySummary)

    if (cacheKey && cacheModel && directorySummary.trim()) {
      writeDiffSummary(cacheRepo, cacheKey, {
        summary: directorySummary,
        model: cacheModel,
        tokens: newTokenTotal,
      })
    }

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
 * Separator marking the start of each directory block in the rendered
 * summary. Consumers (e.g. `enforcePromptBudget`) split on this to trim
 * whole directory blocks instead of slicing through arbitrary characters.
 */
export const DIRECTORY_BLOCK_SEPARATOR = '\n-------\n'

/**
 * Prefix marking a per-file bullet line within a directory block.
 */
export const FILE_BULLET_PREFIX = ' • '

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
  let output = `${DIRECTORY_BLOCK_SEPARATOR}* changes in "/${group.path}"\n\n`

  if (group.summary) {
    output += `${group.diffs.map((diff) => `${FILE_BULLET_PREFIX}${diff.summary}`).join('\n')}\n\nSummary:\n\n${
      group.summary
    }\n\n`
  } else {
    output += `${group.diffs.map((diff) => `${FILE_BULLET_PREFIX}${diff.summary}\n\n${diff.diff}`).join('\n\n')}\n\n`
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
  /**
   * Opt-in fast paths that trade summary detail for speed. Forwarded
   * to `preprocessLargeFiles`; off by default.
   */
  fastPath?: {
    markdown?: boolean
    languageAware?: {
      enabled?: boolean
      languages?: (
        | 'ts'
        | 'js'
        | 'py'
        | 'rs'
        | 'go'
        | 'java'
        | 'cpp'
        | 'cs'
        | 'rb'
        | 'php'
        | 'kt'
        | 'swift'
        | 'lua'
        | 'bash'
      )[]
    }
  }
  handleOutput?: typeof defaultOutputCallback
} & SummarizeContext

/**
 * Continuous-queue scheduler for the directory summarization pass
 * (#845, PR 4). The previous wave-by-wave Promise.all forced the
 * scheduler to wait for the slowest call in a wave before starting
 * the next wave; on a fixture like `refactor` (20 directories, mixed
 * sizes) one big directory could pin the wave at ~its own latency
 * even though the other 19 calls finished long before.
 *
 * The continuous queue dispatches all eligible directories through
 * a `createLimit(maxConcurrent)` semaphore — same primitive
 * `collectDiffs` already uses. As soon as any in-flight summary
 * resolves, the next eligible directory takes its slot. Each
 * scheduled call also re-checks the budget at the moment it would
 * fire; if the budget is already met (because earlier completions
 * dropped the total under maxTokens), it returns the original
 * directory without an LLM call. So the work scales with what's
 * actually needed, not with the worst-case wave count.
 *
 * Order discipline is preserved: directories are sorted by token
 * count descending and dispatched in that order. The biggest
 * candidates land in the first batch of in-flight calls; as smaller
 * candidates reach the queue front, the budget is more likely to
 * already be met and they short-circuit.
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
    metadata,
  } = options

  let totalTokenCount = initialTotal
  const results = [...directories]

  // Pick eligible directories upfront, sorted big-first.
  const eligibleIndices = directories
    .map((d, i) => ({ index: i, tokens: d.tokenCount }))
    .filter((entry) => entry.tokens >= minTokensForSummary && !results[entry.index].summary)
    .sort((a, b) => b.tokens - a.tokens)
    .map((entry) => entry.index)

  if (eligibleIndices.length === 0 || totalTokenCount <= maxTokens) {
    return { directories: results, totalTokenCount }
  }

  const limit = createLimit(maxConcurrent)
  logger.verbose(
    `\nProcessing ${eligibleIndices.length} directories with continuous queue (concurrency ${maxConcurrent})...`,
    { color: 'blue' }
  )

  await Promise.all(
    eligibleIndices.map((idx) =>
      limit(async () => {
        // Re-check the budget at dispatch time. Earlier completions
        // may have already dropped the total under the cap; in that
        // case skip the LLM call entirely.
        if (totalTokenCount <= maxTokens) {
          return
        }
        const result = await summarizeDirectoryDiff(results[idx], {
          chain,
          textSplitter,
          tokenizer,
          logger,
          metadata,
        })
        const originalTokens = results[idx].tokenCount
        const newTokens = result.tokenCount
        totalTokenCount -= (originalTokens - newTokens)
        results[idx] = result
        logger.verbose(` • Summarized "/${result.path}": ${originalTokens} -> ${newTokens} tokens`, {
          color: 'magenta',
        })
      })
    )
  )

  logger.verbose(`Total token count after continuous queue: ${totalTokenCount}`, {
    color: totalTokenCount > maxTokens ? 'yellow' : 'green',
  })

  return { directories: results, totalTokenCount }
}

/**
 * Tiny semaphore mirroring `collectDiffs.createLimit` (kept private
 * here to avoid a cross-module import for one helper). Schedules at
 * most `maxConcurrent` operations concurrently; the rest queue FIFO.
 */
function createLimit(maxConcurrent: number) {
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
    // Default raised to 4096 (#845) so the budget matches the
    // canonical service configs in `langchain/utils.ts`. The
    // previous 2048 default came from an earlier era when 4k
    // context was a stretch for fast models; today every shipped
    // service overrides it to 4096 anyway. Keeping this in sync
    // with the service defaults means a caller that omits
    // `maxTokens` doesn't accidentally fall into a tighter budget
    // than the rest of the system assumes.
    maxTokens = 4096,
    minTokensForSummary = 400,
    maxFileTokens,
    maxConcurrent = 6,
    fastPath,
    textSplitter,
    chain,
    metadata,
    handleOutput = defaultOutputCallback,
  }: SummarizeDiffsOptions
): Promise<string> {
  // Calculate maxFileTokens as 25% of maxTokens if not specified
  const effectiveMaxFileTokens = maxFileTokens ?? Math.floor(maxTokens * 0.25)

  // PHASE 1: Directory grouping & assessment
  logger.startTimer().startSpinner(`Organizing Diffs...`, { color: 'blue' })
  let directoryDiffs = createDirectoryDiffs(rootDiffNode)

  // Sort by token count descending for consistent output ordering
  directoryDiffs.sort((a, b) => b.tokenCount - a.tokenCount)

  let totalTokenCount = directoryDiffs.reduce((sum, group) => sum + group.tokenCount, 0)

  logger.stopSpinner('Diffs Organized').stopTimer()

  logger.verbose(`Total token count: ${totalTokenCount}, max allowed: ${maxTokens}`, {
    color: totalTokenCount > maxTokens ? 'yellow' : 'green',
  })

  // Early exit if already under budget
  if (totalTokenCount <= maxTokens) {
    logger.verbose(`Already under token budget, skipping summarization.`, { color: 'green' })
    return directoryDiffs.map(handleOutput).join('')
  }

  // PHASE 2: Pre-process large files only when the raw diff is over budget
  logger.startTimer().startSpinner(`Pre-processing large files...`, { color: 'blue' })

  const preprocessedNode = await preprocessLargeFiles(rootDiffNode, {
    maxFileTokens: effectiveMaxFileTokens,
    minTokensForSummary,
    maxConcurrent,
    // #861, PR 1: pass the overall budget so Phase 2 can short-circuit
    // once earlier completions drop the running total under the cap.
    maxTokens,
    // #861, angle 5: opt-in markdown fast path. Off by default; when
    // enabled, markdown modification diffs with structural signals
    // resolve via a templated extract instead of an LLM call.
    fastPath,
    tokenizer,
    logger,
    chain,
    textSplitter,
    metadata,
  })

  logger.stopSpinner('Files pre-processed').stopTimer()

  directoryDiffs = createDirectoryDiffs(preprocessedNode)
  directoryDiffs.sort((a, b) => b.tokenCount - a.tokenCount)
  totalTokenCount = directoryDiffs.reduce((sum, group) => sum + group.tokenCount, 0)

  logger.verbose(`Total token count after file pre-processing: ${totalTokenCount}`, {
    color: totalTokenCount > maxTokens ? 'yellow' : 'green',
  })

  if (totalTokenCount <= maxTokens) {
    logger.verbose(`Under token budget after file pre-processing.`, { color: 'green' })
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
    metadata,
  })

  logger.stopSpinner(`Diffs Consolidated`).stopTimer()

  return summarizedDiffs.map(handleOutput).join('')
}
