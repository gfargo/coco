import { LangChainError, LangChainExecutionError, LangChainNetworkError } from './errors'

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

