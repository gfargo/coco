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
  cost: {
    summarize: 'gpt-4.1-nano',
    commit: 'gpt-4.1-mini',
    changelog: 'gpt-4.1-mini',
    review: 'gpt-4.1-mini',
    recap: 'gpt-4.1-nano',
    repair: 'gpt-4.1-mini',
    largeDiff: 'gpt-4.1',
  },
  balanced: {
    summarize: 'gpt-4.1-mini',
    commit: 'gpt-4.1-mini',
    changelog: 'gpt-4.1',
    review: 'gpt-4.1',
    recap: 'gpt-4.1-mini',
    repair: 'gpt-4.1',
    largeDiff: 'gpt-4.1',
  },
  quality: {
    summarize: 'gpt-4.1-mini',
    commit: 'gpt-4.1',
    changelog: 'gpt-4.1',
    review: 'gpt-4.1',
    recap: 'gpt-4.1',
    repair: 'gpt-4.1',
    largeDiff: 'gpt-4.1',
  },
}

const ANTHROPIC_DYNAMIC_DEFAULTS: ProviderDynamicDefaults = {
  cost: {
    summarize: 'claude-3-5-haiku-latest',
    commit: 'claude-3-5-haiku-latest',
    changelog: 'claude-3-5-sonnet-latest',
    review: 'claude-3-5-sonnet-latest',
    recap: 'claude-3-5-haiku-latest',
    repair: 'claude-3-5-sonnet-latest',
    largeDiff: 'claude-3-5-sonnet-latest',
  },
  balanced: {
    summarize: 'claude-3-5-haiku-latest',
    commit: 'claude-3-5-sonnet-latest',
    changelog: 'claude-3-5-sonnet-latest',
    review: 'claude-3-7-sonnet-latest',
    recap: 'claude-3-5-sonnet-latest',
    repair: 'claude-3-7-sonnet-latest',
    largeDiff: 'claude-3-7-sonnet-latest',
  },
  quality: {
    summarize: 'claude-3-5-sonnet-latest',
    commit: 'claude-3-7-sonnet-latest',
    changelog: 'claude-3-7-sonnet-latest',
    review: 'claude-sonnet-4-0',
    recap: 'claude-3-7-sonnet-latest',
    repair: 'claude-sonnet-4-0',
    largeDiff: 'claude-sonnet-4-0',
  },
}

const OLLAMA_DYNAMIC_DEFAULTS: ProviderDynamicDefaults = {
  cost: {
    summarize: 'llama3.2:3b',
    commit: 'llama3.1:8b',
    changelog: 'llama3.1:8b',
    review: 'qwen2.5-coder:7b',
    recap: 'llama3.2:3b',
    repair: 'qwen2.5-coder:7b',
    largeDiff: 'qwen2.5-coder:14b',
  },
  balanced: {
    summarize: 'llama3.1:8b',
    commit: 'qwen2.5-coder:14b',
    changelog: 'qwen2.5-coder:14b',
    review: 'qwen2.5-coder:32b',
    recap: 'llama3.1:8b',
    repair: 'qwen2.5-coder:32b',
    largeDiff: 'qwen2.5-coder:32b',
  },
  quality: {
    summarize: 'qwen2.5-coder:14b',
    commit: 'qwen2.5-coder:32b',
    changelog: 'qwen2.5-coder:32b',
    review: 'qwen2.5-coder:32b',
    recap: 'qwen2.5-coder:14b',
    repair: 'qwen2.5-coder:32b',
    largeDiff: 'qwen2.5-coder:32b',
  },
}

const DYNAMIC_DEFAULTS: Record<LLMProvider, ProviderDynamicDefaults> = {
  openai: OPENAI_DYNAMIC_DEFAULTS,
  anthropic: ANTHROPIC_DYNAMIC_DEFAULTS,
  ollama: OLLAMA_DYNAMIC_DEFAULTS,
}

export const DYNAMIC_MODEL_TASKS: DynamicModelTask[] = [
  'summarize',
  'commit',
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
