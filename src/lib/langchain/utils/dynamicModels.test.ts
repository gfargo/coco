import { Config } from '../../../commands/types'
import {
  DEFAULT_ANTHROPIC_LLM_SERVICE,
  DEFAULT_AZURE_LLM_SERVICE,
  DEFAULT_BEDROCK_LLM_SERVICE,
  DEFAULT_GEMINI_LLM_SERVICE,
  DEFAULT_MISTRAL_LLM_SERVICE,
  DEFAULT_OLLAMA_LLM_SERVICE,
  DEFAULT_OPENAI_LLM_SERVICE,
} from '../utils'
import { DynamicModelPreference, LLMProvider, LLMService } from '../types'
import {
  getDynamicModelDefaults,
  resolveDynamicModel,
  resolveDynamicService,
  validateDynamicModelProfile,
} from './dynamicModels'

const baseConfig = {
  mode: 'stdout',
  defaultBranch: 'main',
  service: {
    ...DEFAULT_OPENAI_LLM_SERVICE,
    model: 'dynamic',
    authentication: {
      type: 'APIKey',
      credentials: {
        apiKey: 'test',
      },
    },
  },
} as Config

const providerServices: Record<LLMProvider, LLMService> = {
  openai: DEFAULT_OPENAI_LLM_SERVICE,
  anthropic: DEFAULT_ANTHROPIC_LLM_SERVICE,
  azure: DEFAULT_AZURE_LLM_SERVICE,
  gemini: DEFAULT_GEMINI_LLM_SERVICE,
  mistral: DEFAULT_MISTRAL_LLM_SERVICE,
  bedrock: DEFAULT_BEDROCK_LLM_SERVICE,
  ollama: DEFAULT_OLLAMA_LLM_SERVICE,
}
const providerOverrides = {
  openai: {
    summarize: 'gpt-5.4-nano',
    largeDiff: 'gpt-5.4-mini',
  },
  azure: {
    summarize: 'gpt-5.4-nano',
    largeDiff: 'gpt-5.4-mini',
  },
  anthropic: {
    summarize: 'claude-haiku-4-5',
    largeDiff: 'claude-sonnet-4-6',
  },
  gemini: {
    summarize: 'gemini-2.5-flash-lite',
    largeDiff: 'gemini-2.5-flash',
  },
  mistral: {
    summarize: 'ministral-8b-latest',
    largeDiff: 'mistral-small-latest',
  },
  ollama: {
    summarize: 'llama3.2:3b',
    largeDiff: 'qwen2.5-coder:14b',
  },
} as const

function createDynamicConfig(
  provider: LLMProvider,
  dynamicModelPreference: DynamicModelPreference = 'balanced'
): Config {
  return {
    ...baseConfig,
    service: {
      ...providerServices[provider],
      provider,
      model: 'dynamic',
      dynamicModelPreference,
    },
  } as Config
}

