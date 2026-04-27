import { Config } from '../../../commands/types'
import { DEFAULT_OPENAI_LLM_SERVICE } from '../utils'
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
