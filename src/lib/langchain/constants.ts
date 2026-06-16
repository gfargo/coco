import { TiktokenModel } from '@langchain/openai'
import { AnthropicModel, BedrockModel, GeminiModel, MistralModel } from './types'

// gpt-4o and the gpt-4.1 family retired from the API in early 2026 (see
// DEPRECATED_MODELS). The gpt-4 / o-series entries below are deprecated but
// still served (shutting down late 2026); the gpt-5 family is current.
export const OPEN_AI_MODELS = [
  // Current generation
  'gpt-5.5',
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.4-nano',
  // Still served (deprecated, retiring late 2026)
  'gpt-4o-mini',
  'gpt-4-turbo',
  'gpt-4',
  'gpt-3.5-turbo',
  'o3',
  'o3-mini',
  'o1',
  'o1-mini',
  'o4-mini',
] as TiktokenModel[]

// Offered in the init picker and treated as current by validation. The entire
// pre-4.x / 4.0 Claude lineup retired through 2025–2026 (see DEPRECATED_MODELS
// in modelValidity.ts for the retired ids → current replacements), so this list
// is the current + still-active generation only.
export const ANTHROPIC_MODELS = [
  // Current generation
  'claude-fable-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
  // Earlier 4.x line (still active)
  'claude-opus-4-5',
  'claude-opus-4-1',
  'claude-sonnet-4-5',
] as AnthropicModel[]

// Gemini 1.5 and 2.0 shut down (404) in 2026 — see DEPRECATED_MODELS. Current
// is the Gemini 3 (3.5 Flash / 3.1 Flash-Lite) + still-active 2.5 generation.
export const GEMINI_MODELS = [
  // Current generation
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
  // Still active
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
] as GeminiModel[]

export const MISTRAL_MODELS = [
  'mistral-large-latest',
  'mistral-medium-latest',
  'mistral-small-latest',
  'codestral-latest',
  'ministral-8b-latest',
  'ministral-3b-latest',
  'open-mistral-nemo',
] as MistralModel[]

// Picker suggestions only — `BedrockModel` accepts any string, since Bedrock
// ids vary by region / inference-profile. The legacy `anthropic.claude-3-*` ids
// mirrored first-party models that have since retired; bumped to the current
// Claude generation on Bedrock (`anthropic.` prefix, no date/version suffix).
export const BEDROCK_MODELS = [
  // Current Claude generation
  'anthropic.claude-opus-4-8',
  'anthropic.claude-opus-4-7',
  'anthropic.claude-sonnet-4-6',
  'anthropic.claude-haiku-4-5',
  // Other Bedrock foundation models
  'meta.llama3-1-70b-instruct-v1:0',
  'mistral.mistral-large-2407-v1:0',
] as BedrockModel[]
