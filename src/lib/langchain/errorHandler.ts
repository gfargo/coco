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

