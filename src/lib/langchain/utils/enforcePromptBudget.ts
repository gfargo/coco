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

function buildOmittedMarker(omittedFileCount: number): string {
  return omittedFileCount > 0 ? `\n\n[${omittedFileCount} files omitted for length]\n` : ''
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
  const dropQueue = [...blocks].sort((a, b) => tokenizer(b.text) - tokenizer(a.text))

  const render = async (candidateSummary: string): Promise<number> => {
    const candidateVariables = { ...variables, [summaryKey]: candidateSummary }
    return tokenizer(await renderPrompt(prompt, candidateVariables))
  }

  let remaining = blocks
  let omittedFileCount = 0

  while (remaining.length > 1) {
    const candidateSummary =
      remaining.map(({ text }) => `${DIRECTORY_BLOCK_SEPARATOR}${text}`).join('') +
      buildOmittedMarker(omittedFileCount)
    const candidateTokenCount = await render(candidateSummary)

    if (candidateTokenCount <= tokenBudget) {
      return { summary: candidateSummary.trimEnd(), tokenCount: candidateTokenCount }
    }

    const dropped = dropQueue.shift()
    if (!dropped) break
    remaining = remaining.filter((block) => block.index !== dropped.index)
    omittedFileCount += countFileBullets(dropped.text)
  }

  const [lastBlock] = remaining
  const marker = buildOmittedMarker(omittedFileCount)

  let low = 0
  let high = lastBlock.text.length
  let bestSummary = `${DIRECTORY_BLOCK_SEPARATOR}${marker}`
  let bestTokenCount = await render(bestSummary)

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const candidateSummary = `${DIRECTORY_BLOCK_SEPARATOR}${lastBlock.text.slice(0, mid)}${marker}`
    const candidateTokenCount = await render(candidateSummary)

    if (candidateTokenCount <= tokenBudget) {
      bestSummary = candidateSummary
      bestTokenCount = candidateTokenCount
      low = mid + 1
    } else {
      high = mid - 1
    }
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
    const candidateSummary = summary.slice(0, mid)
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

  return { summary: bestSummary.trimEnd(), tokenCount: bestTokenCount }
}

/**
 * Ensure the fully rendered LLM prompt fits the configured request budget.
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

  if (promptTokenCount <= maxTokens) {
    return { variables, promptTokenCount, truncated: false }
  }

  const summary = variables[summaryKey] || ''
  const variablesWithoutSummary = { ...variables, [summaryKey]: '' }
  const overheadTokenCount = tokenizer(await renderPrompt(prompt, variablesWithoutSummary))
  const summaryBudget = Math.max(0, maxTokens - overheadTokenCount - responseTokenReserve)

  if (summaryBudget === 0) {
    const emptySummaryVariables = { ...variables, [summaryKey]: '' }
    const emptySummaryTokenCount = tokenizer(await renderPrompt(prompt, emptySummaryVariables))

    if (emptySummaryTokenCount > maxTokens) {
      throw new Error(
        `Rendered prompt exceeds token budget before adding ${summaryKey}: ` +
        `${emptySummaryTokenCount} > ${maxTokens}`
      )
    }

    return {
      variables: emptySummaryVariables,
      promptTokenCount: emptySummaryTokenCount,
      truncated: true,
    }
  }

  const tokenBudget = maxTokens - responseTokenReserve
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
