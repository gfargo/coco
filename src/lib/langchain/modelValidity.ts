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
  'gpt-4-turbo-preview': 'gpt-4o',
  'gpt-4-0125-preview': 'gpt-4o',
  'gpt-4-1106-preview': 'gpt-4o',
  'gpt-3.5-turbo-0125': 'gpt-4o-mini',
  'gpt-3.5-turbo-1106': 'gpt-4o-mini',
  'gpt-3.5-turbo-16k': 'gpt-4o-mini',
  'claude-3-opus-20240229': 'claude-sonnet-4-0',
  'claude-3-sonnet-20240229': 'claude-3-5-sonnet-latest',
  'claude-3-haiku-20240307': 'claude-3-5-haiku-latest',
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
