import {
  LangChainAuthenticationError,
  LangChainError,
  LangChainExecutionError,
  LangChainNetworkError,
  LangChainQuotaExceededError,
  LangChainRateLimitError,
} from './errors'

// Re-export retry utilities from general utils
export {
  withRetry,
  withTimeout,
  withRetryAndTimeout,
  type RetryOptions
} from '../utils/retry'

/**
 * Network error patterns to detect connection failures
 */
const NETWORK_ERROR_PATTERNS = [
  'fetch failed',
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'ECONNRESET',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'socket hang up',
  'network request failed',
  'Failed to fetch',
  'getaddrinfo',
  'connect ECONNREFUSED',
]

/**
 * Checks if an error message indicates a network/connection failure
 */
export function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false

  const message = error.message.toLowerCase()
  const errorCause = (error as Error & { cause?: Error })?.cause?.message?.toLowerCase() || ''

  return NETWORK_ERROR_PATTERNS.some(pattern =>
    message.includes(pattern.toLowerCase()) ||
    errorCause.includes(pattern.toLowerCase())
  )
}

/** HTTP statuses worth retrying with backoff (rate limit + transient 5xx). */
const RETRYABLE_HTTP_STATUS = new Set([429, 502, 503, 504])

/** Substrings that signal a transient, retryable provider error. */
const TRANSIENT_ERROR_PATTERNS = [
  'rate limit',
  'rate-limit',
  'ratelimit',
  '429',
  'too many requests',
  'timeout',
  'temporarily unavailable',
]

/**
 * The single shared notion of a *retryable* (transient) error: a connection
 * failure (see {@link isNetworkError}) OR a transient HTTP status / rate-limit /
 * timeout signal from a provider. Callers that back off and retry (e.g. the
 * summarize chain) should use this rather than re-deriving their own predicate.
 *
 * Deliberately distinct from `utils/retry`'s `defaultShouldRetry`, which is
 * broader: that one retries *any* non-permanent error (anything that isn't a
 * validation / configuration / authentication / schema-parse failure), not
 * just transient network/rate-limit signals. Transient ⊂ defaultShouldRetry.
 */
export function isRetryableError(error: unknown): boolean {
  if (isNetworkError(error)) return true
  if (!error || typeof error !== 'object') return false

  const err = error as { status?: number; code?: string | number; message?: string }
  if (typeof err.status === 'number' && RETRYABLE_HTTP_STATUS.has(err.status)) return true
  if (
    err.code === 429 ||
    err.code === 'rate_limit_exceeded' ||
    err.code === 'ECONNRESET' ||
    err.code === 'ETIMEDOUT'
  ) {
    return true
  }
  if (typeof err.message === 'string') {
    const message = err.message.toLowerCase()
    if (TRANSIENT_ERROR_PATTERNS.some((pattern) => message.includes(pattern))) return true
  }
  return false
}

/**
 * Best-effort error message extraction. Real provider SDK errors are
 * `Error` instances, but the plain-object shape (`{ status, message }`)
 * some SDKs / tests use isn't — falling back to `String(error)` for those
 * would print `[object Object]` instead of the actual message.
 */
function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message
  }
  return String(error)
}

/** Best-effort extraction of an HTTP status code across provider SDK error shapes. */
function extractHttpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined
  const err = error as { status?: number; statusCode?: number; response?: { status?: number } }
  if (typeof err.status === 'number') return err.status
  if (typeof err.statusCode === 'number') return err.statusCode
  if (typeof err.response?.status === 'number') return err.response.status
  return undefined
}

/**
 * #1637 — an actual HTTP auth rejection from the provider (invalid/revoked
 * key: 401/403, or a provider-specific "invalid_api_key" code) used to fall
 * through to the generic execution-error wrap below, so the curated
 * authentication troubleshooting block never rendered. Only
 * `getDefaultServiceApiKey`'s locally-missing-key check (before any
 * request) produced `LangChainAuthenticationError`.
 */
function isAuthError(error: unknown): boolean {
  const status = extractHttpStatus(error)
  if (status === 401 || status === 403) return true
  if (!error || typeof error !== 'object') return false
  const err = error as { code?: string; error?: { code?: string; type?: string } }
  const code = err.code || err.error?.code
  const type = err.error?.type
  return code === 'invalid_api_key' || code === 'authentication_error' || type === 'authentication_error'
}

/** Substrings that specifically signal a rate limit (narrower than {@link TRANSIENT_ERROR_PATTERNS}). */
const RATE_LIMIT_MESSAGE_PATTERNS = ['rate limit', 'rate-limit', 'ratelimit', 'too many requests']

