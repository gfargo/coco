import { Config } from '../../commands/types'
import { ConfigWithServiceAlias } from '../config/types'
import { DEFAULT_OLLAMA_LLM_SERVICE, DEFAULT_OPENAI_LLM_SERVICE } from './constants'
import { LLMModel, LLMService, LLMServiceAlias, OllamaLLMService, OpenAILLMService } from './types'

/**
 * Retrieves the provider and model from the given configuration object.
 * @param config The configuration object.
 * @returns An object containing the provider and model.
 * @throws Error if the configuration is invalid or missing required properties.
 */
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
      return config.openAIApiKey || getDefaultServiceApiKey(config)
    default:
      return getDefaultServiceApiKey(config)
  }
}

/**
 * Retrieves the default service API key from the given configuration.
 * @param config The configuration object.
 * @returns The default service API key.
 */
export function getDefaultServiceApiKey(config: Config) {
  const service = config.service as LLMService

  if (service.authentication.type === 'APIKey') {
    return service.authentication.credentials?.apiKey
  } else if (service.authentication.type === 'OAuth') {
    return service.authentication.credentials?.token
  }

  return ''
}

/**
 * Retrieves the default service configuration based on the provided alias and optional model.
 * @param alias - The alias of the service.
 * @param model - The optional model to be used.
 * @returns The default service configuration.
 * @throws Error if the alias is invalid or undefined.
 */
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
