import { getDefaultServiceApiKey } from './utils'
import { LangChainAuthenticationError } from './errors'
import { Config } from '../../commands/types'

describe('getDefaultServiceApiKey (OSS-1003 — keyless OpenAI-compatible endpoints)', () => {
  it('returns empty string for a keyless openai-compatible endpoint (baseURL set)', () => {
    const config = {
      service: {
        provider: 'openai',
        model: 'gpt-5.4-nano',
        baseURL: 'http://localhost:1234/v1',
        authentication: { type: 'None', credentials: undefined },
      },
    } as unknown as Config

    expect(getDefaultServiceApiKey(config)).toBe('')
  })

  it('returns empty string for a keyless ollama-style endpoint (endpoint set)', () => {
    const config = {
      service: {
        provider: 'openai',
        model: 'gpt-5.4-nano',
        endpoint: 'http://localhost:8000/v1',
        authentication: { type: 'None', credentials: undefined },
      },
    } as unknown as Config

    expect(getDefaultServiceApiKey(config)).toBe('')
  })

  it('still throws for managed openai with no baseURL/endpoint and no auth', () => {
    const config = {
      service: {
        provider: 'openai',
        model: 'gpt-5.4-nano',
        authentication: { type: 'None', credentials: undefined },
      },
    } as unknown as Config

    expect(() => getDefaultServiceApiKey(config)).toThrow(LangChainAuthenticationError)
  })

  it('leaves bedrock (requiresAuth: false) unaffected regardless of baseURL', () => {
    const config = {
      service: {
        provider: 'bedrock',
        model: 'anthropic.claude-sonnet-4-6',
        authentication: { type: 'None', credentials: undefined },
      },
    } as unknown as Config

    expect(getDefaultServiceApiKey(config)).toBe('')
  })

  it('leaves ollama (requiresAuth: false) unaffected', () => {
    const config = {
      service: {
        provider: 'ollama',
        model: 'llama3.1:8b',
        endpoint: 'http://localhost:11434',
        authentication: { type: 'None', credentials: undefined },
      },
    } as unknown as Config

    expect(getDefaultServiceApiKey(config)).toBe('')
  })
})
