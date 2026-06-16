import { Config } from '../../../commands/types'
import {
  DynamicModelPreference,
  DynamicModelTask,
  LLMModel,
  LLMProvider,
  LLMService,
} from '../types'
import { LangChainConfigurationError } from '../errors'

type ProviderDynamicDefaults = Record<DynamicModelPreference, Record<DynamicModelTask, LLMModel>>

const OPENAI_DYNAMIC_DEFAULTS: ProviderDynamicDefaults = {
  // The gpt-4.1 family retired from the API in early 2026 and now 404s.
  // Re-pinned to the current gpt-5 generation (nano → mini → 5.4 → 5.5).
  cost: {
    summarize: 'gpt-5.4-nano',
    commit: 'gpt-5.4-mini',
    // `commitSplit` floors at mini even in cost mode. The split
    // planner emits structured JSON with strict cross-group
    // constraints (files appear exactly once, hunks fully cover or
    // not at all). Nano-class models fail those constraints often
    // enough that the cost win is eaten by the 3-retry budget.
    commitSplit: 'gpt-5.4-mini',
    changelog: 'gpt-5.4-mini',
    review: 'gpt-5.4-mini',
    recap: 'gpt-5.4-nano',
    repair: 'gpt-5.4-mini',
    largeDiff: 'gpt-5.4',
  },
  balanced: {
    summarize: 'gpt-5.4-mini',
    commit: 'gpt-5.4-mini',
    commitSplit: 'gpt-5.4',
    changelog: 'gpt-5.4',
    review: 'gpt-5.4',
    recap: 'gpt-5.4-mini',
    repair: 'gpt-5.4',
    largeDiff: 'gpt-5.4',
  },
  quality: {
    summarize: 'gpt-5.4-mini',
    commit: 'gpt-5.5',
    commitSplit: 'gpt-5.5',
    changelog: 'gpt-5.5',
    review: 'gpt-5.5',
    recap: 'gpt-5.5',
    repair: 'gpt-5.5',
    largeDiff: 'gpt-5.5',
  },
}

const ANTHROPIC_DYNAMIC_DEFAULTS: ProviderDynamicDefaults = {
  // The prior Claude defaults (claude-3-5/3-7-sonnet, claude-sonnet-4-0) all
  // retired in 2025–2026 and now 404. Re-pinned to the current generation:
  // Haiku 4.5 → Sonnet 4.6 → Opus (4.6 balanced, 4.8 quality) for the gradient.
  cost: {
    summarize: 'claude-haiku-4-5',
    commit: 'claude-haiku-4-5',
    // Floor at sonnet — see note on OpenAI commitSplit above.
    commitSplit: 'claude-sonnet-4-6',
    changelog: 'claude-sonnet-4-6',
    review: 'claude-sonnet-4-6',
    recap: 'claude-haiku-4-5',
    repair: 'claude-sonnet-4-6',
    largeDiff: 'claude-sonnet-4-6',
  },
  balanced: {
    summarize: 'claude-haiku-4-5',
    commit: 'claude-sonnet-4-6',
    commitSplit: 'claude-opus-4-6',
    changelog: 'claude-sonnet-4-6',
    review: 'claude-opus-4-6',
    recap: 'claude-sonnet-4-6',
    repair: 'claude-opus-4-6',
    largeDiff: 'claude-opus-4-6',
  },
  quality: {
    summarize: 'claude-sonnet-4-6',
    commit: 'claude-opus-4-8',
    commitSplit: 'claude-opus-4-8',
    changelog: 'claude-opus-4-8',
    review: 'claude-opus-4-8',
    recap: 'claude-opus-4-8',
    repair: 'claude-opus-4-8',
    largeDiff: 'claude-opus-4-8',
  },
}

