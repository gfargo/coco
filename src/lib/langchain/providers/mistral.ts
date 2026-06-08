import { ChatMistralAI } from '@langchain/mistralai'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { CreateLlmArgs, ProviderDefinition } from './types'

function createMistralLlm({ model, config, apiKey }: CreateLlmArgs): BaseChatModel {
  const mistralConfig: ConstructorParameters<typeof ChatMistralAI>[0] = {
    apiKey,
    model,
    temperature: config.service.temperature ?? 0.2,
    maxConcurrency: config.service.maxConcurrent,
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
}
