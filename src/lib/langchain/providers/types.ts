import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { Config } from '../../../commands/types'
import type { LLMModel, LLMProvider } from '../types'

/** Arguments handed to a provider's `createLlm` factory. */
export type CreateLlmArgs = {
  model: LLMModel
  config: Config
  /** Resolved API key/token. Empty string for providers that don't need one. */
  apiKey: string
}

/**
 * A self-contained description of one LLM provider. Adding a provider means
 * writing one of these and registering it in `registry.ts` — the switch
 * statements that used to live in `getLlm`, `validateProvider`, and the
 * auth resolver all read from this instead.
 */
export type ProviderDefinition = {
  /** Stable provider id used throughout config and the union type. */
  id: LLMProvider
  /** Human-facing label for the init wizard. */
  label: string
  /**
   * Whether the provider needs an API key/token. When true and no key is
   * resolvable, auth resolution throws before any network call. Providers
   * that authenticate out-of-band (local Ollama, AWS credential chain for
   * Bedrock) set this false.
   */
  requiresAuth: boolean
  /** Instantiate the chat model for this provider. */
  createLlm: (args: CreateLlmArgs) => BaseChatModel
  /**
   * Resolve the effective endpoint for observability / network-error
   * messages, when the provider has a meaningful one (e.g. Ollama's base
   * URL or a custom OpenAI baseURL). Optional.
   */
  resolveEndpoint?: (config: Config) => string | undefined
}
