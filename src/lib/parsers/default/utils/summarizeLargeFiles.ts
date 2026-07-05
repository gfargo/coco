import { FileDiff, DiffNode } from '../../../types'
import { SummarizeContext, summarize } from '../../../langchain/chains/summarize'
import { SUMMARIZE_PROMPT_HASH } from '../../../langchain/chains/summarize/prompt'
import { TokenCounter } from '../../../utils/tokenizer'
import { Logger } from '../../../utils/logger'
import {
  diffSummaryKey,
  readDiffSummary,
  resolveDiffSummaryCacheRepoPath,
  touchDiffSummary,
  writeDiffSummary,
} from './diffSummaryCache'
import { summarizeMarkdownDiff } from './markdownDiff'
import { isBashFile } from './bashStructuralDiff'
import { isCppFile } from './cppStructuralDiff'
import { isCsFile } from './csStructuralDiff'
import { isGoFile } from './goStructuralDiff'
import { isJavaFile } from './javaStructuralDiff'
import { isKotlinFile } from './ktStructuralDiff'
import { isLuaFile } from './luaStructuralDiff'
import { isPhpFile } from './phpStructuralDiff'
import { isPythonFile } from './pythonStructuralDiff'
import { isRubyFile } from './rbStructuralDiff'
import { isRustFile } from './rustStructuralDiff'
import { isSwiftFile } from './swiftStructuralDiff'
import {
  dispatchStructuralParser,
  hasTreeSitterParser,
  type StructuralLanguageId,
} from './structuralParserRegistry'
import { detectTsLanguage } from './tsStructuralDiff'
import { summarizeTrivialDiff } from './trivialDiff'

/**
 * Map a file path to the language identifier used by the
 * `service.fastPath.languageAware` config knob and the parser
 * registry. Adding a new language: append the identifier to the
 * union (mirrored in `lib/langchain/types.ts` for schema
 * generation) and register a parser chain entry in
 * `structuralParserRegistry.ts`.
 */
function detectStructuralLanguageId(path: string): StructuralLanguageId | undefined {
  const ts = detectTsLanguage(path)
  if (ts) return ts
  if (isPythonFile(path)) return 'py'
  if (isRustFile(path)) return 'rs'
  if (isGoFile(path)) return 'go'
  if (isJavaFile(path)) return 'java'
  if (isCppFile(path)) return 'cpp'
  if (isCsFile(path)) return 'cs'
  if (isRubyFile(path)) return 'rb'
  if (isPhpFile(path)) return 'php'
  if (isKotlinFile(path)) return 'kt'
  if (isSwiftFile(path)) return 'swift'
  if (isLuaFile(path)) return 'lua'
  if (isBashFile(path)) return 'bash'
  return undefined
}

/**
 * Cache opt-out: COCO_NO_CACHE=1 disables both reads and writes
 * for the diff-summary cache (#845, PR 5). Default is enabled.
 */
function isCacheEnabled(): boolean {
  return !process.env.COCO_NO_CACHE || process.env.COCO_NO_CACHE === '0'
}

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
  /**
   * Total token budget across all diffs. When provided, Phase 2 dispatches
   * eligible files biggest-first and re-checks the running total per
   * dispatch — once earlier completions drop the total under `maxTokens`,
   * the remaining files keep their raw diffs (#861, PR 1). When undefined,
   * every eligible file is summarized regardless of budget.
   */
  maxTokens?: number
  /**
   * Opt-in fast paths that trade summary detail for speed. Off by
   * default; the markdown skip only fires when `fastPath.markdown` is
   * true (#861, angle 5).
   */
  fastPath?: {
    markdown?: boolean
    /**
     * Language-aware structural extract (#883). When enabled for a
     * given language, modification diffs to source files in that
     * language render as a templated symbol-level summary
     * ("added parseRequest(); removed legacyParse()") instead of
     * going through the LLM. Off by default — lossy by design and
     * quality is harder to validate than the markdown fast path,
     * so we don't enable it without explicit opt-in.
     */
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
  tokenizer: TokenCounter
  logger: Logger
} & SummarizeContext

/**
 * Summarize a single file diff that exceeds the token threshold.
 *
 * Trivial-shape short-circuit (#845, PR 2): pure additions / deletions
 * / renames / binary changes have no information content beyond the
 * diff's shape, so we templated-summarize them instead of paying for
 * an LLM call. On initial-commit fixtures (lots of pure adds) this
 * collapses the per-file summary phase entirely; the resulting tiny
 * synthetic summaries usually drop the directory token totals under
 * budget so wave consolidation skips too.
 */
