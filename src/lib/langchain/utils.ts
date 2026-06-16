import { Config } from '../../commands/types'
import { LangChainAuthenticationError, LangChainConfigurationError } from './errors'
import { AnthropicLLMService, AzureLLMService, BedrockLLMService, GeminiLLMService, LLMModel, LLMProvider, LLMService, MistralLLMService, OllamaLLMService, OpenAILLMService } from './types'
import { validateRequired, validateServiceConfig } from './validation'
import { providerRequiresAuth } from './providers/registry'

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

  // Check if authentication is required for this provider (sourced from the
  // provider registry so new providers declare their own auth requirement).
  const requiresAuth = providerRequiresAuth(provider)

  if (service.authentication.type === 'APIKey') {
    const apiKey = service.authentication.credentials?.apiKey
    // `endpoint` is optional on some service variants (Ollama / OpenAI-
    // compatible) and absent on others (managed OpenAI / Anthropic).
    // Read defensively so we still attach it when present.
    const endpoint = (service as { endpoint?: string }).endpoint

    if (requiresAuth && (!apiKey || apiKey.trim() === '')) {
      throw new LangChainAuthenticationError(
        `getDefaultServiceApiKey: API key is required for ${provider} provider but not provided`,
        provider,
        endpoint,
        { authenticationType: service.authentication.type }
      )
    }
    
    return apiKey || ''
  } 
  
  if (service.authentication.type === 'OAuth') {
    const token = service.authentication.credentials?.token
    const endpoint = (service as { endpoint?: string }).endpoint

    if (requiresAuth && (!token || token.trim() === '')) {
      throw new LangChainAuthenticationError(
        `getDefaultServiceApiKey: OAuth token is required for ${provider} provider but not provided`,
        provider,
        endpoint,
        { authenticationType: service.authentication.type }
      )
    }
    
    return token || ''
  }

  if (service.authentication.type === 'None') {
    if (requiresAuth) {
      const endpoint = (service as { endpoint?: string }).endpoint
      throw new LangChainAuthenticationError(
        `getDefaultServiceApiKey: ${provider} provider requires authentication but 'None' was configured`,
        provider,
        endpoint,
        { authenticationType: service.authentication.type }
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
  // Bumped from `gpt-4o-mini` to `gpt-4.1-nano` (#854). Diff
  // condensing is bounded summarization — the cheaper / faster
  // tier is the right default for it; quality is on par for this
  // class of task. Users who want the older 4o-mini can still
  // override via service config.
  model: 'gpt-5.4-nano',
  tokenLimit: 4096,
  temperature: 0.32,
  // Bumped 12 → 24 (#845, PR 3). The OpenAI fast tier comfortably
  // handles ~30 concurrent on the per-key default rate limit; 24
  // leaves headroom for retries while still doubling throughput.
  // The summarize chain has a 429-aware backoff (`summarize`
  // helper) so a temporary rate-limit hit no longer kills the
  // whole pipeline.
  maxConcurrent: 24,
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
  // Bumped from `claude-3-5-sonnet-20240620` to
  // `claude-haiku-4-5-20251001` (#854). The Sonnet 3.5 default
  // was nearly two model generations stale; Haiku 4.5 is the
  // current fast tier and the right fit for diff summarization.
  // Users who want Sonnet for quality-sensitive runs can still
  // override via service config (recommended: `claude-sonnet-4-6`).
  model: 'claude-haiku-4-5-20251001',
  temperature: 0.32,
  tokenLimit: 4096,
  // Bumped 12 → 24 (#845, PR 3). Matches the OpenAI default;
  // Anthropic's per-key concurrency on Haiku is generous enough
  // that 24 stays under the rate ceiling for typical fast-model
  // request shapes. Backoff in `summarize` handles spikes.
  maxConcurrent: 24,
  minTokensForSummary: 800,
  maxFileTokens: 2000,
  authentication: {
    type: 'APIKey',
    credentials: {
      apiKey: '',
    },
  },
}

export const DEFAULT_GEMINI_LLM_SERVICE: GeminiLLMService = {
  provider: 'gemini',
  model: 'gemini-2.5-flash',
  temperature: 0.32,
  tokenLimit: 4096,
  maxConcurrent: 24,
  minTokensForSummary: 800,
  maxFileTokens: 2000,
  authentication: {
    type: 'APIKey',
    credentials: {
      apiKey: '',
    },
  },
}

export const DEFAULT_MISTRAL_LLM_SERVICE: MistralLLMService = {
  provider: 'mistral',
  model: 'mistral-small-latest',
  temperature: 0.32,
  tokenLimit: 4096,
  maxConcurrent: 24,
  minTokensForSummary: 800,
  maxFileTokens: 2000,
  authentication: {
    type: 'APIKey',
    credentials: {
      apiKey: '',
    },
  },
}

export const DEFAULT_AZURE_LLM_SERVICE: AzureLLMService = {
  provider: 'azure',
  model: 'gpt-4.1-nano',
  apiVersion: '2024-10-21',
  tokenLimit: 4096,
  temperature: 0.32,
  maxConcurrent: 24,
  minTokensForSummary: 800,
  maxFileTokens: 2000,
  authentication: {
    type: 'APIKey',
    credentials: {
      apiKey: '',
    },
  },
}

export const DEFAULT_BEDROCK_LLM_SERVICE: BedrockLLMService = {
  provider: 'bedrock',
  model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
  region: 'us-east-1',
  maxConcurrent: 8,
  tokenLimit: 4096,
  temperature: 0.32,
  minTokensForSummary: 800,
  maxFileTokens: 2000,
  // Bedrock authenticates via the AWS credential chain, not a coco-managed
  // API key — so its auth type is 'None'.
  authentication: {
    type: 'None',
    credentials: undefined,
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
      
    case 'gemini':
      return {
        ...DEFAULT_GEMINI_LLM_SERVICE,
        model: model || DEFAULT_GEMINI_LLM_SERVICE.model,
      } as GeminiLLMService

    case 'mistral':
      return {
        ...DEFAULT_MISTRAL_LLM_SERVICE,
        model: model || DEFAULT_MISTRAL_LLM_SERVICE.model,
      } as MistralLLMService

    case 'azure':
      return {
        ...DEFAULT_AZURE_LLM_SERVICE,
        model: model || DEFAULT_AZURE_LLM_SERVICE.model,
      } as AzureLLMService

    case 'bedrock':
      return {
        ...DEFAULT_BEDROCK_LLM_SERVICE,
        model: model || DEFAULT_BEDROCK_LLM_SERVICE.model,
      } as BedrockLLMService

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
        `getDefaultServiceConfigFromAlias: Unsupported provider '${provider}'. Supported providers: openai, anthropic, azure, gemini, mistral, bedrock, ollama`,
        { provider, supportedProviders: ['openai', 'anthropic', 'azure', 'gemini', 'mistral', 'bedrock', 'ollama'] }
      )
  }
}