describe('dynamic model routing', () => {
  it('preserves explicit model behavior', () => {
    const config = {
      ...baseConfig,
      service: {
        ...baseConfig.service,
        model: 'gpt-4o-mini',
      },
    } as Config

    expect(resolveDynamicModel(config, 'commit')).toBe('gpt-4o-mini')
  })

  it('uses provider defaults when model is dynamic', () => {
    expect(resolveDynamicModel(baseConfig, 'summarize')).toBe('gpt-5.4-mini')
    expect(resolveDynamicModel(baseConfig, 'review')).toBe('gpt-5.4')
  })

  it.each([
    ['openai', 'cost', 'gpt-5.4-nano', 'gpt-5.4-mini', 'gpt-5.4'] as const,
    ['openai', 'balanced', 'gpt-5.4-mini', 'gpt-5.4-mini', 'gpt-5.4'] as const,
    ['openai', 'quality', 'gpt-5.4-mini', 'gpt-5.5', 'gpt-5.5'] as const,
    ['anthropic', 'cost', 'claude-haiku-4-5', 'claude-haiku-4-5', 'claude-sonnet-4-6'] as const,
    ['anthropic', 'balanced', 'claude-haiku-4-5', 'claude-sonnet-4-6', 'claude-opus-4-6'] as const,
    ['anthropic', 'quality', 'claude-sonnet-4-6', 'claude-opus-4-8', 'claude-opus-4-8'] as const,
    ['mistral', 'cost', 'ministral-8b-latest', 'ministral-8b-latest', 'mistral-small-latest'] as const,
    ['mistral', 'balanced', 'ministral-8b-latest', 'mistral-small-latest', 'mistral-medium-latest'] as const,
    ['mistral', 'quality', 'mistral-small-latest', 'mistral-medium-latest', 'mistral-large-latest'] as const,
    ['ollama', 'cost', 'llama3.2:3b', 'llama3.1:8b', 'qwen2.5-coder:14b'] as const,
    ['ollama', 'balanced', 'llama3.1:8b', 'qwen2.5-coder:14b', 'qwen2.5-coder:32b'] as const,
    ['ollama', 'quality', 'qwen2.5-coder:14b', 'qwen2.5-coder:32b', 'qwen2.5-coder:32b'] as const,
  ])(
    'uses %s %s defaults for summarize, commit, and largeDiff',
    (provider, preference, summarize, commit, largeDiff) => {
      const config = createDynamicConfig(provider, preference)

      expect(resolveDynamicModel(config, 'summarize')).toBe(summarize)
      expect(resolveDynamicModel(config, 'commit')).toBe(commit)
      expect(resolveDynamicModel(config, 'largeDiff')).toBe(largeDiff)
    }
  )

  it('supports user task overrides', () => {
    const config = {
      ...baseConfig,
      service: {
        ...baseConfig.service,
        dynamicModels: {
          summarize: 'gpt-5.4-nano',
          commit: 'gpt-5.5',
        },
      },
    } as Config

    expect(resolveDynamicModel(config, 'summarize')).toBe('gpt-5.4-nano')
    expect(resolveDynamicModel(config, 'commit')).toBe('gpt-5.5')
    expect(resolveDynamicModel(config, 'review')).toBe('gpt-5.4')
  })

  it.each(['openai', 'anthropic', 'gemini', 'mistral', 'ollama'] as const)(
    'lets user overrides win over %s provider defaults',
    (provider) => {
      const baseProviderConfig = createDynamicConfig(provider, 'quality')
      const overrides = providerOverrides[provider]
      const config = {
        ...baseProviderConfig,
        service: {
          ...baseProviderConfig.service,
          dynamicModels: overrides,
        },
      } as Config

      expect(resolveDynamicModel(config, 'summarize')).toBe(overrides.summarize)
      expect(resolveDynamicModel(config, 'largeDiff')).toBe(overrides.largeDiff)
      expect(resolveDynamicModel(config, 'commit')).toBe(
        getDynamicModelDefaults(provider, 'quality').commit
      )
    }
  )

  it.each([
    ['openai', 'cost', 'gpt-5.4-mini'] as const,
    ['openai', 'balanced', 'gpt-5.4'] as const,
    ['openai', 'quality', 'gpt-5.5'] as const,
    ['anthropic', 'cost', 'claude-sonnet-4-6'] as const,
    ['anthropic', 'balanced', 'claude-opus-4-6'] as const,
    ['anthropic', 'quality', 'claude-opus-4-8'] as const,
    ['gemini', 'cost', 'gemini-2.5-flash'] as const,
    ['gemini', 'balanced', 'gemini-2.5-pro'] as const,
    ['gemini', 'quality', 'gemini-2.5-pro'] as const,
    ['mistral', 'cost', 'mistral-small-latest'] as const,
    ['mistral', 'balanced', 'mistral-medium-latest'] as const,
    ['mistral', 'quality', 'mistral-large-latest'] as const,
    ['ollama', 'cost', 'qwen2.5-coder:14b'] as const,
    ['ollama', 'balanced', 'qwen2.5-coder:32b'] as const,
    ['ollama', 'quality', 'qwen2.5-coder:32b'] as const,
  ])(
    'floors %s %s commitSplit above the base commit model',
    (provider, preference, expected) => {
      const config = createDynamicConfig(provider, preference)
      expect(resolveDynamicModel(config, 'commitSplit')).toBe(expected)
    }
  )

  it('supports preference-specific defaults', () => {
    const config = {
      ...baseConfig,
      service: {
        ...baseConfig.service,
        dynamicModelPreference: 'cost',
      },
    } as Config

    expect(resolveDynamicModel(config, 'summarize')).toBe('gpt-5.4-nano')
  })

  it('returns a concrete service config for a task', () => {
    const service = resolveDynamicService(baseConfig, 'commit')

    expect(service.provider).toBe('openai')
    expect(service.model).toBe('gpt-5.4-mini')
  })

  it('rejects unknown dynamic task keys', () => {
    const config = {
      ...baseConfig,
      service: {
        ...baseConfig.service,
        dynamicModels: {
          unknownTask: 'gpt-5.5',
        },
      },
    } as unknown as Config

    expect(() => validateDynamicModelProfile(config.service)).toThrow(
      'Unknown dynamic model task'
    )
  })

  it('rejects dynamic model overrides that are not concrete models', () => {
    const config = {
      ...baseConfig,
      service: {
        ...baseConfig.service,
        dynamicModels: {
          summarize: 'dynamic',
        },
      },
    } as unknown as Config

    expect(() => validateDynamicModelProfile(config.service)).toThrow(
      'must be a concrete model name'
    )
  })

  it('exposes provider defaults for documentation and UI use', () => {
    expect(getDynamicModelDefaults('openai')).toMatchObject({
      summarize: expect.any(String),
      commit: expect.any(String),
      review: expect.any(String),
    })
  })
})
