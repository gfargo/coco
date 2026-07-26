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
