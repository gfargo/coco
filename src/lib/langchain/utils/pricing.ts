/**
 * Per-model USD pricing used to turn the local usage ledger (tokens) into an
 * *estimated* dollar figure for `coco doctor --cost`. This is a maintenance
 * treadmill by nature — providers change prices without notice — so every
 * number here is labeled with {@link PRICES_AS_OF} in output, and any model
 * not listed degrades to `undefined` (tokens-only) rather than a fabricated
 * `$0.00`. Update this table (and bump `PRICES_AS_OF`) when a provider
 * changes pricing or coco adds a new model to its routing defaults.
 */
export type ModelPrice = {
  /** USD per 1,000,000 input (prompt) tokens. */
  inputPer1M: number
  /** USD per 1,000,000 output (completion) tokens. */
  outputPer1M: number
  /**
   * USD per 1,000,000 cached-input tokens, when a provider prices prompt
   * caching separately. Currently unused — the usage ledger records no
   * cached-token field — but kept optional so pricing a provider's cache
   * discount doesn't require a shape change later.
   */
  cachedInputPer1M?: number
}

/** Calendar month these prices reflect. Shown alongside every cost figure coco renders. */
export const PRICES_AS_OF = '2026-07'

const OPENAI_PRICES: Record<string, ModelPrice> = {
  'gpt-5.5': { inputPer1M: 10, outputPer1M: 30 },
  'gpt-5.4': { inputPer1M: 5, outputPer1M: 15 },
  'gpt-5.4-mini': { inputPer1M: 1, outputPer1M: 4 },
  'gpt-5.4-nano': { inputPer1M: 0.15, outputPer1M: 0.6 },
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6 },
}

const ANTHROPIC_PRICES: Record<string, ModelPrice> = {
  'claude-fable-5': { inputPer1M: 1, outputPer1M: 5 },
  'claude-opus-4-8': { inputPer1M: 15, outputPer1M: 75 },
  'claude-opus-4-7': { inputPer1M: 15, outputPer1M: 75 },
  'claude-opus-4-6': { inputPer1M: 15, outputPer1M: 75 },
  'claude-opus-4-5': { inputPer1M: 15, outputPer1M: 75 },
  'claude-opus-4-1': { inputPer1M: 15, outputPer1M: 75 },
  'claude-sonnet-4-6': { inputPer1M: 3, outputPer1M: 15 },
  'claude-sonnet-4-5': { inputPer1M: 3, outputPer1M: 15 },
  'claude-haiku-4-5': { inputPer1M: 0.8, outputPer1M: 4 },
  'claude-haiku-4-5-20251001': { inputPer1M: 0.8, outputPer1M: 4 },
}

const GEMINI_PRICES: Record<string, ModelPrice> = {
  'gemini-3.5-flash': { inputPer1M: 0.3, outputPer1M: 2.5 },
  'gemini-3.1-flash-lite': { inputPer1M: 0.1, outputPer1M: 0.4 },
  'gemini-2.5-pro': { inputPer1M: 1.25, outputPer1M: 10 },
  'gemini-2.5-flash': { inputPer1M: 0.3, outputPer1M: 2.5 },
  'gemini-2.5-flash-lite': { inputPer1M: 0.1, outputPer1M: 0.4 },
}

const MISTRAL_PRICES: Record<string, ModelPrice> = {
  'mistral-large-latest': { inputPer1M: 2, outputPer1M: 6 },
  'mistral-medium-latest': { inputPer1M: 0.4, outputPer1M: 2 },
  'mistral-small-latest': { inputPer1M: 0.1, outputPer1M: 0.3 },
  'codestral-latest': { inputPer1M: 0.2, outputPer1M: 0.6 },
  'ministral-8b-latest': { inputPer1M: 0.1, outputPer1M: 0.1 },
  'ministral-3b-latest': { inputPer1M: 0.04, outputPer1M: 0.04 },
  'open-mistral-nemo': { inputPer1M: 0.15, outputPer1M: 0.15 },
}

/**
 * Flat lookup across every priced provider except Bedrock (whose
 * `anthropic.`-prefixed ids are resolved by stripping the prefix and
 * re-using {@link ANTHROPIC_PRICES}) and Ollama (local inference is free,
 * handled directly in {@link getModelPrice}).
 */
const MODEL_PRICES: Record<string, ModelPrice> = {
  ...OPENAI_PRICES,
  ...ANTHROPIC_PRICES,
  ...GEMINI_PRICES,
  ...MISTRAL_PRICES,
}

const BEDROCK_ANTHROPIC_PREFIX = 'anthropic.'

/**
 * Look up the price for a model id. Returns `undefined` for anything not in
 * the table — including retired/deprecated models and providers coco hasn't
 * priced yet — so callers can fall back to a tokens-only display instead of
 * reporting a fabricated `$0.00`.
 */
export function getModelPrice(model?: string, provider?: string): ModelPrice | undefined {
  if (!model) return undefined

  // Local inference has no per-token bill.
  if (provider === 'ollama') return { inputPer1M: 0, outputPer1M: 0 }

  if (model.startsWith(BEDROCK_ANTHROPIC_PREFIX)) {
    return ANTHROPIC_PRICES[model.slice(BEDROCK_ANTHROPIC_PREFIX.length)]
  }

  return MODEL_PRICES[model]
}

/**
 * Estimate the USD cost of one LLM call from its recorded tokens. Returns
 * `undefined` — never `0` — when the model is unpriced or no token counts
 * were recorded, so an unpriced call degrades to "show tokens" rather than
 * lying about cost. A genuinely free call (e.g. Ollama) still returns `0`,
 * since that's a true price, not a missing one.
 */
export function estimateCostUsd(record: {
  model?: string
  provider?: string
  promptTokens?: number
  completionTokens?: number
}): number | undefined {
  const price = getModelPrice(record.model, record.provider)
  if (!price) return undefined
  if (record.promptTokens === undefined && record.completionTokens === undefined) return undefined

  const promptCost = ((record.promptTokens || 0) / 1_000_000) * price.inputPer1M
  const completionCost = ((record.completionTokens || 0) / 1_000_000) * price.outputPer1M
  return promptCost + completionCost
}
