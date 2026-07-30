import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { DEFAULT_MAX_OUTPUT_TOKENS } from './constants'
import { resolveTemperature, toAnthropicEffort } from './reasoning'
import type { CreateLlmArgs, ProviderDefinition } from './types'

async function createAnthropicLlm({ model, config, apiKey }: CreateLlmArgs): Promise<BaseChatModel> {
  const { ChatAnthropic } = await import('@langchain/anthropic')
  const reasoningEffort = config.service.reasoningEffort

  const anthropicConfig: ConstructorParameters<typeof ChatAnthropic>[0] = {
    anthropicApiKey: apiKey,
    maxConcurrency: config.service.maxConcurrent,
    // Disable LangChain's built-in AsyncCaller retries (#1677).
    maxRetries: config.service.requestOptions?.maxRetries ?? 0,
    model,
    // Extended thinking rejects any temperature other than 1 (an *unset*
    // temperature is fine; an explicit 0.2 default — or any other explicit
    // non-1 value — is not), so normalize it away whenever reasoning is
    // requested and let the SDK's own default apply. See `resolveTemperature`.
    temperature: resolveTemperature(reasoningEffort, config.service.temperature),
    maxTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    // Extended thinking is graded via `outputConfig.effort`, not just
    // toggled — `thinking: adaptive` enables it, `outputConfig.effort` sets
    // how many tokens it's allowed to spend.
    ...(reasoningEffort
      ? {
          thinking: { type: 'adaptive' as const },
          outputConfig: { effort: toAnthropicEffort(reasoningEffort) },
        }
      : {}),
    ...(config.service.requestOptions?.timeout
      ? { clientOptions: { timeout: config.service.requestOptions.timeout } }
      : {}),
  }

  // Custom endpoint for proxies / gateways.
  if ('baseURL' in config.service && config.service.baseURL) {
    anthropicConfig.anthropicApiUrl = config.service.baseURL
  }

  // Merge Anthropic-specific fields (temperature, maxTokens, ...).
  if ('fields' in config.service && config.service.fields) {
    Object.assign(anthropicConfig, config.service.fields)
  }

  const llm = new ChatAnthropic(anthropicConfig)

  // `cache_control` is a per-call option in this SDK, not a constructor
  // field. `withConfig` bakes it into every `chain.invoke()`/`.stream()`
  // without touching call sites — it auto-applies the cache breakpoint to
  // the last cacheable block and advances it as the conversation grows, so
  // no manual message-block placement is needed.
  if (config.service.promptCache) {
    return llm.withConfig({ cache_control: { type: 'ephemeral' } }) as unknown as BaseChatModel
  }

  return llm
}

export const anthropicProvider: ProviderDefinition = {
  id: 'anthropic',
  label: 'Anthropic',
  requiresAuth: true,
  createLlm: createAnthropicLlm,
  resolveEndpoint: (config) =>
    'baseURL' in config.service ? config.service.baseURL : undefined,
  // Claude tokenizes code ~1.15-1.3x more tokens than the gpt-4o tiktoken
  // baseline (per the AI-core token-counting audit); 1.2 is a middle estimate.
  tokenCorrectionFactor: 1.2,
  supportsPromptCache: true,
  supportsReasoningEffort: true,
}
