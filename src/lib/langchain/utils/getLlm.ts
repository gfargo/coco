import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { Config } from '../../../commands/types'
import { LLMModel, LLMProvider } from '../types'
import { getApiKeyForModel } from '../utils'
import { LangChainExecutionError, LangChainConfigurationError } from '../errors'
import { validateRequired, validateProvider, validateModel } from '../validation'
import { handleLangChainError } from '../errorHandler'
import { findProviderDefinition, LLM_PROVIDER_IDS } from '../providers/registry'
import { recordLlmMetadata } from './llmMetadata'

/**
 * Creates and configures an LLM instance based on the provider and configuration.
 *
 * Instantiation is delegated to the provider registry (`providers/registry.ts`),
 * so this function no longer switches on the provider — adding a provider is a
 * registry entry, not an edit here.
 *
 * @param provider - The LLM provider (openai, anthropic, ollama, ...)
 * @param model - The specific model to use
 * @param config - The configuration object containing service settings
 * @returns Configured LLM instance
 * @throws LangChainConfigurationError if the provider/model combination is invalid
 * @throws LangChainExecutionError if LLM instantiation fails
 */
export async function getLlm(
  provider: LLMProvider,
  model: LLMModel,
  config: Config
): Promise<BaseChatModel> {
  // Validate input parameters
  validateProvider(provider, 'getLlm')
  validateModel(model, provider, 'getLlm')
  validateRequired(config, 'config', 'getLlm')

  const definition = findProviderDefinition(provider)
  if (!definition) {
    throw new LangChainConfigurationError(`getLlm: Unsupported provider '${provider}'`, {
      provider,
      model,
      supportedProviders: LLM_PROVIDER_IDS,
    })
  }

  // Get the API key once and validate it
  let apiKey: string
  try {
    apiKey = getApiKeyForModel(config)
  } catch (error) {
    handleLangChainError(error, 'getLlm: Failed to retrieve API key', { provider, model })
  }

  try {
    const llm = await definition.createLlm({ model, config, apiKey })
    recordLlmMetadata(llm, {
      provider,
      endpoint: definition.resolveEndpoint?.(config),
    })
    return llm
  } catch (error) {
    // If it's already a LangChain error, re-throw it
    if (error instanceof LangChainConfigurationError || error instanceof LangChainExecutionError) {
      throw error
    }

    // Wrap other errors
    handleLangChainError(error, `getLlm: Failed to instantiate ${provider} LLM`, {
      provider,
      model,
      hasApiKey: !!apiKey,
      serviceConfig: {
        maxConcurrency: config.service.maxConcurrent,
        temperature: config.service.temperature,
      },
    })
  }
}
