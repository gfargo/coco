import { validateModel, validateServiceConfig } from './validation'
import { LangChainValidationError } from './errors'
import { getDefaultServiceConfigFromAlias } from './utils'

describe('validateModel (#1243 — per-provider validity)', () => {
  it('accepts a model that matches its provider', () => {
    expect(() => validateModel('gpt-5.5', 'openai')).not.toThrow()
    expect(() => validateModel('claude-sonnet-4-6', 'anthropic')).not.toThrow()
  })

  it('accepts the dynamic sentinel and open-namespace providers', () => {
    expect(() => validateModel('dynamic', 'openai')).not.toThrow()
    expect(() => validateModel('llama3.1:8b', 'ollama')).not.toThrow()
    expect(() => validateModel('gpt-5.5', 'azure')).not.toThrow() // azure shares openai ids
  })

  it('accepts unrecognized / new models for the right provider', () => {
    expect(() => validateModel('gpt-5-ultra-turbo', 'openai')).not.toThrow()
  })

  it('throws on a definite cross-provider mismatch', () => {
    expect(() => validateModel('claude-sonnet-4-6', 'openai')).toThrow(
      LangChainValidationError,
    )
    expect(() => validateModel('gpt-5.5', 'anthropic')).toThrow(/is a openai model, not a anthropic/)
  })

  it('still rejects empty / non-string models', () => {
    expect(() => validateModel('', 'openai')).toThrow(LangChainValidationError)
    expect(() => validateModel('   ', 'openai')).toThrow(/non-empty string/)
  })
})

describe('validateModel (#1456 — deprecated model ids)', () => {
  it('rejects a known-deprecated model before any request is made', () => {
    expect(() => validateModel('gpt-4o', 'openai')).toThrow(LangChainValidationError)
    expect(() => validateModel('gpt-4o', 'openai')).toThrow(/retired/)
    expect(() => validateModel('gpt-4o', 'openai')).toThrow(/gpt-5\.4-mini/)
  })

  it('surfaces the curated replacement for deprecated ids across providers', () => {
    expect(() => validateModel('claude-3-5-sonnet-latest', 'anthropic')).toThrow(
      /claude-sonnet-4-6/,
    )
    expect(() => validateModel('gemini-1.5-flash', 'gemini')).toThrow(/gemini-2\.5-flash/)
    expect(() =>
      validateModel('anthropic.claude-3-5-sonnet-20241022-v2:0', 'bedrock'),
    ).toThrow(/anthropic\.claude-sonnet-4-6/)
  })

  it('still rejects a deprecated id under the first-party openai provider', () => {
    expect(() => validateModel('gpt-4.1-nano', 'openai')).toThrow(/retired/)
  })

  it('does not hard-block a deprecated-looking id under azure — deployment names are user-defined', () => {
    expect(() => validateModel('gpt-4.1-nano', 'azure')).not.toThrow()
  })
})

describe('validateServiceConfig (OSS-975 — shipped defaults pass their own validation)', () => {
  it('accepts every provider default straight out of getDefaultServiceConfigFromAlias', () => {
    const providers = ['openai', 'anthropic', 'azure', 'gemini', 'mistral', 'bedrock', 'ollama'] as const
    for (const provider of providers) {
      expect(() => validateServiceConfig(getDefaultServiceConfigFromAlias(provider))).not.toThrow()
    }
  })
})
