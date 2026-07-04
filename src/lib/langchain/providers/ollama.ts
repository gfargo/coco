import { ChatOllama } from '@langchain/ollama'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { Config } from '../../../commands/types'
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
  return new ChatOllama({
    baseUrl: resolveOllamaEndpoint(config),
    maxConcurrency: config.service.maxConcurrent,
    model,
  })
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
