import { resolveTemperature, toGeminiThinkingLevel } from './reasoning'

describe('resolveTemperature', () => {
  it('defaults to 0.2 when neither reasoningEffort nor temperature is set', () => {
    expect(resolveTemperature(undefined, undefined)).toBe(0.2)
  })

  it('respects an explicit temperature of 0 when reasoning is off', () => {
    expect(resolveTemperature(undefined, 0)).toBe(0)
  })

  it('omits temperature entirely when reasoningEffort is set and none was requested', () => {
    expect(resolveTemperature('high', undefined)).toBeUndefined()
  })

  it('respects an explicit temperature of 1 alongside reasoningEffort', () => {
    expect(resolveTemperature('high', 1)).toBe(1)
  })

  it('normalizes away an explicit non-1 temperature when reasoningEffort is set', () => {
    expect(resolveTemperature('high', 0.9)).toBeUndefined()
  })
})

describe('toGeminiThinkingLevel', () => {
  it('maps minimal and low to LOW (Gemini has no minimal tier)', () => {
    expect(toGeminiThinkingLevel('minimal')).toBe('LOW')
    expect(toGeminiThinkingLevel('low')).toBe('LOW')
  })

  it('maps medium and high 1:1', () => {
    expect(toGeminiThinkingLevel('medium')).toBe('MEDIUM')
    expect(toGeminiThinkingLevel('high')).toBe('HIGH')
  })
})
