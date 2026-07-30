import { findOpenAiCompatiblePreset, OPENAI_COMPATIBLE_PRESETS } from './openAiCompatiblePresets'

describe('OPENAI_COMPATIBLE_PRESETS', () => {
  // OpenRouter/Groq/LM Studio/vLLM moved out to first-class providers
  // (#OSS-1623) — only the generic custom-URL fallback remains here.
  it('only has the custom fallback preset', () => {
    const ids = OPENAI_COMPATIBLE_PRESETS.map((preset) => preset.id)
    expect(ids).toEqual(['custom'])
  })

  it('the custom preset has no fixed baseURL and no required API key', () => {
    const byId = Object.fromEntries(OPENAI_COMPATIBLE_PRESETS.map((p) => [p.id, p]))
    expect(byId.custom.baseURL).toBeUndefined()
    expect(byId.custom.requiresApiKey).toBe(false)
  })
})

describe('findOpenAiCompatiblePreset', () => {
  it('finds a preset by id', () => {
    expect(findOpenAiCompatiblePreset('custom')?.label).toBe('Custom OpenAI-compatible URL')
  })

  it('returns undefined for an unknown id', () => {
    expect(findOpenAiCompatiblePreset('nope')).toBeUndefined()
  })
})
