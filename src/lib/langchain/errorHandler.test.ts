import { isNetworkError, isRetryableError, handleLangChainError } from './errorHandler'
import { LangChainNetworkError, LangChainExecutionError } from './errors'

describe('isNetworkError', () => {
  it('should detect "fetch failed" errors', () => {
    const error = new Error('fetch failed')
    expect(isNetworkError(error)).toBe(true)
  })

  it('should detect ECONNREFUSED errors', () => {
    const error = new Error('connect ECONNREFUSED 127.0.0.1:11434')
    expect(isNetworkError(error)).toBe(true)
  })

  it('should detect ENOTFOUND errors', () => {
    const error = new Error('getaddrinfo ENOTFOUND localhost')
    expect(isNetworkError(error)).toBe(true)
  })

  it('should detect ETIMEDOUT errors', () => {
    const error = new Error('ETIMEDOUT')
    expect(isNetworkError(error)).toBe(true)
  })

  it('should detect socket hang up errors', () => {
    const error = new Error('socket hang up')
    expect(isNetworkError(error)).toBe(true)
  })

  it('should detect network request failed errors', () => {
    const error = new Error('network request failed')
    expect(isNetworkError(error)).toBe(true)
  })

  it('should not detect non-network errors', () => {
    const error = new Error('Invalid JSON response')
    expect(isNetworkError(error)).toBe(false)
  })

  it('should not detect validation errors', () => {
    const error = new Error('Validation failed: missing required field')
    expect(isNetworkError(error)).toBe(false)
  })

  it('should return false for non-Error objects', () => {
    expect(isNetworkError('string error')).toBe(false)
    expect(isNetworkError(null)).toBe(false)
    expect(isNetworkError(undefined)).toBe(false)
    expect(isNetworkError({ message: 'fetch failed' })).toBe(false)
  })

  it('should be case-insensitive', () => {
    const error = new Error('FETCH FAILED')
    expect(isNetworkError(error)).toBe(true)
  })
})

describe('isRetryableError (#1242 — shared transient predicate)', () => {
  it('treats connection failures (network errors) as retryable', () => {
    expect(isRetryableError(new Error('fetch failed'))).toBe(true)
    expect(isRetryableError(new Error('connect ECONNREFUSED 127.0.0.1:11434'))).toBe(true)
  })

  it('retries transient HTTP statuses', () => {
    for (const status of [429, 502, 503, 504]) {
      expect(isRetryableError({ status })).toBe(true)
    }
    expect(isRetryableError({ status: 400 })).toBe(false)
    expect(isRetryableError({ status: 404 })).toBe(false)
  })

  it('retries rate-limit / timeout error codes', () => {
    expect(isRetryableError({ code: 429 })).toBe(true)
    expect(isRetryableError({ code: 'rate_limit_exceeded' })).toBe(true)
    expect(isRetryableError({ code: 'ECONNRESET' })).toBe(true)
    expect(isRetryableError({ code: 'ETIMEDOUT' })).toBe(true)
    expect(isRetryableError({ code: 'EPERM' })).toBe(false)
  })

  it('retries on transient message signals (case-insensitive)', () => {
    expect(isRetryableError({ message: 'Rate limit exceeded' })).toBe(true)
    expect(isRetryableError({ message: '429 Too Many Requests' })).toBe(true)
    expect(isRetryableError({ message: 'Service temporarily unavailable' })).toBe(true)
    expect(isRetryableError({ message: 'request timeout' })).toBe(true)
    expect(isRetryableError({ message: 'Invalid JSON' })).toBe(false)
  })

  it('returns false for non-transient / non-object inputs', () => {
    expect(isRetryableError(new Error('Validation failed'))).toBe(false)
    expect(isRetryableError(null)).toBe(false)
    expect(isRetryableError(undefined)).toBe(false)
    expect(isRetryableError('boom')).toBe(false)
  })
})

describe('handleLangChainError', () => {
  it('should throw LangChainNetworkError for network errors', () => {
    const error = new Error('fetch failed')

    expect(() => {
      handleLangChainError(error, 'test context', {
        endpoint: 'http://localhost:11434',
        provider: 'ollama',
      })
    }).toThrow(LangChainNetworkError)
  })

  it('should include endpoint and provider in LangChainNetworkError', () => {
    const error = new Error('connect ECONNREFUSED')

    try {
      handleLangChainError(error, 'test context', {
        endpoint: 'http://localhost:11434',
        provider: 'ollama',
      })
    } catch (e) {
      expect(e).toBeInstanceOf(LangChainNetworkError)
      const networkError = e as LangChainNetworkError
      expect(networkError.endpoint).toBe('http://localhost:11434')
      expect(networkError.provider).toBe('ollama')
    }
  })

  it('should throw LangChainExecutionError for non-network errors', () => {
    const error = new Error('Invalid response format')

    expect(() => {
      handleLangChainError(error, 'test context')
    }).toThrow(LangChainExecutionError)
  })

  it('should include context in error message for non-network errors', () => {
    const error = new Error('Parse error')

    try {
      handleLangChainError(error, 'executeChain: Chain failed')
    } catch (e) {
      expect(e).toBeInstanceOf(LangChainExecutionError)
      expect((e as Error).message).toBe('executeChain: Chain failed: Parse error')
    }
  })
})

describe('LangChainNetworkError', () => {
  it('should store endpoint and provider', () => {
    const error = new LangChainNetworkError(
      'Connection failed',
      'http://localhost:11434',
      'ollama',
      { originalError: 'TypeError' }
    )

    expect(error.endpoint).toBe('http://localhost:11434')
    expect(error.provider).toBe('ollama')
    expect(error.message).toBe('Connection failed')
    expect(error.context?.endpoint).toBe('http://localhost:11434')
    expect(error.context?.provider).toBe('ollama')
    expect(error.context?.originalError).toBe('TypeError')
  })
})
