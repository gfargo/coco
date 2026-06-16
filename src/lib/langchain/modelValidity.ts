import {
  ANTHROPIC_MODELS,
  BEDROCK_MODELS,
  GEMINI_MODELS,
  MISTRAL_MODELS,
  OPEN_AI_MODELS,
} from './constants'
import { LLMProvider } from './types'

/**
 * Shared model-validity knowledge: deprecated ids and per-provider namespaces.
 *
 * Single source of truth for both the runtime check (`validateModel`) and the
 * `coco doctor` diagnostics, so the two never drift (#1243).
 */

/**
 * Retired / superseded model ids → recommended replacement. `coco doctor`
 * surfaces these as upgrade suggestions; kept here (rather than in the doctor
 * command) so the runtime layer can reference the same list.
 */
export const DEPRECATED_MODELS: Record<string, string> = {
  // OpenAI: gpt-4o and the gpt-4.1 family retired from the API in early 2026;
  // the gpt-4-*-preview / gpt-3.5-turbo-* snapshots before them. Map to the
  // current gpt-5 generation (the old gpt-4o target is itself retired now).
  'gpt-4o': 'gpt-5.4-mini',
  'gpt-4.5': 'gpt-5.5',
  'gpt-4.1': 'gpt-5.4-mini',
  'gpt-4.1-mini': 'gpt-5.4-mini',
  'gpt-4.1-nano': 'gpt-5.4-nano',
  'gpt-4-turbo-preview': 'gpt-5.4-mini',
  'gpt-4-0125-preview': 'gpt-5.4-mini',
  'gpt-4-1106-preview': 'gpt-5.4-mini',
  'gpt-3.5-turbo-0125': 'gpt-5.4-nano',
  'gpt-3.5-turbo-1106': 'gpt-5.4-nano',
  'gpt-3.5-turbo-16k': 'gpt-5.4-nano',
  // The pre-4.x / 4.0 Claude lineup is retired (404 against the API). Map each
  // to its current first-party replacement so `coco doctor` and validation
  // steer users off a dead id instead of letting a request fail.
  'claude-3-opus-20240229': 'claude-opus-4-8',
  'claude-3-sonnet-20240229': 'claude-sonnet-4-6',
  'claude-3-haiku-20240307': 'claude-haiku-4-5',
  'claude-3-5-sonnet-20240620': 'claude-sonnet-4-6',
  'claude-3-5-sonnet-20241022': 'claude-sonnet-4-6',
  'claude-3-5-sonnet-latest': 'claude-sonnet-4-6',
  'claude-3-5-haiku-latest': 'claude-haiku-4-5',
  'claude-3-7-sonnet-latest': 'claude-sonnet-4-6',
  'claude-sonnet-4-0': 'claude-sonnet-4-6',
  // Gemini 1.5 and 2.0 shut down (404) in 2026 → current 3.x / 2.5 generation.
  'gemini-2.0-flash': 'gemini-2.5-flash',
  'gemini-2.0-flash-lite': 'gemini-2.5-flash-lite',
  'gemini-1.5-pro': 'gemini-2.5-pro',
  'gemini-1.5-flash': 'gemini-2.5-flash',
  'gemini-1.5-flash-8b': 'gemini-2.5-flash-lite',
  // Claude-on-Bedrock: the claude-3-5 / sonnet-4-0 ids mirror retired
  // first-party models → current Claude generation on Bedrock.
  'anthropic.claude-3-5-sonnet-20241022-v2:0': 'anthropic.claude-sonnet-4-6',
  'anthropic.claude-3-5-haiku-20241022-v1:0': 'anthropic.claude-haiku-4-5',
  'anthropic.claude-3-haiku-20240307-v1:0': 'anthropic.claude-haiku-4-5',
  'anthropic.claude-sonnet-4-20250514-v1:0': 'anthropic.claude-sonnet-4-6',
}

/**
 * Providers with a fixed, known model namespace we can validate against.
 * Excludes `ollama` (arbitrary local model names) and `azure` (custom
 * deployment names — folded into the OpenAI namespace via {@link namespaceFamily}).
 */
const CLOSED_PROVIDER_MODELS: Partial<Record<LLMProvider, readonly string[]>> = {
  openai: OPEN_AI_MODELS as readonly string[],
  anthropic: ANTHROPIC_MODELS as readonly string[],
  gemini: GEMINI_MODELS as readonly string[],
  mistral: MISTRAL_MODELS as readonly string[],
  bedrock: BEDROCK_MODELS as readonly string[],
}

/** OpenAI and Azure share OpenAI's model ids in coco's config. */
function namespaceFamily(provider: LLMProvider): LLMProvider {
  return provider === 'azure' ? 'openai' : provider
}

/** Recommended replacement for a deprecated model id, or undefined. */
export function getDeprecatedReplacement(model: string): string | undefined {
  return DEPRECATED_MODELS[model]
}

/** The closed-namespace provider that owns this exact model id, or null. */
export function findModelOwner(model: string): LLMProvider | null {
  for (const [provider, models] of Object.entries(CLOSED_PROVIDER_MODELS)) {
    if (models.includes(model)) return provider as LLMProvider
  }
  return null
}

/**
 * Detect a *definite* cross-provider mismatch: `model` is exactly a known model
 * of a different closed-namespace provider. Returns the owning provider, or
 * null when there's no conflict — i.e. for the `dynamic` sentinel, open-namespace
 * providers (ollama), unrecognized / new model ids, or a correct match
 * (azure↔openai counts as a match). Exact-membership only, so new or custom
 * models for the right provider never trip it.
 */
export function detectProviderMismatch(model: string, provider: LLMProvider): LLMProvider | null {
  if (model === 'dynamic') return null
  if (provider === 'ollama') return null

  const owner = findModelOwner(model)
  if (!owner) return null

  return namespaceFamily(owner) === namespaceFamily(provider) ? null : owner
}
