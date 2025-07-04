import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOllama } from '@langchain/ollama';
import { ChatOpenAI } from '@langchain/openai';
import { Config } from '../../../commands/types';
import { LLMModel, LLMProvider } from '../types';
import { DEFAULT_OLLAMA_LLM_SERVICE, getApiKeyForModel } from '../utils';
import { LangChainExecutionError, LangChainConfigurationError } from '../errors';
import { validateRequired, validateProvider, validateModel } from '../validation';
import { handleLangChainError } from '../errorHandler';

/**
 * Creates and configures an LLM instance based on the provider and configuration.
 *
 * @param provider - The LLM provider (openai, anthropic, ollama)
 * @param model - The specific model to use
 * @param config - The configuration object containing service settings
 * @returns Configured LLM instance
 * @throws LangChainConfigurationError if the provider/model combination is invalid
 * @throws LangChainExecutionError if LLM instantiation fails
 */
export function getLlm(provider: LLMProvider, model: LLMModel, config: Config) {
  // Validate input parameters
  validateProvider(provider, 'getLlm')
  validateModel(model, provider, 'getLlm')
  validateRequired(config, 'config', 'getLlm')

  // Get the API key once and validate it
  let apiKey: string
  try {
    apiKey = getApiKeyForModel(config)
  } catch (error) {
    handleLangChainError(error, 'getLlm: Failed to retrieve API key', { provider, model })
  }

  try {
    switch (provider) {
      case 'anthropic':
        return new ChatAnthropic({
          anthropicApiKey: apiKey,
          maxConcurrency: config.service.maxConcurrent,
          model,
        })
        
      case 'ollama':
        // Use endpoint from service config if available, otherwise fall back to default
        const endpoint = 'endpoint' in config.service 
          ? config.service.endpoint 
          : DEFAULT_OLLAMA_LLM_SERVICE.endpoint
          
        return new ChatOllama({
          baseUrl: endpoint,
          maxConcurrency: config.service.maxConcurrent, 
          model,
        })
        
      case 'openai':
        return new ChatOpenAI({
          openAIApiKey: apiKey,
          model,
          temperature: config.service.temperature || 0.2,
        })
        
      default:
        throw new LangChainConfigurationError(
          `getLlm: Unsupported provider '${provider}'`,
          { provider, model, supportedProviders: ['openai', 'anthropic', 'ollama'] }
        )
    }
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
        temperature: config.service.temperature
      }
    })
  }
}
