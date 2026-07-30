import type { ReasoningEffort } from '../types'

export type GeminiThinkingLevel = 'LOW' | 'MEDIUM' | 'HIGH'

/**
 * Gemini's `thinkingConfig.thinkingLevel` has no `'minimal'` tier (only
 * LOW/MEDIUM/HIGH) — map it down to LOW rather than rejecting the value or
 * silently dropping it.
 */
const GEMINI_THINKING_LEVEL: Record<ReasoningEffort, GeminiThinkingLevel> = {
  minimal: 'LOW',
  low: 'LOW',
  medium: 'MEDIUM',
  high: 'HIGH',
}

export function toGeminiThinkingLevel(effort: ReasoningEffort): GeminiThinkingLevel {
  return GEMINI_THINKING_LEVEL[effort]
}

export type AnthropicEffort = 'low' | 'medium' | 'high'

/**
 * `@langchain/anthropic`'s `outputConfig.effort` grades extended thinking
 * (low/medium/high/xhigh/max) rather than just toggling it on. coco's shared
 * `ReasoningEffort` scale has no `'minimal'` tier for Anthropic to undershoot
 * to, so map it down to `'low'` — the same undershoot Gemini's mapping does.
 */
const ANTHROPIC_EFFORT: Record<ReasoningEffort, AnthropicEffort> = {
  minimal: 'low',
  low: 'low',
  medium: 'medium',
  high: 'high',
}

export function toAnthropicEffort(effort: ReasoningEffort): AnthropicEffort {
  return ANTHROPIC_EFFORT[effort]
}

/**
 * Reasoning/extended-thinking models (Anthropic adaptive thinking, OpenAI
 * o-/gpt-5 series) reject any `temperature` other than `1`. When
 * `reasoningEffort` is set, omit our own `0.2` default — and normalize away
 * an explicit non-1 value too — so the SDK's own default applies instead of
 * the API 400ing. `??` (not `||`) so an explicit `temperature: 0` is
 * respected when reasoning is off.
 */
export function resolveTemperature(
  reasoningEffort: ReasoningEffort | undefined,
  temperature: number | undefined
): number | undefined {
  if (reasoningEffort) return temperature === 1 ? 1 : undefined
  return temperature ?? 0.2
}
