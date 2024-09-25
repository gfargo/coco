import { ChatOllama } from '@langchain/ollama'
import { ChatOpenAI } from '@langchain/openai'
import { Config } from '../../../commands/types'
import { DEFAULT_OLLAMA_LLM_SERVICE, getApiKeyForModel } from '../utils'
import { LLMModel, LLMProvider } from '../types'

/**
 * Get LLM Model Based on Configuration
 *
 * @param fields
 * @param configuration
 * @returns LLM Model
 */
export function getLlm(provider: LLMProvider, model: LLMModel, config: Config) {
  if (!model) {
    throw new Error(`Invalid LLM Service: ${provider}/${model}`)
  }

  switch (provider) {
    case 'ollama':
      return new ChatOllama({
        baseUrl: DEFAULT_OLLAMA_LLM_SERVICE.endpoint,
        maxConcurrency: config.service.maxConcurrent,
        model,
      })
    case 'openai':
    default:
      const openAiModel = new ChatOpenAI({
        openAIApiKey: getApiKeyForModel(config),
        model,
        temperature: config.service.temperature || 0.2,
      })

      return openAiModel
  }
}
