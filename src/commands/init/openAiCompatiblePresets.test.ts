import { findOpenAiCompatiblePreset, OPENAI_COMPATIBLE_PRESETS } from './openAiCompatiblePresets'

describe('OPENAI_COMPATIBLE_PRESETS', () => {
  it('includes OpenRouter, Groq, LM Studio, vLLM, and a custom fallback', () => {
    const ids = OPENAI_COMPATIBLE_PRESETS.map((preset) => preset.id)
    expect(ids).toEqual(['openrouter', 'groq', 'lmstudio', 'vllm', 'custom'])
  })

  it('gives fixed-endpoint presets a baseURL and self-hosted ones none', () => {
    const byId = Object.fromEntries(OPENAI_COMPATIBLE_PRESETS.map((p) => [p.id, p]))
    expect(byId.openrouter.baseURL).toBe('https://openrouter.ai/api/v1')
    expect(byId.groq.baseURL).toBeTruthy()
    expect(byId.lmstudio.baseURL).toBe('http://localhost:1234/v1')
    expect(byId.vllm.baseURL).toBeUndefined()
    expect(byId.custom.baseURL).toBeUndefined()
  })

  it('only requires an API key for the hosted presets', () => {
    const byId = Object.fromEntries(OPENAI_COMPATIBLE_PRESETS.map((p) => [p.id, p]))
    expect(byId.openrouter.requiresApiKey).toBe(true)
    expect(byId.groq.requiresApiKey).toBe(true)
    expect(byId.lmstudio.requiresApiKey).toBe(false)
    expect(byId.vllm.requiresApiKey).toBe(false)
    expect(byId.custom.requiresApiKey).toBe(false)
  })
})

describe('findOpenAiCompatiblePreset', () => {
  it('finds a preset by id', () => {
    expect(findOpenAiCompatiblePreset('groq')?.label).toBe('Groq')
  })

  it('returns undefined for an unknown id', () => {
    expect(findOpenAiCompatiblePreset('nope')).toBeUndefined()
  })
})
