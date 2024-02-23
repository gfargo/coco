import { Ollama } from 'langchain/llms/ollama'
// import { BaseLLMParams } from 'langchain/llms/base'
import {
  //AzureOpenAIInput,
  //OpenAIInput,
  OpenAI,
} from 'langchain/llms/openai'
import { Config } from '../../../commands/types'
import { getModelAndProviderFromConfig as getModelAndProviderFromConfig } from '../utils'

/**
 * Get LLM Model Based on Configuration
 * @param fields
 * @param configuration
 * @returns LLM Model
 */

export function getLlm(config: Config) {
  const { provider, model } = getModelAndProviderFromConfig(config)

  if (!model) {
    throw new Error(`Invalid LLM Service: ${config.service}`)
  }

  switch (provider) {
    case 'ollama':
      console.log('Using Ollama')

      return new Ollama({
        baseUrl: 'http://localhost:11434',
        model,
        // ...fields,
      })
    case 'openai':
    default:
      return new OpenAI({
        openAIApiKey: config.openAIApiKey,
        modelName: model,
        // ...config.,
      })
  }
}
