import { ChatOpenAI } from '@langchain/openai'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { CreateLlmArgs, ProviderDefinition } from './types'

function createOpenAiLlm({ model, config, apiKey }: CreateLlmArgs): BaseChatModel {
  const openaiConfig: Partial<ConstructorParameters<typeof ChatOpenAI>[0]> = {
    apiKey,
    model,
    temperature: config.service.temperature || 0.2,
  }

  // Custom base URL for OpenAI-compatible APIs (OpenRouter, etc.).
  if ('baseURL' in config.service && config.service.baseURL) {
    openaiConfig.configuration = { baseURL: config.service.baseURL }
  }

  // Merge any additional provider fields.
  if ('fields' in config.service && config.service.fields) {
    Object.assign(openaiConfig, config.service.fields)
  }

  return new ChatOpenAI(openaiConfig)
}

export const openaiProvider: ProviderDefinition = {
  id: 'openai',
  label: 'OpenAI',
  requiresAuth: true,
  createLlm: createOpenAiLlm,
  resolveEndpoint: (config) =>
    'baseURL' in config.service ? config.service.baseURL : undefined,
}