const GEMINI_DYNAMIC_DEFAULTS: ProviderDynamicDefaults = {
  cost: {
    summarize: 'gemini-2.5-flash-lite',
    commit: 'gemini-2.5-flash-lite',
    // Floor at flash — see note on OpenAI commitSplit above.
    commitSplit: 'gemini-2.5-flash',
    changelog: 'gemini-2.5-flash',
    review: 'gemini-2.5-flash',
    recap: 'gemini-2.5-flash-lite',
    repair: 'gemini-2.5-flash',
    largeDiff: 'gemini-2.5-flash',
  },
  balanced: {
    summarize: 'gemini-2.5-flash-lite',
    commit: 'gemini-2.5-flash',
    commitSplit: 'gemini-2.5-pro',
    changelog: 'gemini-2.5-flash',
    review: 'gemini-2.5-pro',
    recap: 'gemini-2.5-flash',
    repair: 'gemini-2.5-pro',
    largeDiff: 'gemini-2.5-pro',
  },
  quality: {
    summarize: 'gemini-2.5-flash',
    commit: 'gemini-2.5-pro',
    commitSplit: 'gemini-2.5-pro',
    changelog: 'gemini-2.5-pro',
    review: 'gemini-2.5-pro',
    recap: 'gemini-2.5-pro',
    repair: 'gemini-2.5-pro',
    largeDiff: 'gemini-2.5-pro',
  },
}

const MISTRAL_DYNAMIC_DEFAULTS: ProviderDynamicDefaults = {
  cost: {
    summarize: 'ministral-8b-latest',
    commit: 'ministral-8b-latest',
    // Floor at small — see note on OpenAI commitSplit above.
    commitSplit: 'mistral-small-latest',
    changelog: 'mistral-small-latest',
    review: 'mistral-small-latest',
    recap: 'ministral-8b-latest',
    repair: 'mistral-small-latest',
    largeDiff: 'mistral-small-latest',
  },
  balanced: {
    summarize: 'ministral-8b-latest',
    commit: 'mistral-small-latest',
    commitSplit: 'mistral-medium-latest',
    changelog: 'mistral-small-latest',
    review: 'mistral-medium-latest',
    recap: 'mistral-small-latest',
    repair: 'mistral-medium-latest',
    largeDiff: 'mistral-medium-latest',
  },
  quality: {
    summarize: 'mistral-small-latest',
    commit: 'mistral-medium-latest',
    commitSplit: 'mistral-large-latest',
    changelog: 'mistral-medium-latest',
    review: 'mistral-large-latest',
    recap: 'mistral-medium-latest',
    repair: 'mistral-large-latest',
    largeDiff: 'mistral-large-latest',
  },
}

const BEDROCK_DYNAMIC_DEFAULTS: ProviderDynamicDefaults = {
  // The claude-3-5 / sonnet-4-0 Bedrock ids mirrored first-party models that
  // retired in 2025–2026. Re-pinned to the current Claude generation on Bedrock
  // (Haiku 4.5 → Sonnet 4.6 → Opus 4.7 balanced / 4.8 quality).
  cost: {
    summarize: 'anthropic.claude-haiku-4-5',
    commit: 'anthropic.claude-haiku-4-5',
    // Floor at sonnet — see note on OpenAI commitSplit above.
    commitSplit: 'anthropic.claude-sonnet-4-6',
    changelog: 'anthropic.claude-sonnet-4-6',
    review: 'anthropic.claude-sonnet-4-6',
    recap: 'anthropic.claude-haiku-4-5',
    repair: 'anthropic.claude-sonnet-4-6',
    largeDiff: 'anthropic.claude-sonnet-4-6',
  },
  balanced: {
    summarize: 'anthropic.claude-haiku-4-5',
    commit: 'anthropic.claude-sonnet-4-6',
    commitSplit: 'anthropic.claude-opus-4-7',
    changelog: 'anthropic.claude-sonnet-4-6',
    review: 'anthropic.claude-opus-4-7',
    recap: 'anthropic.claude-sonnet-4-6',
    repair: 'anthropic.claude-opus-4-7',
    largeDiff: 'anthropic.claude-opus-4-7',
  },
  quality: {
    summarize: 'anthropic.claude-sonnet-4-6',
    commit: 'anthropic.claude-opus-4-8',
    commitSplit: 'anthropic.claude-opus-4-8',
    changelog: 'anthropic.claude-opus-4-8',
    review: 'anthropic.claude-opus-4-8',
    recap: 'anthropic.claude-opus-4-8',
    repair: 'anthropic.claude-opus-4-8',
    largeDiff: 'anthropic.claude-opus-4-8',
  },
}

