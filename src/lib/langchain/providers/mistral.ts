import { ChatMistralAI } from '@langchain/mistralai'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { DEFAULT_MAX_OUTPUT_TOKENS, DEFAULT_PROVIDER_MAX_RETRIES } from './constants'
import type { CreateLlmArgs, ProviderDefinition } from './types'

function createMistralLlm({ model, config, apiKey }: CreateLlmArgs): BaseChatModel {
  const mistralConfig: ConstructorParameters<typeof ChatMistralAI>[0] = {
    apiKey,
    model,
    temperature: config.service.temperature ?? 0.2,
    maxConcurrency: config.service.maxConcurrent,
    maxTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    maxRetries: config.service.requestOptions?.maxRetries ?? DEFAULT_PROVIDER_MAX_RETRIES,
  }

  // Merge Mistral-specific fields forwarded from service config.
  if ('fields' in config.service && config.service.fields) {
    Object.assign(mistralConfig, config.service.fields)
  }

  return new ChatMistralAI(mistralConfig)
}

export const mistralProvider: ProviderDefinition = {
  id: 'mistral',
  label: 'Mistral',
  requiresAuth: true,
  createLlm: createMistralLlm,
  // Approximation vs. the gpt-4o tiktoken baseline, per the AI-core
  // token-counting audit — no synchronous local Mistral tokenizer available.
  tokenCorrectionFactor: 1.15,
}
