import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { Config } from '../../../commands/types'
import type { LLMProvider } from '../types'
import { createOpenAiLlm } from './openai'
import type { CreateLlmArgs, ProviderDefinition } from './types'

export type OpenAiCompatiblePresetOptions = {
  /** Stable provider id, e.g. 'deepseek'. */
  id: LLMProvider
  /** Human-facing label for the init wizard and doctor output. */
  label: string
  /**
   * Endpoint used when `service.baseURL` is unset. Presets without a
   * universal default (none today, but future ones might) can omit this and
   * require the user to set `service.baseURL` themselves.
   */
  defaultBaseURL?: string
  /** Whether the preset needs an API key (false for local/self-hosted servers). */
  requiresAuth: boolean
  /**
   * Multiplier applied to the gpt-4o tiktoken baseline when counting tokens
   * for this preset — see `ProviderDefinition.tokenCorrectionFactor`. An
   * approximation (the ticket's own risk note), not a precise per-model
   * tokenizer; the goal is to stop undercounting non-tiktoken-family
   * prompts against `enforcePromptBudget`, not to be exact.
   */
  tokenCorrectionFactor?: number | ((model: string) => number)
}

function resolveBaseURL(config: Config, defaultBaseURL?: string): string | undefined {
  const configured = 'baseURL' in config.service ? config.service.baseURL : undefined
  return configured || defaultBaseURL
}

/**
 * Stamps out a `ProviderDefinition` for an OpenAI-compatible API — one that
 * accepts the same request/response shape as the OpenAI chat-completions
 * API but is hosted at a different endpoint (DeepSeek, Groq, xAI, Together,
 * Fireworks, OpenRouter, LM Studio, vLLM). Reuses `createOpenAiLlm` so all of
 * OpenAI's config-forwarding (temperature, maxTokens, fields merge, request
 * timeout) applies identically; the only per-preset behavior is which
 * endpoint to default to, whether auth is required, and the token-count
 * correction factor.
 */
export function createOpenAiCompatibleProvider(
  opts: OpenAiCompatiblePresetOptions
): ProviderDefinition {
  return {
    id: opts.id,
    label: opts.label,
    requiresAuth: opts.requiresAuth,
    createLlm: (args: CreateLlmArgs): Promise<BaseChatModel> =>
      createOpenAiLlm(args, opts.defaultBaseURL),
    resolveEndpoint: (config: Config) => resolveBaseURL(config, opts.defaultBaseURL),
    defaultBaseURL: opts.defaultBaseURL,
    tokenCorrectionFactor: opts.tokenCorrectionFactor,
  }
}

/** All first-class OpenAI-compatible provider ids (excludes plain `openai` itself). */
export const OPENAI_COMPATIBLE_PROVIDER_IDS: LLMProvider[] = [
  'deepseek',
  'groq',
  'xai',
  'together',
  'fireworks',
  'openrouter',
  'lmstudio',
  'vllm',
]

export const deepseekProvider = createOpenAiCompatibleProvider({
  id: 'deepseek',
  label: 'DeepSeek',
  defaultBaseURL: 'https://api.deepseek.com/v1',
  requiresAuth: true,
  // DeepSeek's own tokenizer runs slightly denser than tiktoken on
  // code-heavy prompts.
  tokenCorrectionFactor: 1.1,
})

export const groqProvider = createOpenAiCompatibleProvider({
  id: 'groq',
  label: 'Groq',
  defaultBaseURL: 'https://api.groq.com/openai/v1',
  requiresAuth: true,
  // Groq hosts Llama/Qwen-class open models — same family Ollama corrects for.
  tokenCorrectionFactor: 1.2,
})

export const xaiProvider = createOpenAiCompatibleProvider({
  id: 'xai',
  label: 'xAI (Grok)',
  defaultBaseURL: 'https://api.x.ai/v1',
  requiresAuth: true,
  tokenCorrectionFactor: 1.15,
})

export const togetherProvider = createOpenAiCompatibleProvider({
  id: 'together',
  label: 'Together AI',
  defaultBaseURL: 'https://api.together.xyz/v1',
  requiresAuth: true,
  // Together hosts Llama/Mixtral/Qwen-class open models.
  tokenCorrectionFactor: 1.2,
})

export const fireworksProvider = createOpenAiCompatibleProvider({
  id: 'fireworks',
  label: 'Fireworks AI',
  defaultBaseURL: 'https://api.fireworks.ai/inference/v1',
  requiresAuth: true,
  tokenCorrectionFactor: 1.2,
})

export const openrouterProvider = createOpenAiCompatibleProvider({
  id: 'openrouter',
  label: 'OpenRouter',
  defaultBaseURL: 'https://openrouter.ai/api/v1',
  requiresAuth: true,
  // OpenRouter proxies many different upstream tokenizers under one API —
  // a blended estimate, not a precise count for any single model.
  tokenCorrectionFactor: 1.15,
})

export const lmstudioProvider = createOpenAiCompatibleProvider({
  id: 'lmstudio',
  label: 'LM Studio (local)',
  defaultBaseURL: 'http://localhost:1234/v1',
  requiresAuth: false,
  tokenCorrectionFactor: 1.2,
})

export const vllmProvider = createOpenAiCompatibleProvider({
  id: 'vllm',
  label: 'vLLM (self-hosted)',
  defaultBaseURL: 'http://localhost:8000/v1',
  requiresAuth: false,
  tokenCorrectionFactor: 1.2,
})
