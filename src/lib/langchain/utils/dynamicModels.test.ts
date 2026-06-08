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
    summarize: 'gpt-4.1-nano',
    largeDiff: 'gpt-4.1-mini',
  },
  azure: {
    summarize: 'gpt-4.1-nano',
    largeDiff: 'gpt-4.1-mini',
  },
  anthropic: {
    summarize: 'claude-3-5-haiku-latest',
    largeDiff: 'claude-3-7-sonnet-latest',
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
    expect(resolveDynamicModel(baseConfig, 'summarize')).toBe('gpt-4.1-mini')
    expect(resolveDynamicModel(baseConfig, 'review')).toBe('gpt-4.1')
  })

  it.each([
    ['openai', 'cost', 'gpt-4.1-nano', 'gpt-4.1-mini', 'gpt-4.1'] as const,
    ['openai', 'balanced', 'gpt-4.1-mini', 'gpt-4.1-mini', 'gpt-4.1'] as const,
    ['openai', 'quality', 'gpt-4.1-mini', 'gpt-4.1', 'gpt-4.1'] as const,
    ['anthropic', 'cost', 'claude-3-5-haiku-latest', 'claude-3-5-haiku-latest', 'claude-3-5-sonnet-latest'] as const,
    ['anthropic', 'balanced', 'claude-3-5-haiku-latest', 'claude-3-5-sonnet-latest', 'claude-3-7-sonnet-latest'] as const,
    ['anthropic', 'quality', 'claude-3-5-sonnet-latest', 'claude-3-7-sonnet-latest', 'claude-sonnet-4-0'] as const,
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
          summarize: 'gpt-4.1-nano',
          commit: 'gpt-4o',
        },
      },
    } as Config

    expect(resolveDynamicModel(config, 'summarize')).toBe('gpt-4.1-nano')
    expect(resolveDynamicModel(config, 'commit')).toBe('gpt-4o')
    expect(resolveDynamicModel(config, 'review')).toBe('gpt-4.1')
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
    ['openai', 'cost', 'gpt-4.1-mini'] as const,
    ['openai', 'balanced', 'gpt-4.1'] as const,
    ['openai', 'quality', 'gpt-4.1'] as const,
    ['anthropic', 'cost', 'claude-3-5-sonnet-latest'] as const,
    ['anthropic', 'balanced', 'claude-3-7-sonnet-latest'] as const,
    ['anthropic', 'quality', 'claude-sonnet-4-0'] as const,
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

    expect(resolveDynamicModel(config, 'summarize')).toBe('gpt-4.1-nano')
  })

  it('returns a concrete service config for a task', () => {
    const service = resolveDynamicService(baseConfig, 'commit')

    expect(service.provider).toBe('openai')
    expect(service.model).toBe('gpt-4.1-mini')
  })

  it('rejects unknown dynamic task keys', () => {
    const config = {
      ...baseConfig,
      service: {
        ...baseConfig.service,
        dynamicModels: {
          unknownTask: 'gpt-4o',
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
