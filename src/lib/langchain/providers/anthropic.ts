import { ChatAnthropic } from '@langchain/anthropic'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { CreateLlmArgs, ProviderDefinition } from './types'

function createAnthropicLlm({ model, config, apiKey }: CreateLlmArgs): BaseChatModel {
  const anthropicConfig: ConstructorParameters<typeof ChatAnthropic>[0] = {
    anthropicApiKey: apiKey,
    maxConcurrency: config.service.maxConcurrent,
    model,
    // `??` not `||` so an explicit `temperature: 0` (fully deterministic) is
    // respected instead of being coerced to the 0.2 default.
    temperature: config.service.temperature ?? 0.2,
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
}
