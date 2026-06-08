import type { LLMProvider } from '../types'
import { anthropicProvider } from './anthropic'
import { geminiProvider } from './gemini'
import { ollamaProvider } from './ollama'
import { openaiProvider } from './openai'
import type { ProviderDefinition } from './types'

/**
 * The single source of truth for which providers exist and how to instantiate
 * them. Adding a provider is a matter of writing a `ProviderDefinition` module
 * and registering it here — `getLlm`, `validateProvider`, and the auth resolver
 * all read from this map instead of their own switch statements.
 */
export const PROVIDERS: Record<LLMProvider, ProviderDefinition> = {
  openai: openaiProvider,
  anthropic: anthropicProvider,
  gemini: geminiProvider,
  ollama: ollamaProvider,
}

/** All registered provider ids. */
export const LLM_PROVIDER_IDS = Object.keys(PROVIDERS) as LLMProvider[]

/** Look up a provider definition, or undefined if the id is unknown. */
export function findProviderDefinition(
  provider: string
): ProviderDefinition | undefined {
  return PROVIDERS[provider as LLMProvider]
}

/** Whether the given provider requires an API key/token. Unknown → false. */
export function providerRequiresAuth(provider: string): boolean {
  return findProviderDefinition(provider)?.requiresAuth ?? false
}
