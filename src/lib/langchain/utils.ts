import { Config } from '../../commands/types'
import { LangChainAuthenticationError, LangChainConfigurationError } from './errors'
import { AnthropicLLMService, LLMModel, LLMProvider, LLMService, OllamaLLMService, OpenAILLMService } from './types'
import { validateRequired, validateServiceConfig } from './validation'

/**
 * Retrieves the provider and model from the given configuration object.
 * @param config The configuration object.
 * @returns An object containing the provider and model.
 * @throws LangChainConfigurationError if the configuration is invalid or missing required properties.
 */
export function getModelAndProviderFromConfig(config: Config) {
  validateRequired(config, 'config', 'getModelAndProviderFromConfig')
  
  if (!config.service) {
    throw new LangChainConfigurationError(
      'getModelAndProviderFromConfig: Service configuration is missing',
      { config }
    )
  }

  validateServiceConfig(config.service, 'getModelAndProviderFromConfig')

  const { provider, model } = config.service

  return { provider, model }
}

/**
 * Retrieve appropriate API key based on selected model
 * @param config The configuration object
 * @returns API Key or empty string if no authentication required
 * @throws LangChainAuthenticationError if authentication is required but missing
 */
export function getApiKeyForModel(config: Config): string {
  validateRequired(config, 'config', 'getApiKeyForModel')
  
  // This function now simply delegates to getDefaultServiceApiKey
  // The switch statement was unnecessary since all providers use the same logic
  return getDefaultServiceApiKey(config)
}

/**
 * Retrieves the default service API key from the given configuration.
 * @param config The configuration object.
 * @returns The default service API key or empty string for services that don't require authentication.
 * @throws LangChainAuthenticationError if authentication is required but invalid.
 */
export function getDefaultServiceApiKey(config: Config): string {
  validateRequired(config, 'config', 'getDefaultServiceApiKey')
  validateServiceConfig(config.service, 'getDefaultServiceApiKey')
  
  const service = config.service as LLMService
  const { provider } = service

  // Check if authentication is required for this provider
  const requiresAuth = provider === 'openai' || provider === 'anthropic'

  if (service.authentication.type === 'APIKey') {
    const apiKey = service.authentication.credentials?.apiKey
    
    if (requiresAuth && (!apiKey || apiKey.trim() === '')) {
      throw new LangChainAuthenticationError(
        `getDefaultServiceApiKey: API key is required for ${provider} provider but not provided`,
        { provider, authenticationType: service.authentication.type }
      )
    }
    
    return apiKey || ''
  } 
  
  if (service.authentication.type === 'OAuth') {
    const token = service.authentication.credentials?.token
    
    if (requiresAuth && (!token || token.trim() === '')) {
      throw new LangChainAuthenticationError(
        `getDefaultServiceApiKey: OAuth token is required for ${provider} provider but not provided`,
        { provider, authenticationType: service.authentication.type }
      )
    }
    
    return token || ''
  }

  if (service.authentication.type === 'None') {
    if (requiresAuth) {
      throw new LangChainAuthenticationError(
        `getDefaultServiceApiKey: ${provider} provider requires authentication but 'None' was configured`,
        { provider, authenticationType: service.authentication.type }
      )
    }
    
    return ''
  }

  // This should never be reached due to TypeScript type checking, but included for safety
  const authType = (service.authentication as { type: string }).type
  throw new LangChainConfigurationError(
    `getDefaultServiceApiKey: Unknown authentication type '${authType}'`,
    { provider, authentication: service.authentication }
  )
}

export const DEFAULT_OPENAI_LLM_SERVICE: OpenAILLMService = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  tokenLimit: 4096,
  temperature: 0.32,
  maxConcurrent: 12,
  minTokensForSummary: 800,
  maxFileTokens: 2000,
  authentication: {
    type: 'APIKey',
    credentials: {
      apiKey: '',
    },
  },
}

export const DEFAULT_ANTHROPIC_LLM_SERVICE: AnthropicLLMService = {
  provider: 'anthropic',
  model: 'claude-3-5-sonnet-20240620',
  temperature: 0.32,
  tokenLimit: 4096,
  maxConcurrent: 12,
  minTokensForSummary: 800,
  maxFileTokens: 2000,
  authentication: {
    type: 'APIKey',
    credentials: {
      apiKey: '',
    },
  },
}

export const DEFAULT_OLLAMA_LLM_SERVICE: OllamaLLMService = {
  provider: 'ollama',
  model: 'llama3',
  endpoint: 'http://localhost:11434',
  maxConcurrent: 1,
  tokenLimit: 4096,
  temperature: 0.4,
  maxParsingAttempts: 3,
  minTokensForSummary: 800,
  maxFileTokens: 2000,
  authentication: {
    type: 'None',
    credentials: undefined,
  },
}

/**
 * Retrieves the default service configuration based on the provided provider and optional model.
 * @param provider - The LLM provider (openai, anthropic, ollama).
 * @param model - The optional model to be used. If not provided, uses the default model for the provider.
 * @returns The default service configuration for the specified provider.
 * @throws LangChainConfigurationError if the provider is invalid or unsupported.
 */
export function getDefaultServiceConfigFromAlias(provider: LLMProvider, model?: LLMModel): LLMService {
  validateRequired(provider, 'provider', 'getDefaultServiceConfigFromAlias')
  
  // Validate model if provided
  if (model !== undefined) {
    validateRequired(model, 'model', 'getDefaultServiceConfigFromAlias')
    if (typeof model !== 'string' || model.trim() === '') {
      throw new LangChainConfigurationError(
        'getDefaultServiceConfigFromAlias: Model must be a non-empty string when provided',
        { provider, model }
      )
    }
  }

  switch (provider) {
    case 'anthropic':
      return {
        ...DEFAULT_ANTHROPIC_LLM_SERVICE,
        model: model || DEFAULT_ANTHROPIC_LLM_SERVICE.model,
      } as AnthropicLLMService
      
    case 'ollama':
      return {
        ...DEFAULT_OLLAMA_LLM_SERVICE,
        model: model || DEFAULT_OLLAMA_LLM_SERVICE.model,
      } as OllamaLLMService
      
    case 'openai':
      return {
        ...DEFAULT_OPENAI_LLM_SERVICE,
        model: model || DEFAULT_OPENAI_LLM_SERVICE.model,
      } as OpenAILLMService
      
    default:
      throw new LangChainConfigurationError(
        `getDefaultServiceConfigFromAlias: Unsupported provider '${provider}'. Supported providers: openai, anthropic, ollama`,
        { provider, supportedProviders: ['openai', 'anthropic', 'ollama'] }
      )
  }
}
