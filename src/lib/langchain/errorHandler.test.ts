import { isNetworkError, isRetryableError, handleLangChainError } from './errorHandler'
import {
  LangChainNetworkError,
  LangChainExecutionError,
  LangChainAuthenticationError,
  LangChainQuotaExceededError,
  LangChainRateLimitError,
} from './errors'

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

  // Regression (#1637): a real provider auth rejection (invalid/revoked
  // key) used to fall through to the generic LangChainExecutionError wrap,
  // so the curated authentication troubleshooting block never rendered —
  // only a locally-missing key (before any request) produced this class.
  describe('provider auth rejections (#1637)', () => {
    it('throws LangChainAuthenticationError for a 401 status', () => {
      const error = { status: 401, message: 'Incorrect API key provided' }

      expect(() => {
        handleLangChainError(error, 'executeChain: Chain execution failed', {
          provider: 'openai',
          endpoint: 'https://api.openai.com',
        })
      }).toThrow(LangChainAuthenticationError)
    })

    it('throws LangChainAuthenticationError for a 403 status', () => {
      const error = { status: 403, message: 'Forbidden' }

      expect(() => {
        handleLangChainError(error, 'test context')
      }).toThrow(LangChainAuthenticationError)
    })

    it('throws LangChainAuthenticationError for a provider invalid_api_key code', () => {
      const error = { code: 'invalid_api_key', message: 'Invalid API key' }

      expect(() => {
        handleLangChainError(error, 'test context')
      }).toThrow(LangChainAuthenticationError)
    })

    it('carries provider and endpoint through to the thrown error', () => {
      const error = { status: 401, message: 'Incorrect API key provided' }

      try {
        handleLangChainError(error, 'test context', {
          provider: 'openai',
          endpoint: 'https://api.openai.com',
        })
      } catch (e) {
        expect(e).toBeInstanceOf(LangChainAuthenticationError)
        const authError = e as LangChainAuthenticationError
        expect(authError.provider).toBe('openai')
        expect(authError.endpoint).toBe('https://api.openai.com')
        expect(authError.message).toBe('Incorrect API key provided')
      }
    })

    it('does not misclassify an unrelated 400 as an auth error', () => {
      const error = { status: 400, message: 'Bad request' }

      expect(() => {
        handleLangChainError(error, 'test context')
      }).toThrow(LangChainExecutionError)
    })
  })

  // Regression (#1637): a 429 that survived the summarize chain's
  // retry/backoff used to surface as a raw provider message via the
  // generic execution-error wrap, with no rate-limit-specific guidance.
  describe('rate-limit responses (#1637)', () => {
    it('throws LangChainRateLimitError for a 429 status', () => {
      const error = { status: 429, message: 'Rate limit reached' }

      expect(() => {
        handleLangChainError(error, 'test context', { provider: 'openai' })
      }).toThrow(LangChainRateLimitError)
    })

    it('throws LangChainRateLimitError for a rate_limit_exceeded code', () => {
      const error = { code: 'rate_limit_exceeded', message: 'Too many requests' }

      expect(() => {
        handleLangChainError(error, 'test context')
      }).toThrow(LangChainRateLimitError)
    })

    it('carries the provider through to the thrown error', () => {
      const error = { status: 429, message: 'Rate limit reached' }

      try {
        handleLangChainError(error, 'test context', { provider: 'anthropic' })
      } catch (e) {
        expect(e).toBeInstanceOf(LangChainRateLimitError)
        expect((e as LangChainRateLimitError).provider).toBe('anthropic')
      }
    })

    it('does not classify a plain 429 as quota exhaustion', () => {
      const error = { status: 429, message: 'Rate limit reached for gpt-4o' }

      try {
        handleLangChainError(error, 'test context', { provider: 'openai' })
      } catch (e) {
        expect(e).toBeInstanceOf(LangChainRateLimitError)
        expect(e).not.toBeInstanceOf(LangChainQuotaExceededError)
      }
    })
  })

  // Providers reuse HTTP 429 for `insufficient_quota` (billing/budget
  // exhausted). Classified separately from rate limits because the
  // rate-limit remedy ("wait and retry") can never fix a dead balance.
  describe('quota exhaustion on 429s (insufficient_quota)', () => {
    it('throws LangChainQuotaExceededError for a 429 with an insufficient_quota code', () => {
      const error = { status: 429, code: 'insufficient_quota', message: 'You exceeded your current quota' }

      expect(() => {
        handleLangChainError(error, 'test context', { provider: 'openai' })
      }).toThrow(LangChainQuotaExceededError)
    })

    it('throws LangChainQuotaExceededError for a nested error.type of insufficient_quota', () => {
      const error = {
        status: 429,
        message: 'You exceeded your current quota, please check your plan and billing details.',
        error: { type: 'insufficient_quota', code: 'insufficient_quota' },
      }

      expect(() => {
        handleLangChainError(error, 'test context', { provider: 'openai' })
      }).toThrow(LangChainQuotaExceededError)
    })

    it('detects quota exhaustion from the message when no code is present', () => {
      const error = { status: 429, message: 'You exceeded your current quota, please check your plan and billing details.' }

      expect(() => {
        handleLangChainError(error, 'test context')
      }).toThrow(LangChainQuotaExceededError)
    })

    it("detects Anthropic's low-credit-balance message", () => {
      const error = { status: 400, message: 'Your credit balance is too low to access the Anthropic API.' }

      expect(() => {
        handleLangChainError(error, 'test context', { provider: 'anthropic' })
      }).toThrow(LangChainQuotaExceededError)
    })

    it('remains an instanceof LangChainRateLimitError for existing call sites', () => {
      const error = { status: 429, code: 'insufficient_quota', message: 'You exceeded your current quota' }

      try {
        handleLangChainError(error, 'test context', { provider: 'openai' })
      } catch (e) {
        expect(e).toBeInstanceOf(LangChainRateLimitError)
      }
    })

    it('carries the provider and original message through to the thrown error', () => {
      const error = { status: 429, code: 'insufficient_quota', message: 'You exceeded your current quota' }

      try {
        handleLangChainError(error, 'test context', { provider: 'openai' })
      } catch (e) {
        expect(e).toBeInstanceOf(LangChainQuotaExceededError)
        const quotaError = e as LangChainQuotaExceededError
        expect(quotaError.provider).toBe('openai')
        expect(quotaError.message).toBe('You exceeded your current quota')
      }
    })
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
