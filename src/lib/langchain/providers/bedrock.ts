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

/**
 * Bedrock hosts several model families under one provider, each tokenizing
 * differently from the gpt-4o tiktoken baseline. Sniff the model id for a
 * known family and fall back to a generic non-OpenAI estimate for anything
 * else (custom ARNs, unlisted model ids) rather than throwing.
 */
function bedrockTokenCorrectionFactor(model: string): number {
  const id = model.toLowerCase()
  if (id.includes('claude')) return 1.2
  if (id.includes('llama')) return 1.2
  if (id.includes('mistral')) return 1.15
  return 1.15
}

export const bedrockProvider: ProviderDefinition = {
  id: 'bedrock',
  label: 'AWS Bedrock',
  // Bedrock uses the AWS credential chain, not a coco-managed API key.
  requiresAuth: false,
  createLlm: createBedrockLlm,
  resolveEndpoint: undefined,
  tokenCorrectionFactor: bedrockTokenCorrectionFactor,
}
