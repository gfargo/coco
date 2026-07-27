import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { DEFAULT_MAX_OUTPUT_TOKENS } from './constants'
import { resolveTemperature } from './reasoning'
import type { CreateLlmArgs, ProviderDefinition } from './types'

async function createOpenAiLlm({ model, config, apiKey }: CreateLlmArgs): Promise<BaseChatModel> {
  const { ChatOpenAI } = await import('@langchain/openai')
  const openaiConfig: Partial<ConstructorParameters<typeof ChatOpenAI>[0]> = {
    apiKey,
    maxConcurrency: config.service.maxConcurrent,
    // Disable LangChain's built-in AsyncCaller retries — coco's own
    // retry layers (invokeWithBackoff, withRetry in executeChainWithSchema)
    // are the single retry authority (#1677).
    maxRetries: config.service.requestOptions?.maxRetries ?? 0,
    model,
    // Reasoning models (o-/gpt-5 series) reject any temperature other than
    // 1 — skip our 0.2 default (and normalize an explicit non-1 value away)
    // whenever reasoningEffort is set. See `resolveTemperature`.
    temperature: resolveTemperature(config.service.reasoningEffort, config.service.temperature),
    maxTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    ...(config.service.reasoningEffort ? { reasoning: { effort: config.service.reasoningEffort } } : {}),
    ...(config.service.requestOptions?.timeout
      ? { timeout: config.service.requestOptions.timeout }
      : {}),
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
  supportsReasoningEffort: true,
}
