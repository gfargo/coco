import { PromptTemplate } from '@langchain/core/prompts'
import { TokenCounter } from '../../utils/tokenizer'

export type EnforcePromptBudgetInput = {
  prompt: PromptTemplate
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
  const renderedPrompt = await prompt.format(variables)
  const promptTokenCount = tokenizer(renderedPrompt)

  if (promptTokenCount <= maxTokens) {
    return { variables, promptTokenCount, truncated: false }
  }

  const summary = variables[summaryKey] || ''
  const variablesWithoutSummary = { ...variables, [summaryKey]: '' }
  const overheadTokenCount = tokenizer(await prompt.format(variablesWithoutSummary))
  const summaryBudget = Math.max(0, maxTokens - overheadTokenCount - responseTokenReserve)

  if (summaryBudget === 0) {
    const emptySummaryVariables = { ...variables, [summaryKey]: '' }
    const emptySummaryTokenCount = tokenizer(await prompt.format(emptySummaryVariables))

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
    const candidateTokenCount = tokenizer(await prompt.format(candidateVariables))

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
