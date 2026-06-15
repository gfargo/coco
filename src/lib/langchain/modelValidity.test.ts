import {
  detectProviderMismatch,
  findModelOwner,
  getDeprecatedReplacement,
} from './modelValidity'

describe('findModelOwner', () => {
  it('resolves a model to its closed-namespace provider', () => {
    expect(findModelOwner('gpt-4o')).toBe('openai')
    expect(findModelOwner('claude-3-5-sonnet-latest')).toBe('anthropic')
    expect(findModelOwner('gemini-2.5-pro')).toBe('gemini')
    expect(findModelOwner('mistral-large-latest')).toBe('mistral')
    expect(findModelOwner('anthropic.claude-3-5-sonnet-20241022-v2:0')).toBe('bedrock')
  })

  it('returns null for unrecognized / open-namespace models', () => {
    expect(findModelOwner('llama3.1:8b')).toBeNull()
    expect(findModelOwner('gpt-5-ultra-turbo')).toBeNull()
    expect(findModelOwner('dynamic')).toBeNull()
  })
})

describe('getDeprecatedReplacement', () => {
  it('maps retired ids to a replacement', () => {
    expect(getDeprecatedReplacement('gpt-4-turbo-preview')).toBe('gpt-4o')
    expect(getDeprecatedReplacement('claude-3-opus-20240229')).toBe('claude-sonnet-4-0')
  })

  it('returns undefined for current models', () => {
    expect(getDeprecatedReplacement('gpt-4o')).toBeUndefined()
  })
})

describe('detectProviderMismatch', () => {
  it('flags a model that belongs to a different provider', () => {
    expect(detectProviderMismatch('claude-3-5-sonnet-latest', 'openai')).toBe('anthropic')
    expect(detectProviderMismatch('gpt-4o', 'anthropic')).toBe('openai')
    // a bedrock model under plain anthropic is a mismatch (owner: bedrock)
    expect(detectProviderMismatch('anthropic.claude-3-5-sonnet-20241022-v2:0', 'anthropic')).toBe(
      'bedrock',
    )
  })

  it('accepts a correctly-matched model', () => {
    expect(detectProviderMismatch('gpt-4o', 'openai')).toBeNull()
    expect(detectProviderMismatch('claude-3-5-sonnet-latest', 'anthropic')).toBeNull()
  })

  it('treats azure as sharing the OpenAI namespace', () => {
    expect(detectProviderMismatch('gpt-4o', 'azure')).toBeNull()
  })

  it('never gates the dynamic sentinel, ollama, or unrecognized models', () => {
    expect(detectProviderMismatch('dynamic', 'openai')).toBeNull()
    expect(detectProviderMismatch('llama3.1:8b', 'ollama')).toBeNull()
    // a new/unlisted model for the right provider is NOT a definite mismatch
    expect(detectProviderMismatch('gpt-5-ultra-turbo', 'openai')).toBeNull()
    // even an openai model under ollama is left alone (open namespace)
    expect(detectProviderMismatch('gpt-4o', 'ollama')).toBeNull()
  })
})
