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
import { DEFAULT_MAX_OUTPUT_TOKENS } from './constants'

type ProviderCase = {
  provider: 'openai' | 'gemini' | 'mistral' | 'azure' | 'anthropic'
  model: string
  extraService?: Record<string, unknown>
  /** Field name the provider's LangChain client stores the output-token cap under. */
  maxTokensField: 'maxTokens' | 'maxOutputTokens'
}

const CASES: ProviderCase[] = [
  { provider: 'openai', model: 'gpt-5.4-mini', maxTokensField: 'maxTokens' },
  { provider: 'gemini', model: 'gemini-2.5-flash', maxTokensField: 'maxOutputTokens' },
  { provider: 'mistral', model: 'mistral-small-latest', maxTokensField: 'maxTokens' },
  { provider: 'anthropic', model: 'claude-sonnet-4-6', maxTokensField: 'maxTokens' },
  {
    provider: 'azure',
    model: 'gpt-5.4-mini',
    extraService: { instanceName: 'inst', deploymentName: 'gpt-4o', apiVersion: '2024-10-21' },
    maxTokensField: 'maxTokens',
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
  it('defaults temperature to 0.2 when unset', async () => {
    const llm = await getLlm(c.provider, c.model as LLMModel, makeConfig(c))
    expect(temperatureOf(llm)).toBe(0.2)
  })

  it('respects an explicit temperature, including 0', async () => {
    const hot = await getLlm(c.provider, c.model as LLMModel, makeConfig(c, { temperature: 0.9 }))
    expect(temperatureOf(hot)).toBe(0.9)

    const deterministic = await getLlm(c.provider, c.model as LLMModel, makeConfig(c, { temperature: 0 }))
    expect(temperatureOf(deterministic)).toBe(0)
  })

  it('merges service.fields last so it overrides the base config', async () => {
    const llm = await getLlm(
      c.provider,
      c.model as LLMModel,
      makeConfig(c, { temperature: 0.3, fields: { temperature: 0.71 } })
    )
    expect(temperatureOf(llm)).toBe(0.71)
  })

  it('defaults the output-token cap to DEFAULT_MAX_OUTPUT_TOKENS', async () => {
    const llm = await getLlm(c.provider, c.model as LLMModel, makeConfig(c)) as unknown as Record<string, unknown>
    expect(llm[c.maxTokensField]).toBe(DEFAULT_MAX_OUTPUT_TOKENS)
  })

  it('lets service.fields override the default output-token cap', async () => {
    const llm = await getLlm(
      c.provider,
      c.model as LLMModel,
      makeConfig(c, { fields: { [c.maxTokensField]: 8192 } })
    ) as unknown as Record<string, unknown>
    expect(llm[c.maxTokensField]).toBe(8192)
  })
})

describe('bedrock config forwarding', () => {
  function bedrockConfig(service: Record<string, unknown> = {}): Config {
    return {
      service: {
        provider: 'bedrock',
        model: 'anthropic.claude-sonnet-4-6',
        authentication: { type: 'None' },
        maxConcurrent: 1,
        region: 'us-east-1',
        ...service,
      },
    } as unknown as Config
  }

  it('forwards region and defaults temperature to 0.2', async () => {
    const llm = await getLlm(
      'bedrock',
      'anthropic.claude-sonnet-4-6' as LLMModel,
      bedrockConfig()
    )
    expect((llm as { region?: string }).region).toBe('us-east-1')
    expect(temperatureOf(llm)).toBe(0.2)
  })

  it('defaults the output-token cap and lets service.fields override it', async () => {
    const llm = await getLlm('bedrock', 'anthropic.claude-sonnet-4-6' as LLMModel, bedrockConfig())
    expect((llm as { maxTokens?: number }).maxTokens).toBe(DEFAULT_MAX_OUTPUT_TOKENS)

    const overridden = await getLlm(
      'bedrock',
      'anthropic.claude-sonnet-4-6' as LLMModel,
      bedrockConfig({ fields: { maxTokens: 8192 } })
    )
    expect((overridden as { maxTokens?: number }).maxTokens).toBe(8192)
  })

  it('omits credentials when none are configured (defers to the AWS chain)', async () => {
    const llm = await getLlm(
      'bedrock',
      'anthropic.claude-sonnet-4-6' as LLMModel,
      bedrockConfig()
    )
    expect((llm as { credentials?: unknown }).credentials).toBeUndefined()
  })

  it('passes explicit credentials only when both id and secret are present', async () => {
    const llm = await getLlm(
      'bedrock',
      'anthropic.claude-sonnet-4-6' as LLMModel,
      bedrockConfig({ accessKeyId: 'AKIA', secretAccessKey: 'secret', sessionToken: 'tok' })
    )
    expect((llm as { credentials?: { accessKeyId?: string } }).credentials).toEqual({
      accessKeyId: 'AKIA',
      secretAccessKey: 'secret',
      sessionToken: 'tok',
    })
  })

  it('ignores a lone accessKeyId without a secret', async () => {
    const llm = await getLlm(
      'bedrock',
      'anthropic.claude-sonnet-4-6' as LLMModel,
      bedrockConfig({ accessKeyId: 'AKIA' })
    )
    expect((llm as { credentials?: unknown }).credentials).toBeUndefined()
  })
})
