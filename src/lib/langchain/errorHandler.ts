import { LangChainError, LangChainExecutionError } from './errors'

// Re-export retry utilities from general utils
export { 
  withRetry, 
  withTimeout, 
  withRetryAndTimeout,
  type RetryOptions 
} from '../utils/retry'

/**
 * Wraps errors with additional context and converts them to LangChain errors
 */
export function handleLangChainError(
  error: unknown,
  context: string,
  additionalContext?: Record<string, unknown>
): never {
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

