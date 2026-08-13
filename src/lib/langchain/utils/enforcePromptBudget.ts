import { PromptTemplate } from '@langchain/core/prompts'
import { TokenCounter } from '../../utils/tokenizer'
import {
  DIRECTORY_BLOCK_SEPARATOR,
  FILE_BULLET_PREFIX,
} from '../../parsers/default/utils/summarizeDiffs'

type PromptLike = PromptTemplate | {
  template?: string
  format?: (variables: Record<string, string>) => Promise<string> | string
}

export type EnforcePromptBudgetInput = {
  prompt: PromptLike
  variables: Record<string, string>
  tokenizer: TokenCounter
  maxTokens: number
  summaryKey?: string
  responseTokenReserve?: number
}

export type EnforcePromptBudgetResult = {
  variables: Record<string, string>
  promptTokenCount: number
  truncated: boolean
}

/**
 * Default reserved token count for the model's response, shared with callers
 * that need to budget a sub-component (e.g. a diff summary) ahead of the
 * final prompt-level `enforcePromptBudget` check.
 */
export const DEFAULT_RESPONSE_TOKEN_RESERVE = 512

async function renderPrompt(
  prompt: PromptLike,
  variables: Record<string, string>
): Promise<string> {
  if (typeof prompt.format === 'function') {
    return await prompt.format(variables)
  }

  if (typeof prompt.template === 'string') {
    return Object.entries(variables).reduce((result, [key, value]) => {
      return result
        .replaceAll(`{{${key}}}`, value)
        .replaceAll(`{${key}}`, value)
    }, prompt.template)
  }

  throw new Error('Prompt must provide either a format function or template string')
}

function countFileBullets(blockText: string): number {
  return blockText.split('\n').filter((line) => line.startsWith(FILE_BULLET_PREFIX)).length
}

function buildOmittedMarker(omittedFileCount: number, omittedDirectoryCount: number): string {
  if (omittedFileCount === 0 && omittedDirectoryCount === 0) {
    return ''
  }

  const files = `${omittedFileCount} ${omittedFileCount === 1 ? 'file' : 'files'}`
  const directories = `${omittedDirectoryCount} ${omittedDirectoryCount === 1 ? 'directory' : 'directories'}`
  return `\n\n[${files} across ${directories} omitted for length]\n`
}

/**
 * A char-index slice can land inside a UTF-16 surrogate pair (emoji,
 * non-BMP CJK, etc.), leaving a trailing lone high surrogate that
 * JSON.stringify serializes as an unpaired `\ud...` escape -- rejected by
 * strict providers. Drop it so slices always end on a valid boundary.
 */
function stripTrailingHighSurrogate(value: string): string {
  return /[\uD800-\uDBFF]$/.test(value) ? value.slice(0, -1) : value
}

/**
 * A character-prefix binary search finds the largest slice that fits the
 * token budget with no regard for where that lands — typically mid-line,
 * mid-identifier. Snap back to the end of the last complete line so a
 * truncated summary is always well-formed instead of handing the model
 * (and any caller reading the result) a syntactically broken tail (#1843).
 * Safe to call on an already-fitting slice: removing more characters only
 * reduces the token count, never increases it. No newline at all means no
 * complete line survives — degrade to empty rather than a garbled partial.
 */
function snapToLineBoundary(text: string): string {
  const lastNewline = text.lastIndexOf('\n')
  return lastNewline === -1 ? '' : text.slice(0, lastNewline + 1)
}

/**
 * Trim a summary composed of whole directory blocks (see
 * `DIRECTORY_BLOCK_SEPARATOR`) by dropping entire blocks rather than
 * slicing through arbitrary characters. Blocks are dropped largest-first,
 * which is a size-based heuristic per the linked defect (not a semantic
 * importance judgment) -- a single huge-but-important directory can still
 * get dropped before a small trailing one.
 *
 * If a single remaining block alone still exceeds budget, that block falls
 * back to the same char-slice binary search used for non-block summaries.
 */
