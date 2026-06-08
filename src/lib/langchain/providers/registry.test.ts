import { ChatAnthropic } from '@langchain/anthropic'
import { ChatOllama } from '@langchain/ollama'
import { ChatOpenAI } from '@langchain/openai'
import { Config } from '../../../commands/types'
import { LLMModel } from '../types'
import { getLlm } from '../utils/getLlm'
import { getLlmMetadata } from '../utils/llmMetadata'
import {
  LLM_PROVIDER_IDS,
  findProviderDefinition,
  providerRequiresAuth,
} from './registry'

function makeConfig(service: Record<string, unknown>): Config {
  return {
    service: {
      authentication: { type: 'APIKey', credentials: { apiKey: 'test-key' } },
      maxConcurrent: 1,
      ...service,
    },
  } as unknown as Config
}

describe('provider registry', () => {
  it('registers the three built-in providers', () => {
    expect(LLM_PROVIDER_IDS.sort()).toEqual(['anthropic', 'ollama', 'openai'])
  })

  it('exposes per-provider auth requirements', () => {
    expect(providerRequiresAuth('openai')).toBe(true)
    expect(providerRequiresAuth('anthropic')).toBe(true)
    expect(providerRequiresAuth('ollama')).toBe(false)
    expect(providerRequiresAuth('nope')).toBe(false)
  })

  it('finds definitions by id and returns undefined for unknown', () => {
    expect(findProviderDefinition('openai')?.id).toBe('openai')
    expect(findProviderDefinition('mystery')).toBeUndefined()
  })
})

describe('getLlm via registry', () => {
  it('builds an OpenAI model and records provider metadata', () => {
    const llm = getLlm('openai', 'gpt-4o' as LLMModel, makeConfig({ provider: 'openai', model: 'gpt-4o' }))
    expect(llm).toBeInstanceOf(ChatOpenAI)
    expect(getLlmMetadata(llm).provider).toBe('openai')
  })

  it('builds an Anthropic model and records provider metadata', () => {
    const llm = getLlm(
      'anthropic',
      'claude-3-5-sonnet-latest' as LLMModel,
      makeConfig({ provider: 'anthropic', model: 'claude-3-5-sonnet-latest' })
    )
    expect(llm).toBeInstanceOf(ChatAnthropic)
    expect(getLlmMetadata(llm).provider).toBe('anthropic')
  })

  it('builds an Ollama model (no auth) and records the endpoint', () => {
    const llm = getLlm(
      'ollama',
      'llama3' as LLMModel,
      makeConfig({
        provider: 'ollama',
        model: 'llama3',
        endpoint: 'http://localhost:11434',
        authentication: { type: 'None' },
      })
    )
    expect(llm).toBeInstanceOf(ChatOllama)
    const meta = getLlmMetadata(llm)
    expect(meta.provider).toBe('ollama')
    expect(meta.endpoint).toBe('http://localhost:11434')
  })
})
