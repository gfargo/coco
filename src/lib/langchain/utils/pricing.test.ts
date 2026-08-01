import { estimateCostUsd, getModelPrice, PRICES_AS_OF } from './pricing'

describe('pricing', () => {
  it('exports a pricesAsOf date string', () => {
    expect(typeof PRICES_AS_OF).toBe('string')
    expect(PRICES_AS_OF).toMatch(/^\d{4}-\d{2}$/)
  })

  it('resolves a known model to its price', () => {
    expect(getModelPrice('gpt-5.4-mini')).toEqual({ inputPer1M: 1, outputPer1M: 4 })
  })

  it('returns undefined for an unknown model', () => {
    expect(getModelPrice('some-model-that-does-not-exist')).toBeUndefined()
    expect(estimateCostUsd({ model: 'some-model-that-does-not-exist', promptTokens: 100 })).toBeUndefined()
  })

  it('resolves a Bedrock anthropic.* id by stripping the prefix', () => {
    expect(getModelPrice('anthropic.claude-opus-4-8')).toEqual(getModelPrice('claude-opus-4-8'))
  })

  it('treats ollama models as free regardless of the exact model id', () => {
    expect(getModelPrice('llama3.1:8b', 'ollama')).toEqual({ inputPer1M: 0, outputPer1M: 0 })
    expect(estimateCostUsd({ model: 'llama3.1:8b', provider: 'ollama', promptTokens: 1000, completionTokens: 500 })).toBe(0)
  })

  it('returns undefined when both token counts are absent, even for a priced model', () => {
    expect(estimateCostUsd({ model: 'gpt-5.4-mini' })).toBeUndefined()
  })

  it('computes cost from prompt and completion tokens separately', () => {
    // gpt-5.4-mini: $1/1M in, $4/1M out
    const cost = estimateCostUsd({ model: 'gpt-5.4-mini', promptTokens: 1_000_000, completionTokens: 500_000 })
    expect(cost).toBeCloseTo(1 + 2, 10)
  })

  it('treats a missing completionTokens as 0 when promptTokens is present', () => {
    const cost = estimateCostUsd({ model: 'gpt-5.4-nano', promptTokens: 1_000_000 })
    expect(cost).toBeCloseTo(0.15, 10)
  })
})