async function trimSummaryByBlocks(
  prompt: PromptLike,
  variables: Record<string, string>,
  summaryKey: string,
  summary: string,
  tokenizer: TokenCounter,
  tokenBudget: number
): Promise<{ summary: string; tokenCount: number }> {
  const blocks = summary
    .split(DIRECTORY_BLOCK_SEPARATOR)
    .filter(Boolean)
    .map((text, index) => ({ index, text }))
  const dropQueue = blocks
    .map((block) => ({ ...block, tokens: tokenizer(block.text) }))
    .sort((a, b) => b.tokens - a.tokens)

  const render = async (candidateSummary: string): Promise<number> => {
    const candidateVariables = { ...variables, [summaryKey]: candidateSummary }
    return tokenizer(await renderPrompt(prompt, candidateVariables))
  }

  let remaining = blocks
  let omittedFileCount = 0
  let omittedDirectoryCount = 0

  while (remaining.length > 1) {
    const candidateSummary =
      remaining.map(({ text }) => `${DIRECTORY_BLOCK_SEPARATOR}${text}`).join('') +
      buildOmittedMarker(omittedFileCount, omittedDirectoryCount)
    const candidateTokenCount = await render(candidateSummary)

    if (candidateTokenCount <= tokenBudget) {
      return { summary: candidateSummary.trimEnd(), tokenCount: candidateTokenCount }
    }

    const dropped = dropQueue.shift()
    if (!dropped) break
    remaining = remaining.filter((block) => block.index !== dropped.index)
    omittedFileCount += countFileBullets(dropped.text)
    omittedDirectoryCount += 1
  }

  const [lastBlock] = remaining
  const marker = buildOmittedMarker(omittedFileCount, omittedDirectoryCount)

  let low = 0
  let high = lastBlock.text.length
  let bestSummary = `${DIRECTORY_BLOCK_SEPARATOR}${marker}`
  let bestTokenCount = await render(bestSummary)
  let bestSlice = ''

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const candidateSlice = stripTrailingHighSurrogate(lastBlock.text.slice(0, mid))
    const candidateSummary = `${DIRECTORY_BLOCK_SEPARATOR}${candidateSlice}${marker}`
    const candidateTokenCount = await render(candidateSummary)

    if (candidateTokenCount <= tokenBudget) {
      bestSummary = candidateSummary
      bestTokenCount = candidateTokenCount
      bestSlice = candidateSlice
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  // Snap the winning slice to the last complete line (#1843); only the
  // trimmed slice itself, not the separator/marker wrapped around it.
  // Re-render once more only if snapping actually removed anything.
  const snappedSlice = snapToLineBoundary(bestSlice)
  if (snappedSlice !== bestSlice) {
    bestSummary = `${DIRECTORY_BLOCK_SEPARATOR}${snappedSlice}${marker}`
    bestTokenCount = await render(bestSummary)
  }

  if (bestTokenCount > tokenBudget) {
    throw new Error(
      `Rendered prompt exceeds token budget even with an empty ${summaryKey} block: ` +
      `${bestTokenCount} > ${tokenBudget}`
    )
  }

  return { summary: bestSummary.trimEnd(), tokenCount: bestTokenCount }
}

/**
 * Trim a summary that isn't structured as directory blocks (or is a
 * single block) via a plain character-prefix binary search.
 */
async function trimSummaryByCharSlice(
  prompt: PromptLike,
  variables: Record<string, string>,
  summaryKey: string,
  summary: string,
  tokenizer: TokenCounter,
  tokenBudget: number,
  overheadTokenCount: number
): Promise<{ summary: string; tokenCount: number }> {
  let low = 0
  let high = summary.length
  let bestSummary = ''
  let bestTokenCount = overheadTokenCount

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const candidateSummary = stripTrailingHighSurrogate(summary.slice(0, mid))
    const candidateVariables = { ...variables, [summaryKey]: candidateSummary }
    const candidateTokenCount = tokenizer(await renderPrompt(prompt, candidateVariables))

    if (candidateTokenCount <= tokenBudget) {
      bestSummary = candidateSummary
      bestTokenCount = candidateTokenCount
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  // Snap to the last complete line (#1843); re-render only if it changed.
  const snappedSummary = snapToLineBoundary(bestSummary)
  if (snappedSummary !== bestSummary) {
    const snappedVariables = { ...variables, [summaryKey]: snappedSummary }
    bestTokenCount = tokenizer(await renderPrompt(prompt, snappedVariables))
  }

  return { summary: snappedSummary.trimEnd(), tokenCount: bestTokenCount }
}

/**
 * Ensure the fully rendered LLM prompt fits the configured request budget.
 *
 * `maxTokens` is the *request* budget (prompt + the model's response), not the
 * prompt budget alone — it is compared everywhere against `maxTokens -
 * responseTokenReserve` so the reserve is always honored, whether or not
 * trimming ends up engaging.
 *
 * Diff condensation budgets only cover the diff summary itself. This guard accounts
 * for the rest of the rendered prompt, then trims the summary as a deterministic
 * fallback when additional context pushes the request over budget.
 */
export async function enforcePromptBudget({
  prompt,
  variables,
  tokenizer,
  maxTokens,
  summaryKey = 'summary',
  responseTokenReserve = 512,
}: EnforcePromptBudgetInput): Promise<EnforcePromptBudgetResult> {
  const renderedPrompt = await renderPrompt(prompt, variables)
  const promptTokenCount = tokenizer(renderedPrompt)
  const tokenBudget = maxTokens - responseTokenReserve

  if (promptTokenCount <= tokenBudget) {
    return { variables, promptTokenCount, truncated: false }
  }

  const summary = variables[summaryKey] || ''
  const variablesWithoutSummary = { ...variables, [summaryKey]: '' }
  const overheadTokenCount = tokenizer(await renderPrompt(prompt, variablesWithoutSummary))
  const summaryBudget = Math.max(0, tokenBudget - overheadTokenCount)

  if (summaryBudget === 0) {
    if (overheadTokenCount > tokenBudget) {
      throw new Error(
        `Rendered prompt exceeds token budget before adding ${summaryKey}: ` +
        `${overheadTokenCount} > ${tokenBudget}`
      )
    }

    return {
      variables: variablesWithoutSummary,
      promptTokenCount: overheadTokenCount,
      truncated: true,
    }
  }

  const rawParts = summary.split(DIRECTORY_BLOCK_SEPARATOR).filter(Boolean)

  const { summary: finalSummary, tokenCount: bestTokenCount } =
    rawParts.length > 1
      ? await trimSummaryByBlocks(prompt, variables, summaryKey, summary, tokenizer, tokenBudget)
      : await trimSummaryByCharSlice(
          prompt,
          variables,
          summaryKey,
          summary,
          tokenizer,
          tokenBudget,
          overheadTokenCount
        )

  const trimmedVariables = { ...variables, [summaryKey]: finalSummary }
  return {
    variables: trimmedVariables,
    promptTokenCount: bestTokenCount,
    truncated: true,
  }
}