async function summarizeFileDiff(
  fileDiff: FileDiff,
  {
    chain,
    textSplitter,
    tokenizer,
    logger,
    metadata,
    fastPath,
  }: Pick<
    SummarizeLargeFilesOptions,
    'chain' | 'textSplitter' | 'tokenizer' | 'logger' | 'metadata' | 'fastPath'
  >
): Promise<FileDiff> {
  const trivialSummary = summarizeTrivialDiff(fileDiff)
  if (trivialSummary !== undefined) {
    logger.verbose(
      ` - ${fileDiff.file}: trivial-shape skip (no LLM call)`,
      { color: 'gray' }
    )
    return {
      ...fileDiff,
      diff: trivialSummary,
      tokenCount: tokenizer(trivialSummary),
    }
  }

  // Markdown fast path (#861, angle 5). Opt-in via `fastPath.markdown`
  // because it's a lossy optimization: the templated summary names
  // structural changes only and drops body-text detail that an LLM
  // summary would carry. Off by default; users who prefer summary
  // fidelity over speed (which is the safer default for commit-message
  // generation downstream) keep the LLM path. When the flag IS on, the
  // fast path still falls through to the LLM for paragraph-only edits
  // where a templated summary would lose useful context.
  if (fastPath?.markdown) {
    const markdownSummary = summarizeMarkdownDiff(fileDiff)
    if (markdownSummary !== undefined) {
      logger.verbose(
        ` - ${fileDiff.file}: markdown fast-path skip (no LLM call)`,
        { color: 'gray' }
      )
      return {
        ...fileDiff,
        diff: markdownSummary,
        tokenCount: tokenizer(markdownSummary),
      }
    }
  }

  // Language-aware structural fast path (#883, phase 1). Same
  // contract as the markdown skip: opt-in only, falls through to
  // the LLM when the diff has no top-level structural signal, and
  // emits a templated summary when it does. Currently covers TS/JS
  // via regex extraction; richer (tree-sitter-backed) languages
  // arrive in follow-up PRs.
  if (fastPath?.languageAware?.enabled) {
    const language = detectStructuralLanguageId(fileDiff.file)
    const allowed = fastPath.languageAware.languages
    const languageEnabled = language !== undefined &&
      (!allowed || allowed.length === 0 || allowed.includes(language))
    if (languageEnabled) {
      const structuralSummary = await dispatchStructuralParser(language, fileDiff)
      if (structuralSummary !== undefined) {
        logger.verbose(
          ` - ${fileDiff.file}: language-aware fast-path skip (no LLM call)`,
          { color: 'gray' }
        )
        return {
          ...fileDiff,
          diff: structuralSummary,
          tokenCount: tokenizer(structuralSummary),
        }
      }
      // Surrender telemetry (#933 phase 7). When the chain INCLUDES
      // a tree-sitter parser but it surrendered (cache empty, AST
      // unrecognized, dynamic import failed), emit a discoverability
      // hint. Lazy-loaded languages benefit most from this — users
      // who haven't run `coco cache prefetch <lang>` see the nudge
      // and know how to enable the better extractor. Bundled
      // languages (ts/tsx) hit this branch too when the AST didn't
      // recognize the diff shape; the hint is harmless there.
      if (hasTreeSitterParser(language)) {
        logger.verbose(
          ` - ${fileDiff.file}: tree-sitter parser surrendered for '${language}'; using regex fallback. ` +
          `Hint: \`coco cache parsers\` to inspect, \`coco cache prefetch ${language === 'ts' || language === 'js' ? 'all' : language}\` to enable.`,
          { color: 'gray' }
        )
      }
    }
  }

  // Cache lookup (#845, PR 5). Keyed on the file's literal diff
  // content + the active model + the summarization prompt hash.
  // A hit returns the prior summary instantly; on iterative
  // `coco commit` re-runs after small edits, the unchanged files
  // never go to the LLM.
  const cacheModel = typeof metadata?.model === 'string' ? metadata.model : undefined
  const cacheRepo = resolveDiffSummaryCacheRepoPath()
  const cacheKey = isCacheEnabled() && cacheModel
    ? diffSummaryKey(fileDiff.diff, cacheModel, SUMMARIZE_PROMPT_HASH)
    : undefined

  if (cacheKey) {
    const cached = readDiffSummary(cacheRepo, cacheKey)
    if (cached) {
      logger.verbose(
        ` - ${fileDiff.file}: cache hit (skipped LLM, ${cached.tokens} tokens)`,
        { color: 'cyan' }
      )
      touchDiffSummary(cacheRepo, cacheKey)
      return {
        ...fileDiff,
        diff: cached.summary,
        tokenCount: cached.tokens,
      }
    }
  }

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
        tokenizer,
        logger,
        metadata: {
          ...metadata,
          task: 'summarize-large-file',
        },
        options: {
          returnIntermediateSteps: false,
        },
      }
    )

    const newTokenCount = tokenizer(fileSummary)

    if (cacheKey && cacheModel) {
      writeDiffSummary(cacheRepo, cacheKey, {
        summary: fileSummary,
        model: cacheModel,
        tokens: newTokenCount,
      })
    }

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
 * Continuous-queue scheduler (#845, PR 4). Mirrors the directory-
 * level scheduler in `summarizeDiffs.ts` and replaces the previous
 * fixed-wave Promise.all loop, which made the slowest call in
 * each wave block the next wave from starting. With realistic LLM
 * tail variance, that wave-locking adds dead time at every wave
 * boundary; continuous queue fills slots as in-flight calls
 * resolve, so the wall-clock tracks the slowest *call*, not the
 * sum of slowest-per-wave.
 */
async function processInWaves<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  maxConcurrent: number
): Promise<R[]> {
  const limit = createLimit(maxConcurrent)
  return Promise.all(items.map((item) => limit(() => processor(item))))
}

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
  const {
    maxFileTokens,
    minTokensForSummary,
    maxConcurrent,
    maxTokens,
    fastPath,
    tokenizer,
    logger,
    chain,
    textSplitter,
    metadata,
  } = options

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

  // Incremental termination (#861, PR 1). When the caller supplies a
  // budget, dispatch biggest-first and re-check the running total per
  // dispatch — once earlier completions drop the total under maxTokens,
  // the remaining queued files skip the LLM and keep their raw diffs.
  // Mirrors the Phase 3 pattern in `summarizeDiffs.ts`. Without a
  // budget (undefined), behavior matches the prior path: every
  // eligible file is summarized regardless.
  filesToSummarize.sort((a, b) => b.diff.tokenCount - a.diff.tokenCount)

  const incrementalTermination = maxTokens !== undefined
  let runningTotal = diffs.reduce((sum, diff) => sum + diff.tokenCount, 0)
  let summarizedCount = 0
  let skippedCount = 0

  logger.verbose(
    `Pre-summarizing up to ${filesToSummarize.length} large file(s)...`,
    { color: 'blue' }
  )

  const processed = await processInWaves(
    filesToSummarize,
    async ({ diff }) => {
      // Re-check the budget at dispatch time when the caller supplied
      // one. Earlier completions may have already dropped the total
      // under the cap; in that case skip the LLM call entirely and
      // keep the raw diff. Without a budget, every eligible file is
      // summarized (preserves the prior behavior).
      if (incrementalTermination && runningTotal <= (maxTokens as number)) {
        return { diff, summarized: false as const }
      }
      const summarized = await summarizeFileDiff(diff, {
        chain,
        textSplitter,
        tokenizer,
        logger,
        metadata,
        fastPath,
      })
      const delta = diff.tokenCount - summarized.tokenCount
      if (delta > 0) {
        runningTotal -= delta
      }
      return { diff: summarized, summarized: true as const }
    },
    maxConcurrent
  )

  processed.forEach((entry, i) => {
    const originalIndex = filesToSummarize[i].index
    if (!entry.summarized) {
      skippedCount++
      return
    }
    summarizedCount++
    const originalTokens = results[originalIndex].tokenCount
    const newTokens = entry.diff.tokenCount

    logger.verbose(
      ` - ${entry.diff.file}: ${originalTokens} -> ${newTokens} tokens`,
      { color: 'magenta' }
    )

    results[originalIndex] = entry.diff
  })

  if (skippedCount > 0) {
    logger.verbose(
      `Skipped ${skippedCount} pre-summary call(s) — token budget already met after ${summarizedCount} earlier file(s)`,
      { color: 'cyan' }
    )
  }

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
