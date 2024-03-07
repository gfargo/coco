import { Ollama } from 'langchain/llms/ollama'
import { OpenAI } from 'langchain/llms/openai'
import { Config } from '../../../commands/types'
import { DEFAULT_OLLAMA_LLM_SERVICE } from '../constants'
import { OllamaModel } from '../types'
import { TiktokenModel } from 'langchain/dist/types/openai-types'

/**
 * Get LLM Model Based on Configuration
 *
 * @param fields
 * @param configuration
 * @returns LLM Model
 */
export function getLlm(
  provider: 'openai' | 'ollama',
  model: TiktokenModel | OllamaModel,
  config: Config
) {
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
