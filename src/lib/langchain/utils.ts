import { Config } from '../../commands/types'
import { ConfigWithServiceAlias } from '../config/types'
import { DEFAULT_OLLAMA_LLM_SERVICE, DEFAULT_OPENAI_LLM_SERVICE } from './constants'
import { LLMModel, LLMService, LLMServiceAlias, OllamaLLMService, OpenAILLMService } from './types'

export function getModelAndProviderFromConfig(config: Config) {
  if (!config.service) {
    throw new Error('Invalid service: undefined')
  }

  let result: LLMService

  switch (typeof config.service) {
    case 'string':
      result = getDefaultServiceConfigFromAlias(
        config.service,
        (config as ConfigWithServiceAlias)?.model
      )
      break
    case 'object':
    default:
      result = config.service
      break
  }

  const { provider, model } = result

  if (!model || !provider) {
    throw new Error(`Invalid service: ${config.service}`)
  }

  return { provider, model }
}

/**
 * Retrieve appropriate API key based on selected model
 * @param service
 * @param options
 * @returns API Key
 */
export function getApiKeyForModel(config: Config) {
  const { provider } = getModelAndProviderFromConfig(config)

  switch (provider) {
    case 'openai':
      return (
        config.openAIApiKey || (config.service as LLMService)?.authentication.credentials?.apiKey
      )
    default:
      return (config.service as LLMService)?.authentication.credentials?.apiKey || ''
  }
}

export function getDefaultServiceConfigFromAlias(alias: LLMServiceAlias, model?: LLMModel) {
  if (!alias) {
    throw new Error('Invalid alias: undefined')
  }

  switch (alias) {
    case 'openai':
      return {
        ...DEFAULT_OPENAI_LLM_SERVICE,
        model: model || DEFAULT_OPENAI_LLM_SERVICE.model,
      } as OpenAILLMService
    case 'ollama':
      return {
        ...DEFAULT_OLLAMA_LLM_SERVICE,
        model: model || DEFAULT_OLLAMA_LLM_SERVICE.model,
      } as OllamaLLMService
  }
}
