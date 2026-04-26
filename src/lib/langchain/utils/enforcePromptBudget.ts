import { PromptTemplate } from '@langchain/core/prompts'
import { TokenCounter } from '../../utils/tokenizer'

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

  let low = 0
  let high = summary.length
  let bestSummary = ''
  let bestTokenCount = overheadTokenCount

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const candidateSummary = summary.slice(0, mid)
    const candidateVariables = { ...variables, [summaryKey]: candidateSummary }
    const candidateTokenCount = tokenizer(await renderPrompt(prompt, candidateVariables))

    if (candidateTokenCount <= maxTokens - responseTokenReserve) {
      bestSummary = candidateSummary
      bestTokenCount = candidateTokenCount
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  const trimmedVariables = { ...variables, [summaryKey]: bestSummary.trimEnd() }
  return {
    variables: trimmedVariables,
    promptTokenCount: bestTokenCount,
    truncated: true,
  }
}
