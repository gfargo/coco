import {
  detectProviderMismatch,
  findModelOwner,
  getDeprecatedReplacement,
} from './modelValidity'

describe('findModelOwner', () => {
  it('resolves a model to its closed-namespace provider', () => {
    expect(findModelOwner('gpt-5.5')).toBe('openai')
    expect(findModelOwner('claude-sonnet-4-6')).toBe('anthropic')
    expect(findModelOwner('gemini-2.5-pro')).toBe('gemini')
    expect(findModelOwner('mistral-large-latest')).toBe('mistral')
    expect(findModelOwner('anthropic.claude-3-5-sonnet-20241022-v2:0')).toBe('bedrock')
  })

  it('returns null for unrecognized / open-namespace models', () => {
    expect(findModelOwner('llama3.1:8b')).toBeNull()
    expect(findModelOwner('gpt-5-ultra-turbo')).toBeNull()
    expect(findModelOwner('dynamic')).toBeNull()
  })

  it('recognizes the o-series reasoning models (regression: o3 typo)', () => {
    // `OPEN_AI_MODELS` previously listed these as `'03'` / `'03-mini'` (zero,
    // not the letter o), so the real models went unrecognized and the typo'd
    // ids were offered in the init picker.
    expect(findModelOwner('o3')).toBe('openai')
    expect(findModelOwner('o3-mini')).toBe('openai')
    expect(findModelOwner('o4-mini')).toBe('openai')
    expect(findModelOwner('03')).toBeNull()
    expect(findModelOwner('03-mini')).toBeNull()
  })
})

describe('getDeprecatedReplacement', () => {
  it('maps retired ids to a current replacement', () => {
    // gpt-4o / gpt-4.1 family retired → current gpt-5 generation.
    expect(getDeprecatedReplacement('gpt-4-turbo-preview')).toBe('gpt-5.4-mini')
    expect(getDeprecatedReplacement('gpt-4.1')).toBe('gpt-5.4-mini')
    // The whole pre-4.x Claude lineup retired → current first-party models.
    expect(getDeprecatedReplacement('claude-3-opus-20240229')).toBe('claude-opus-4-8')
    expect(getDeprecatedReplacement('claude-3-5-sonnet-latest')).toBe('claude-sonnet-4-6')
    expect(getDeprecatedReplacement('claude-sonnet-4-0')).toBe('claude-sonnet-4-6')
    // Gemini 1.5 / 2.0 shut down → current 2.5 / 3.x generation.
    expect(getDeprecatedReplacement('gemini-1.5-pro')).toBe('gemini-2.5-pro')
    expect(getDeprecatedReplacement('gemini-2.0-flash')).toBe('gemini-2.5-flash')
  })

  it('returns undefined for current models', () => {
    expect(getDeprecatedReplacement('gpt-5.5')).toBeUndefined()
  })
})

describe('detectProviderMismatch', () => {
  it('flags a model that belongs to a different provider', () => {
    expect(detectProviderMismatch('claude-sonnet-4-6', 'openai')).toBe('anthropic')
    expect(detectProviderMismatch('gpt-5.5', 'anthropic')).toBe('openai')
    // a bedrock model under plain anthropic is a mismatch (owner: bedrock)
    expect(detectProviderMismatch('anthropic.claude-3-5-sonnet-20241022-v2:0', 'anthropic')).toBe(
      'bedrock',
    )
  })

  it('accepts a correctly-matched model', () => {
    expect(detectProviderMismatch('gpt-5.5', 'openai')).toBeNull()
    expect(detectProviderMismatch('claude-sonnet-4-6', 'anthropic')).toBeNull()
  })

  it('treats azure as sharing the OpenAI namespace', () => {
    expect(detectProviderMismatch('gpt-5.5', 'azure')).toBeNull()
  })

  it('never gates the dynamic sentinel, ollama, or unrecognized models', () => {
    expect(detectProviderMismatch('dynamic', 'openai')).toBeNull()
    expect(detectProviderMismatch('llama3.1:8b', 'ollama')).toBeNull()
    // a new/unlisted model for the right provider is NOT a definite mismatch
    expect(detectProviderMismatch('gpt-5-ultra-turbo', 'openai')).toBeNull()
    // even an openai model under ollama is left alone (open namespace)
    expect(detectProviderMismatch('gpt-5.5', 'ollama')).toBeNull()
  })
})
