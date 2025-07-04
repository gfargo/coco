/**
 * Options for retry behavior
 */
export interface RetryOptions {
  /** Maximum number of attempts (default: 3) */
  maxAttempts?: number
  /** Base delay between retries in milliseconds (default: 1000) */
  backoffMs?: number
  /** Multiplier for exponential backoff (default: 2) */
  backoffMultiplier?: number
  /** Maximum delay between retries in milliseconds (default: 10000) */
  maxBackoffMs?: number
  /** Called on each retry attempt */
  onRetry?: (attempt: number, error: Error, nextDelayMs: number) => void
  /** Function to determine if an error should trigger a retry */
  shouldRetry?: (error: Error) => boolean
}

/**
 * Default retry predicate - retries on non-validation errors
 */
function defaultShouldRetry(error: Error): boolean {
  // Don't retry validation errors or configuration errors
  if (error.name.includes('Validation') || error.name.includes('Configuration')) {
    return false
  }
  
  // Don't retry authentication errors
  if (error.name.includes('Authentication')) {
    return false
  }
  
  // Retry execution errors and timeouts
  return true
}

/**
 * Executes an operation with retry logic
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    backoffMs = 1000,
    backoffMultiplier = 2,
    maxBackoffMs = 10000,
    onRetry,
    shouldRetry = defaultShouldRetry
  } = options
  
  let lastError: Error = new Error('No attempts made')
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      
      // If this is the last attempt or we shouldn't retry, throw the error
      if (attempt === maxAttempts || !shouldRetry(lastError)) {
        throw lastError
      }
      
      // Calculate delay with exponential backoff
      const delay = Math.min(
        backoffMs * Math.pow(backoffMultiplier, attempt - 1),
        maxBackoffMs
      )
      
      // Call retry callback if provided
      if (onRetry) {
        onRetry(attempt, lastError, delay)
      }
      
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
  
  // This should never be reached, but TypeScript requires it
  throw new Error(
    `Operation failed after ${maxAttempts} attempts. Last error: ${lastError.message}`
  )
}

/**
 * Creates a timeout wrapper for async operations
 */
export function withTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  context: string
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(
        `${context}: Operation timed out after ${timeoutMs}ms`
      ))
    }, timeoutMs)
    
    operation()
      .then(result => {
        clearTimeout(timeoutId)
        resolve(result)
      })
      .catch(error => {
        clearTimeout(timeoutId)
        reject(error)
      })
  })
}

/**
 * Combines retry logic with timeout
 */
export async function withRetryAndTimeout<T>(
  operation: () => Promise<T>,
  retryOptions: RetryOptions = {},
  timeoutMs?: number,
  context = 'Operation'
): Promise<T> {
  const wrappedOperation = timeoutMs 
    ? () => withTimeout(operation, timeoutMs, context)
    : operation
    
  return withRetry(wrappedOperation, retryOptions)
}