import { ChatOllama } from '@langchain/ollama'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { Config } from '../../../commands/types'
import { DEFAULT_MAX_OUTPUT_TOKENS, DEFAULT_PROVIDER_MAX_RETRIES } from './constants'
import type { CreateLlmArgs, ProviderDefinition } from './types'

/** Fallback when no endpoint is configured. Inlined here (rather than imported
 * from `utils.ts`) to keep the provider registry free of import cycles. */
const DEFAULT_OLLAMA_ENDPOINT = 'http://localhost:11434'

function resolveOllamaEndpoint(config: Config): string {
  return 'endpoint' in config.service && config.service.endpoint
    ? config.service.endpoint
    : DEFAULT_OLLAMA_ENDPOINT
}

function createOllamaLlm({ model, config }: CreateLlmArgs): BaseChatModel {
  const ollamaConfig: ConstructorParameters<typeof ChatOllama>[0] = {
    baseUrl: resolveOllamaEndpoint(config),
    maxConcurrency: config.service.maxConcurrent,
    model,
    // `??` not `||` so an explicit `temperature: 0` (fully deterministic) is
    // respected instead of being coerced to the default (#1631). Matches the
    // `DEFAULT_OLLAMA_LLM_SERVICE.temperature` default, not the 0.2 the other
    // providers use — Ollama's own default service config already ships 0.4.
    temperature: config.service.temperature ?? 0.4,
    numPredict: DEFAULT_MAX_OUTPUT_TOKENS,
    maxRetries: config.service.requestOptions?.maxRetries ?? DEFAULT_PROVIDER_MAX_RETRIES,
  }

  // Merge Ollama-specific fields forwarded from service config (e.g. an
  // explicit `numPredict` override).
  if ('fields' in config.service && config.service.fields) {
    Object.assign(ollamaConfig, config.service.fields)
  }

  return new ChatOllama(ollamaConfig)
}

export const ollamaProvider: ProviderDefinition = {
  id: 'ollama',
  label: 'Ollama (local)',
  requiresAuth: false,
  createLlm: createOllamaLlm,
  resolveEndpoint: resolveOllamaEndpoint,
  // Approximation vs. the gpt-4o tiktoken baseline, per the AI-core
  // token-counting audit — locally-hosted models vary too widely to pin
  // down a single tokenizer, so this tracks the Claude/Llama-class estimate.
  tokenCorrectionFactor: 1.2,
}
