import { ChatAnthropic } from '@langchain/anthropic'
import { ChatBedrockConverse } from '@langchain/aws'
import { ChatGoogleGenerativeAI } from '@langchain/google-genai'
import { ChatMistralAI } from '@langchain/mistralai'
import { ChatOllama } from '@langchain/ollama'
import { AzureChatOpenAI, ChatOpenAI } from '@langchain/openai'
import { Config } from '../../../commands/types'
import { LLMModel } from '../types'
import { getLlm } from '../utils/getLlm'
import { getLlmMetadata } from '../utils/llmMetadata'
import { DEFAULT_MAX_OUTPUT_TOKENS } from './constants'
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
  it('registers the built-in providers', async () => {
    expect(LLM_PROVIDER_IDS.sort()).toEqual(['anthropic', 'azure', 'bedrock', 'gemini', 'mistral', 'ollama', 'openai'])
  })

  it('exposes per-provider auth requirements', async () => {
    expect(providerRequiresAuth('openai')).toBe(true)
    expect(providerRequiresAuth('anthropic')).toBe(true)
    expect(providerRequiresAuth('gemini')).toBe(true)
    expect(providerRequiresAuth('mistral')).toBe(true)
    expect(providerRequiresAuth('azure')).toBe(true)
    expect(providerRequiresAuth('bedrock')).toBe(false)
    expect(providerRequiresAuth('ollama')).toBe(false)
    expect(providerRequiresAuth('nope')).toBe(false)
  })

  it('finds definitions by id and returns undefined for unknown', async () => {
    expect(findProviderDefinition('openai')?.id).toBe('openai')
    expect(findProviderDefinition('mystery')).toBeUndefined()
  })
})

