import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { AzureLLMService } from '../types'
import { DEFAULT_MAX_OUTPUT_TOKENS } from './constants'
import type { CreateLlmArgs, ProviderDefinition } from './types'

async function createAzureLlm({ model, config, apiKey }: CreateLlmArgs): Promise<BaseChatModel> {
  const { AzureChatOpenAI } = await import('@langchain/openai')
  const svc = config.service as AzureLLMService

  const azureConfig: ConstructorParameters<typeof AzureChatOpenAI>[0] = {
    azureOpenAIApiKey: apiKey,
    azureOpenAIApiInstanceName: svc.instanceName,
    azureOpenAIApiDeploymentName: svc.deploymentName || model,
    azureOpenAIApiVersion: svc.apiVersion,
    temperature: config.service.temperature ?? 0.2,
    maxConcurrency: config.service.maxConcurrent,
    maxTokens: DEFAULT_MAX_OUTPUT_TOKENS,
  }

  // Merge Azure-specific fields forwarded from service config.
  if ('fields' in config.service && config.service.fields) {
    Object.assign(azureConfig, config.service.fields)
  }

  return new AzureChatOpenAI(azureConfig)
}

export const azureProvider: ProviderDefinition = {
  id: 'azure',
  label: 'Azure OpenAI',
  requiresAuth: true,
  createLlm: createAzureLlm,
  resolveEndpoint: (config) => {
    const svc = config.service as AzureLLMService
    return svc.instanceName
      ? `https://${svc.instanceName}.openai.azure.com`
      : undefined
  },
}
