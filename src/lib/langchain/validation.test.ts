import { validateModel } from './validation'
import { LangChainValidationError } from './errors'

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
