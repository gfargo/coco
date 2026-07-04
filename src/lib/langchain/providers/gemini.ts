import { ChatGoogleGenerativeAI } from '@langchain/google-genai'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { CreateLlmArgs, ProviderDefinition } from './types'

function createGeminiLlm({ model, config, apiKey }: CreateLlmArgs): BaseChatModel {
  const geminiConfig: ConstructorParameters<typeof ChatGoogleGenerativeAI>[0] = {
    apiKey,
    model,
    temperature: config.service.temperature ?? 0.2,
    maxConcurrency: config.service.maxConcurrent,
  }

  // Merge Gemini-specific fields forwarded from service config.
  if ('fields' in config.service && config.service.fields) {
    Object.assign(geminiConfig, config.service.fields)
  }

  return new ChatGoogleGenerativeAI(geminiConfig)
}

export const geminiProvider: ProviderDefinition = {
  id: 'gemini',
  label: 'Google Gemini',
  requiresAuth: true,
  createLlm: createGeminiLlm,
  // Approximation vs. the gpt-4o tiktoken baseline, per the AI-core
  // token-counting audit — no synchronous local Gemini tokenizer available.
  tokenCorrectionFactor: 1.1,
}
