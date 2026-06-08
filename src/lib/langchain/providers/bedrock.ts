import { ChatBedrockConverse } from '@langchain/aws'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { BedrockLLMService } from '../types'
import type { CreateLlmArgs, ProviderDefinition } from './types'

function createBedrockLlm({ model, config }: CreateLlmArgs): BaseChatModel {
  const svc = config.service as BedrockLLMService

  const bedrockConfig: ConstructorParameters<typeof ChatBedrockConverse>[0] = {
    model,
    region: svc.region,
    // Bedrock authenticates via the AWS credential chain by default
    // (env: AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION, or a
    // shared profile). Only pass explicit credentials when both pieces are
    // present in the service config; otherwise let the SDK resolve them.
    ...(svc.accessKeyId && svc.secretAccessKey
      ? {
          credentials: {
            accessKeyId: svc.accessKeyId,
            secretAccessKey: svc.secretAccessKey,
            sessionToken: svc.sessionToken,
          },
        }
      : {}),
    temperature: config.service.temperature ?? 0.2,
    maxConcurrency: config.service.maxConcurrent,
  }

  // Merge Bedrock-specific fields forwarded from service config.
  if ('fields' in config.service && config.service.fields) {
    Object.assign(bedrockConfig, config.service.fields)
  }

  return new ChatBedrockConverse(bedrockConfig)
}

export const bedrockProvider: ProviderDefinition = {
  id: 'bedrock',
  label: 'AWS Bedrock',
  // Bedrock uses the AWS credential chain, not a coco-managed API key.
  requiresAuth: false,
  createLlm: createBedrockLlm,
  resolveEndpoint: undefined,
}
