/**
 * #1844 — the failure envelope's machine-readable fields. `code` was an
 * unpublished string and `retryable` was false for every provider failure,
 * so an agent could not branch on either.
 */
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { z } from 'zod'
import {
  LangChainAuthenticationError,
  LangChainExecutionError,
  LangChainNetworkError,
  LangChainQuotaExceededError,
  LangChainRateLimitError,
  LangChainTimeoutError,
} from '../../lib/langchain/errors'
import { AgentOperationError, createAgentFailureEnvelope, toAgentOperationError } from './errors'
import {
  AGENT_ERROR_CATEGORIES,
  AGENT_ERROR_CODE_CATEGORIES,
  AGENT_ERROR_CODES,
  createAgentFailureSchema,
} from './schemas'

/** Every literal code passed to `new AgentOperationError(...)` in production source. */
function emittedCodes(): Set<string> {
  const codes = new Set<string>()
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) walk(path)
      else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
        for (const match of readFileSync(path, 'utf8').matchAll(/AgentOperationError\(\s*'([A-Z_]+)'/g)) {
          codes.add(match[1])
        }
      }
    }
  }
  walk(join(__dirname, '..', '..'))
  return codes
}

describe('agent error codes', () => {
  it('publishes every code the implementation emits', () => {
    const published = new Set<string>(AGENT_ERROR_CODES)
    expect([...emittedCodes()].filter((code) => !published.has(code))).toEqual([])
  })

  it('gives every code a known category', () => {
    for (const code of AGENT_ERROR_CODES) {
      expect(AGENT_ERROR_CATEGORIES).toContain(AGENT_ERROR_CODE_CATEGORIES[code])
    }
  })

  it('lists the codes in the published failure schema', () => {
    const json = z.toJSONSchema(createAgentFailureSchema('review')) as unknown as {
      properties: { error: { properties: { code: { enum: string[] }; category: { enum: string[] } } } }
    }
    expect(json.properties.error.properties.code.enum).toEqual(AGENT_ERROR_CODES)
    expect(json.properties.error.properties.category.enum).toEqual([...AGENT_ERROR_CATEGORIES])
  })
})

describe('toAgentOperationError provider classification', () => {
  it.each([
    ['a rate limit', new LangChainRateLimitError('slow down', 'openai'), 'RATE_LIMITED', true],
    ['a network failure', new LangChainNetworkError('fetch failed'), 'PROVIDER_UNAVAILABLE', true],
    ['a timeout', new LangChainTimeoutError('timed out'), 'PROVIDER_UNAVAILABLE', true],
    ['quota exhaustion', new LangChainQuotaExceededError('insufficient_quota', 'openai'), 'QUOTA_EXCEEDED', false],
    ['a rejected key', new LangChainAuthenticationError('bad key', 'openai'), 'AUTHENTICATION_REQUIRED', false],
    ['a raw SDK 429', Object.assign(new Error('Too Many Requests'), { status: 429 }), 'RATE_LIMITED', true],
    ['a raw SDK 503', Object.assign(new Error('Service Unavailable'), { status: 503 }), 'PROVIDER_UNAVAILABLE', true],
    ['a raw connection reset', Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }), 'PROVIDER_UNAVAILABLE', true],
    ['a raw quota 429', Object.assign(new Error('You exceeded your quota'), { status: 429, code: 'insufficient_quota' }), 'QUOTA_EXCEEDED', false],
  ])('classifies %s', (_label, error, code, retryable) => {
    const result = toAgentOperationError(error)
    expect(result.code).toBe(code)
    expect(result.retryable).toBe(retryable)
  })

  it('keeps everything else non-retryable', () => {
    expect(toAgentOperationError(new LangChainExecutionError('chain broke'))).toMatchObject({ code: 'OPERATION_FAILED', retryable: false })
    expect(toAgentOperationError(new Error('something odd'))).toMatchObject({ code: 'OPERATION_FAILED', retryable: false })
    expect(toAgentOperationError(new AgentOperationError('NO_CHANGES', 'nothing staged'))).toMatchObject({ code: 'NO_CHANGES', retryable: false })
  })

  it('carries the provider\'s requested wait', () => {
    const typed = new LangChainRateLimitError('slow down', 'openai', { retryAfterMs: 2500 })
    expect(toAgentOperationError(typed).retryAfterMs).toBe(2500)

    const raw = Object.assign(new Error('Too Many Requests'), { status: 429, headers: { 'Retry-After': '3' } })
    expect(toAgentOperationError(raw).retryAfterMs).toBe(3000)
  })
})

describe('createAgentFailureEnvelope', () => {
  it('includes the category and, when known, the retry wait', () => {
    const envelope = createAgentFailureEnvelope('review', new AgentOperationError('RATE_LIMITED', 'slow down', true, undefined, 1200))
    expect(envelope.error).toEqual({ code: 'RATE_LIMITED', category: 'provider', message: 'slow down', retryable: true, retryAfterMs: 1200 })
    expect(createAgentFailureSchema('review').safeParse(envelope).success).toBe(true)
  })

  it('omits retryAfterMs when there is none', () => {
    const envelope = createAgentFailureEnvelope('review', new AgentOperationError('NO_CHANGES', 'nothing staged'))
    expect(envelope.error).not.toHaveProperty('retryAfterMs')
    expect(envelope.error.category).toBe('repository')
  })
})