const OLLAMA_DYNAMIC_DEFAULTS: ProviderDynamicDefaults = {
  cost: {
    summarize: 'llama3.2:3b',
    commit: 'llama3.1:8b',
    // Floor at the coder-tuned 14b — see note on OpenAI commitSplit above.
    commitSplit: 'qwen2.5-coder:14b',
    changelog: 'llama3.1:8b',
    review: 'qwen2.5-coder:7b',
    recap: 'llama3.2:3b',
    repair: 'qwen2.5-coder:7b',
    largeDiff: 'qwen2.5-coder:14b',
  },
  balanced: {
    summarize: 'llama3.1:8b',
    commit: 'qwen2.5-coder:14b',
    commitSplit: 'qwen2.5-coder:32b',
    changelog: 'qwen2.5-coder:14b',
    review: 'qwen2.5-coder:32b',
    recap: 'llama3.1:8b',
    repair: 'qwen2.5-coder:32b',
    largeDiff: 'qwen2.5-coder:32b',
  },
  quality: {
    summarize: 'qwen2.5-coder:14b',
    commit: 'qwen2.5-coder:32b',
    commitSplit: 'qwen2.5-coder:32b',
    changelog: 'qwen2.5-coder:32b',
    review: 'qwen2.5-coder:32b',
    recap: 'qwen2.5-coder:14b',
    repair: 'qwen2.5-coder:32b',
    largeDiff: 'qwen2.5-coder:32b',
  },
}

const DYNAMIC_DEFAULTS: Record<LLMProvider, ProviderDynamicDefaults> = {
  openai: OPENAI_DYNAMIC_DEFAULTS,
  // Azure hosts the same OpenAI models, so it reuses the OpenAI defaults.
  azure: OPENAI_DYNAMIC_DEFAULTS,
  anthropic: ANTHROPIC_DYNAMIC_DEFAULTS,
  gemini: GEMINI_DYNAMIC_DEFAULTS,
  mistral: MISTRAL_DYNAMIC_DEFAULTS,
  bedrock: BEDROCK_DYNAMIC_DEFAULTS,
  ollama: OLLAMA_DYNAMIC_DEFAULTS,
}

export const DYNAMIC_MODEL_TASKS: DynamicModelTask[] = [
  'summarize',
  'commit',
  'commitSplit',
  'changelog',
  'review',
  'recap',
  'repair',
  'largeDiff',
]

export function validateDynamicModelProfile(service: LLMService): void {
  const dynamicModels = service.dynamicModels
  if (!dynamicModels) return

  const unknownTasks = Object.keys(dynamicModels).filter(
    (task) => !DYNAMIC_MODEL_TASKS.includes(task as DynamicModelTask)
  )

  if (unknownTasks.length > 0) {
    throw new LangChainConfigurationError(
      `Unknown dynamic model task(s): ${unknownTasks.join(', ')}. Supported tasks: ${DYNAMIC_MODEL_TASKS.join(', ')}`,
      { unknownTasks, supportedTasks: DYNAMIC_MODEL_TASKS }
    )
  }

  Object.entries(dynamicModels as Record<string, string>).forEach(([task, model]) => {
    if (typeof model !== 'string' || model.trim() === '' || model === 'dynamic') {
      throw new LangChainConfigurationError(
        `Dynamic model override for '${task}' must be a concrete model name`,
        { task, model }
      )
    }
  })
}

export function resolveDynamicModel(config: Config, task: DynamicModelTask): LLMModel {
  const service = config.service
  validateDynamicModelProfile(service)

  if (service.model !== 'dynamic') {
    return service.model as LLMModel
  }

  const preference = service.dynamicModelPreference || 'balanced'
  const providerDefaults = DYNAMIC_DEFAULTS[service.provider]
  const defaultModel = providerDefaults[preference]?.[task]

  return service.dynamicModels?.[task] || defaultModel
}

export function resolveDynamicService(config: Config, task: DynamicModelTask): LLMService {
  const model = resolveDynamicModel(config, task)
  return {
    ...config.service,
    model,
  } as LLMService
}

export function getDynamicModelDefaults(provider: LLMProvider, preference: DynamicModelPreference = 'balanced') {
  return DYNAMIC_DEFAULTS[provider][preference]
}
