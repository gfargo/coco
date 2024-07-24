import { Ollama } from '@langchain/community/llms/ollama'
import { OpenAI } from '@langchain/openai'
import { Config } from '../../../commands/types'
import { DEFAULT_OLLAMA_LLM_SERVICE } from '../constants'
import { LLMModel } from '../types'

/**
 * Get LLM Model Based on Configuration
 *
 * @param fields
 * @param configuration
 * @returns LLM Model
 */
export function getLlm(provider: 'openai' | 'ollama', model: LLMModel, config: Config) {
  if (!model) {
    throw new Error(`Invalid LLM Service: ${provider}/${model}`)
  }

  switch (provider) {
    case 'ollama':
      return new Ollama({
        baseUrl: DEFAULT_OLLAMA_LLM_SERVICE.endpoint,
        model,
      })
    case 'openai':
    default:
      return new OpenAI({
        openAIApiKey: config.openAIApiKey,
        modelName: model,
      })
  }
}
