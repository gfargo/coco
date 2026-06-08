import { ChatAnthropic } from '@langchain/anthropic'
import { Config } from '../../../commands/types'
import { LLMModel } from '../types'
import { getLlm } from './getLlm'

function makeAnthropicConfig(service: Record<string, unknown> = {}): Config {
  return {
    service: {
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-latest',
      authentication: { type: 'APIKey', credentials: { apiKey: 'test-key' } },
      maxConcurrent: 1,
      ...service,
    },
  } as unknown as Config
}

describe('getLlm — Anthropic field forwarding', () => {
  it('forwards temperature and maxTokens from service.fields', () => {
    const llm = getLlm(
      'anthropic',
      'claude-3-5-sonnet-latest' as LLMModel,
      makeAnthropicConfig({ fields: { temperature: 0.7, maxTokens: 1234 } })
    )

    expect(llm).toBeInstanceOf(ChatAnthropic)
    const anthropic = llm as ChatAnthropic
    expect(anthropic.temperature).toBe(0.7)
    expect(anthropic.maxTokens).toBe(1234)
  })

  it('forwards a custom baseURL as the Anthropic API URL', () => {
    const llm = getLlm(
      'anthropic',
      'claude-3-5-sonnet-latest' as LLMModel,
      makeAnthropicConfig({ baseURL: 'https://proxy.example.com' })
    )

    const anthropic = llm as ChatAnthropic
    expect(anthropic.apiUrl).toBe('https://proxy.example.com')
  })

  it('applies the base service temperature when no field override is present', () => {
    const llm = getLlm(
      'anthropic',
      'claude-3-5-sonnet-latest' as LLMModel,
      makeAnthropicConfig({ temperature: 0.4 })
    )

    const anthropic = llm as ChatAnthropic
    expect(anthropic.temperature).toBe(0.4)
  })
})
