import { ChatAnthropic } from '@langchain/anthropic'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { CreateLlmArgs, ProviderDefinition } from './types'

function createAnthropicLlm({ model, config, apiKey }: CreateLlmArgs): BaseChatModel {
  const anthropicConfig: ConstructorParameters<typeof ChatAnthropic>[0] = {
    anthropicApiKey: apiKey,
    maxConcurrency: config.service.maxConcurrent,
    model,
  }

  // Respect the base temperature, overridable by the per-service field.
  if (typeof config.service.temperature === 'number') {
    anthropicConfig.temperature = config.service.temperature
  }

  // Custom endpoint for proxies / gateways.
  if ('baseURL' in config.service && config.service.baseURL) {
    anthropicConfig.anthropicApiUrl = config.service.baseURL
  }

  // Merge Anthropic-specific fields (temperature, maxTokens, ...).
  if ('fields' in config.service && config.service.fields) {
    Object.assign(anthropicConfig, config.service.fields)
  }

  return new ChatAnthropic(anthropicConfig)
}

export const anthropicProvider: ProviderDefinition = {
  id: 'anthropic',
  label: 'Anthropic',
  requiresAuth: true,
  createLlm: createAnthropicLlm,
  resolveEndpoint: (config) =>
    'baseURL' in config.service ? config.service.baseURL : undefined,
  // Claude tokenizes code ~1.15-1.3x more tokens than the gpt-4o tiktoken
  // baseline (per the AI-core token-counting audit); 1.2 is a middle estimate.
  tokenCorrectionFactor: 1.2,
}