describe('getLlm via registry', () => {
  it('builds an OpenAI model and records provider metadata', async () => {
    const llm = await getLlm('openai', 'gpt-5.4-mini' as LLMModel, makeConfig({ provider: 'openai', model: 'gpt-5.4-mini' }))
    expect(llm).toBeInstanceOf(ChatOpenAI)
    expect(getLlmMetadata(llm).provider).toBe('openai')
  })

  it('threads service.maxConcurrent into the OpenAI client (#1629)', async () => {
    const llm = await getLlm(
      'openai',
      'gpt-5.4-mini' as LLMModel,
      makeConfig({ provider: 'openai', model: 'gpt-5.4-mini', maxConcurrent: 3 })
    )
    expect((llm as unknown as { caller: { maxConcurrency: number } }).caller.maxConcurrency).toBe(3)
  })

  it('builds an Anthropic model and records provider metadata', async () => {
    const llm = await getLlm(
      'anthropic',
      'claude-sonnet-4-6' as LLMModel,
      makeConfig({ provider: 'anthropic', model: 'claude-sonnet-4-6' })
    )
    expect(llm).toBeInstanceOf(ChatAnthropic)
    expect(getLlmMetadata(llm).provider).toBe('anthropic')
  })

  it('builds a Gemini model and records provider metadata', async () => {
    const llm = await getLlm(
      'gemini',
      'gemini-2.5-flash' as LLMModel,
      makeConfig({ provider: 'gemini', model: 'gemini-2.5-flash' })
    )
    expect(llm).toBeInstanceOf(ChatGoogleGenerativeAI)
    expect(getLlmMetadata(llm).provider).toBe('gemini')
  })

  it('builds a Mistral model and records provider metadata', async () => {
    const llm = await getLlm(
      'mistral',
      'mistral-small-latest' as LLMModel,
      makeConfig({ provider: 'mistral', model: 'mistral-small-latest' })
    )
    expect(llm).toBeInstanceOf(ChatMistralAI)
    expect(getLlmMetadata(llm).provider).toBe('mistral')
  })

  it('builds an Azure OpenAI model and records provider metadata', async () => {
    const llm = await getLlm(
      'azure',
      'gpt-5.4-mini' as LLMModel,
      makeConfig({
        provider: 'azure',
        model: 'gpt-5.4-mini',
        instanceName: 'my-instance',
        deploymentName: 'gpt-4o',
        apiVersion: '2024-10-21',
      })
    )
    expect(llm).toBeInstanceOf(AzureChatOpenAI)
    expect(getLlmMetadata(llm).provider).toBe('azure')
  })

  it('builds a Bedrock model (no auth) and records provider metadata', async () => {
    // Bedrock authenticates via the AWS credential chain, not a coco-managed
    // API key — `requiresAuth` is false. The ChatBedrockConverse constructor
    // resolves AWS credentials lazily (on first invoke), so it instantiates
    // fine in the test env without any AWS creds present.
    expect(findProviderDefinition('bedrock')?.requiresAuth).toBe(false)

    const llm = await getLlm(
      'bedrock',
      'anthropic.claude-sonnet-4-6' as LLMModel,
      makeConfig({
        provider: 'bedrock',
        model: 'anthropic.claude-sonnet-4-6',
        region: 'us-east-1',
        authentication: { type: 'None' },
      })
    )
    expect(llm).toBeInstanceOf(ChatBedrockConverse)
    expect(getLlmMetadata(llm).provider).toBe('bedrock')
  })

  it('builds an Ollama model (no auth) and records the endpoint', async () => {
    const llm = await getLlm(
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

  it('defaults numPredict and lets service.fields override it for Ollama', async () => {
    const llm = await getLlm(
      'ollama',
      'llama3' as LLMModel,
      makeConfig({
        provider: 'ollama',
        model: 'llama3',
        endpoint: 'http://localhost:11434',
        authentication: { type: 'None' },
      })
    )
    expect((llm as { numPredict?: number }).numPredict).toBe(DEFAULT_MAX_OUTPUT_TOKENS)

    const overridden = await getLlm(
      'ollama',
      'llama3' as LLMModel,
      makeConfig({
        provider: 'ollama',
        model: 'llama3',
        endpoint: 'http://localhost:11434',
        authentication: { type: 'None' },
        fields: { numPredict: 8192 },
      })
    )
    expect((overridden as { numPredict?: number }).numPredict).toBe(8192)
  })

  // Regression (#1631): `createOllamaLlm` never forwarded `temperature`, so
  // both the 0.4 service default and any user-configured value were ignored
  // — generation ran at the Ollama daemon's own default instead.
  it('defaults temperature to 0.4 and respects an explicit value, including 0', async () => {
    const llm = await getLlm(
      'ollama',
      'llama3' as LLMModel,
      makeConfig({
        provider: 'ollama',
        model: 'llama3',
        endpoint: 'http://localhost:11434',
        authentication: { type: 'None' },
      })
    )
    expect((llm as { temperature?: number }).temperature).toBe(0.4)

    const deterministic = await getLlm(
      'ollama',
      'llama3' as LLMModel,
      makeConfig({
        provider: 'ollama',
        model: 'llama3',
        endpoint: 'http://localhost:11434',
        authentication: { type: 'None' },
        temperature: 0,
      })
    )
    expect((deterministic as { temperature?: number }).temperature).toBe(0)

    const hot = await getLlm(
      'ollama',
      'llama3' as LLMModel,
      makeConfig({
        provider: 'ollama',
        model: 'llama3',
        endpoint: 'http://localhost:11434',
        authentication: { type: 'None' },
        temperature: 0.9,
      })
    )
    expect((hot as { temperature?: number }).temperature).toBe(0.9)
  })

  it('lets service.fields override the Ollama temperature', async () => {
    const llm = await getLlm(
      'ollama',
      'llama3' as LLMModel,
      makeConfig({
        provider: 'ollama',
        model: 'llama3',
        endpoint: 'http://localhost:11434',
        authentication: { type: 'None' },
        temperature: 0.3,
        fields: { temperature: 0.71 },
      })
    )
    expect((llm as { temperature?: number }).temperature).toBe(0.71)
  })
})
