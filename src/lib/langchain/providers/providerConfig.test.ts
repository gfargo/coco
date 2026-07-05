/**
 * Cross-provider config-forwarding contract for the API-key chat providers.
 *
 * Asserts the behavior that's easy to get subtly wrong per provider:
 *   - the base `service.temperature` reaches the model,
 *   - an explicit `temperature: 0` is respected (regression guard for the
 *     `|| 0.2` vs `?? 0.2` bug — `||` silently rewrites 0 to 0.2),
 *   - `service.fields` is merged last, so it overrides the base config.
 *
 * Ollama is endpoint-based and covered in `registry.test.ts`. Bedrock (no API
 * key; AWS credential chain) gets its own forwarding case below.
 */
import { Config } from '../../../commands/types'
import { LLMModel } from '../types'
import { getLlm } from '../utils/getLlm'

type ProviderCase = {
  provider: 'openai' | 'gemini' | 'mistral' | 'azure' | 'anthropic'
  model: string
  extraService?: Record<string, unknown>
}

const CASES: ProviderCase[] = [
  { provider: 'openai', model: 'gpt-4o' },
  { provider: 'gemini', model: 'gemini-2.5-flash' },
  { provider: 'mistral', model: 'mistral-small-latest' },
  { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  {
    provider: 'azure',
    model: 'gpt-4o',
    extraService: { instanceName: 'inst', deploymentName: 'gpt-4o', apiVersion: '2024-10-21' },
  },
]

function makeConfig(c: ProviderCase, service: Record<string, unknown> = {}): Config {
  return {
    service: {
      provider: c.provider,
      model: c.model,
      authentication: { type: 'APIKey', credentials: { apiKey: 'test-key' } },
      maxConcurrent: 1,
      ...c.extraService,
      ...service,
    },
  } as unknown as Config
}

// `.temperature` is a public instance field on every LangChain chat model.
function temperatureOf(llm: unknown): number | undefined {
  return (llm as { temperature?: number }).temperature
}

describe.each(CASES)('provider config forwarding — $provider', (c) => {
  it('defaults temperature to 0.2 when unset', () => {
    const llm = getLlm(c.provider, c.model as LLMModel, makeConfig(c))
    expect(temperatureOf(llm)).toBe(0.2)
  })

  it('respects an explicit temperature, including 0', () => {
    const hot = getLlm(c.provider, c.model as LLMModel, makeConfig(c, { temperature: 0.9 }))
    expect(temperatureOf(hot)).toBe(0.9)

    const deterministic = getLlm(c.provider, c.model as LLMModel, makeConfig(c, { temperature: 0 }))
    expect(temperatureOf(deterministic)).toBe(0)
  })

  it('merges service.fields last so it overrides the base config', () => {
    const llm = getLlm(
      c.provider,
      c.model as LLMModel,
      makeConfig(c, { temperature: 0.3, fields: { temperature: 0.71 } })
    )
    expect(temperatureOf(llm)).toBe(0.71)
  })
})

describe('bedrock config forwarding', () => {
  function bedrockConfig(service: Record<string, unknown> = {}): Config {
    return {
      service: {
        provider: 'bedrock',
        model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
        authentication: { type: 'None' },
        maxConcurrent: 1,
        region: 'us-east-1',
        ...service,
      },
    } as unknown as Config
  }

  it('forwards region and defaults temperature to 0.2', () => {
    const llm = getLlm(
      'bedrock',
      'anthropic.claude-3-5-sonnet-20241022-v2:0' as LLMModel,
      bedrockConfig()
    )
    expect((llm as { region?: string }).region).toBe('us-east-1')
    expect(temperatureOf(llm)).toBe(0.2)
  })

  it('omits credentials when none are configured (defers to the AWS chain)', () => {
    const llm = getLlm(
      'bedrock',
      'anthropic.claude-3-5-sonnet-20241022-v2:0' as LLMModel,
      bedrockConfig()
    )
    expect((llm as { credentials?: unknown }).credentials).toBeUndefined()
  })

  it('passes explicit credentials only when both id and secret are present', () => {
    const llm = getLlm(
      'bedrock',
      'anthropic.claude-3-5-sonnet-20241022-v2:0' as LLMModel,
      bedrockConfig({ accessKeyId: 'AKIA', secretAccessKey: 'secret', sessionToken: 'tok' })
    )
    expect((llm as { credentials?: { accessKeyId?: string } }).credentials).toEqual({
      accessKeyId: 'AKIA',
      secretAccessKey: 'secret',
      sessionToken: 'tok',
    })
  })

  it('ignores a lone accessKeyId without a secret', () => {
    const llm = getLlm(
      'bedrock',
      'anthropic.claude-3-5-sonnet-20241022-v2:0' as LLMModel,
      bedrockConfig({ accessKeyId: 'AKIA' })
    )
    expect((llm as { credentials?: unknown }).credentials).toBeUndefined()
  })
})