/**
 * Substrings that signal quota/billing exhaustion rather than a rate limit.
 * "exceeded your current quota" is OpenAI's `insufficient_quota` message;
 * "credit balance is too low" is Anthropic's out-of-credits message.
 */
const QUOTA_MESSAGE_PATTERNS = [
  'insufficient_quota',
  'exceeded your current quota',
  'credit balance is too low',
]

/**
 * Quota/billing exhaustion. OpenAI (and others) reuse HTTP 429 for
 * `insufficient_quota`, so without this check a dead billing account rendered
 * the rate-limit remedy ("wait a bit and retry") — advice that can never
 * work. Checked before {@link isRateLimitError} since a quota 429 satisfies
 * that predicate too.
 */
function isQuotaExceededError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const err = error as { code?: string | number; error?: { code?: string; type?: string }; message?: string }
  const code = err.code ?? err.error?.code
  const type = err.error?.type
  if (code === 'insufficient_quota' || type === 'insufficient_quota') return true
  if (typeof err.message === 'string') {
    const message = err.message.toLowerCase()
    return QUOTA_MESSAGE_PATTERNS.some((pattern) => message.includes(pattern))
  }
  return false
}

/**
 * #1637 — a 429 that survived the summarize chain's retry/backoff (or any
 * other provider call that doesn't retry) used to surface as a raw
 * provider message via the generic execution-error wrap, with no
 * rate-limit-specific guidance.
 */
function isRateLimitError(error: unknown): boolean {
  if (extractHttpStatus(error) === 429) return true
  if (!error || typeof error !== 'object') return false
  const err = error as { code?: string | number; message?: string }
  if (err.code === 429 || err.code === 'rate_limit_exceeded') return true
  if (typeof err.message === 'string') {
    const message = err.message.toLowerCase()
    return RATE_LIMIT_MESSAGE_PATTERNS.some((pattern) => message.includes(pattern))
  }
  return false
}

/**
 * Wraps errors with additional context and converts them to LangChain errors
 */
export function handleLangChainError(
  error: unknown,
  context: string,
  additionalContext?: Record<string, unknown>
): never {
  // Check for network errors first
  if (error instanceof Error && isNetworkError(error)) {
    const endpoint = additionalContext?.endpoint as string | undefined
    const provider = additionalContext?.provider as string | undefined

    throw new LangChainNetworkError(
      error.message,
      endpoint,
      provider,
      {
        originalError: error.name,
        originalMessage: error.message,
        stack: error.stack,
        context,
        ...additionalContext
      }
    )
  }

  // #1637 — an actual provider auth rejection (invalid/revoked key) so the
  // curated authentication troubleshooting block renders instead of a
  // generic execution error.
  if (isAuthError(error)) {
    const endpoint = additionalContext?.endpoint as string | undefined
    const provider = additionalContext?.provider as string | undefined
    const message = extractErrorMessage(error)

    throw new LangChainAuthenticationError(message, provider, endpoint, {
      originalError: error instanceof Error ? error.name : typeof error,
      originalMessage: message,
      context,
      ...additionalContext
    })
  }

  // Quota/billing exhaustion masquerading as a 429 — must precede the
  // rate-limit check so the billing remedy renders instead of "retry".
  if (isQuotaExceededError(error)) {
    const provider = additionalContext?.provider as string | undefined
    const message = extractErrorMessage(error)

    throw new LangChainQuotaExceededError(message, provider, {
      originalError: error instanceof Error ? error.name : typeof error,
      originalMessage: message,
      context,
      ...additionalContext
    })
  }

  // #1637 — a 429 that survived (or bypassed) retry/backoff, so a
  // rate-limit-specific remedy renders instead of a raw provider message.
  if (isRateLimitError(error)) {
    const provider = additionalContext?.provider as string | undefined
    const message = extractErrorMessage(error)

    throw new LangChainRateLimitError(message, provider, {
      originalError: error instanceof Error ? error.name : typeof error,
      originalMessage: message,
      context,
      ...additionalContext
    })
  }

  // If it's already a LangChain error, re-throw with additional context
  if (error instanceof LangChainError) {
    throw new LangChainExecutionError(
      `${context}: ${error.message}`,
      {
        ...error.context,
        ...additionalContext,
        originalError: error.name,
        context
      }
    )
  }

  // If it's a regular Error, wrap it
  if (error instanceof Error) {
    throw new LangChainExecutionError(
      `${context}: ${error.message}`,
      {
        originalError: error.name,
        originalMessage: error.message,
        stack: error.stack,
        context,
        ...additionalContext
      }
    )
  }

  // For unknown error types
  throw new LangChainExecutionError(
    `${context}: Unknown error occurred`,
    {
      originalError: typeof error,
      originalValue: String(error),
      context,
      ...additionalContext
    }
  )
}

