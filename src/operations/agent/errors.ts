import { z } from 'zod'

import {
    extractRetryAfterMs,
    isQuotaExceededError,
    isRateLimitError,
    isRetryableError,
} from '../../lib/langchain/errorHandler'
import {
    LangChainAuthenticationError,
    LangChainCancelledError,
    LangChainError,
    LangChainNetworkError,
    LangChainQuotaExceededError,
    LangChainRateLimitError,
    LangChainTimeoutError,
} from '../../lib/langchain/errors'
import {
    AGENT_ERROR_CODE_CATEGORIES,
    AgentErrorCode,
    AgentFailureEnvelope,
    AgentOperation,
    AGENT_PROTOCOL_VERSION,
} from './schemas'

export class AgentOperationError extends Error {
  constructor(
    public readonly code: AgentErrorCode,
    message: string,
    public readonly retryable = false,
    public readonly details?: unknown,
    /** Provider-requested wait before a retry, when it gave one. */
    public readonly retryAfterMs?: number,
  ) {
    super(message)
    this.name = 'AgentOperationError'
  }
}

function contextRetryAfterMs(error: LangChainError): number | undefined {
  const value = error.context?.retryAfterMs
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined
}

/**
 * Provider and network failures (#1844). `retryable` used to be false for
 * all of them, so an agent following "retry when retryable" never retried a
 * rate limit or a dropped connection. The typed LangChain errors are what
 * coco's own provider layer produces; raw SDK errors reach here when a call
 * bypassed that layer, and get the same classification.
 */
function classifyProviderError(error: unknown): AgentOperationError | undefined {
  const message = error instanceof Error ? error.message : String(error)
  // Quota exhaustion is also a 429, but waiting does not fix it.
  if (error instanceof LangChainQuotaExceededError || (!(error instanceof LangChainError) && isQuotaExceededError(error))) {
    return new AgentOperationError('QUOTA_EXCEEDED', message, false)
  }
  if (error instanceof LangChainRateLimitError) {
    return new AgentOperationError('RATE_LIMITED', message, true, undefined, contextRetryAfterMs(error))
  }
  if (error instanceof LangChainAuthenticationError) {
    return new AgentOperationError('AUTHENTICATION_REQUIRED', message, false)
  }
  if (error instanceof LangChainNetworkError || error instanceof LangChainTimeoutError) {
    return new AgentOperationError('PROVIDER_UNAVAILABLE', message, true)
  }
  if (error instanceof LangChainError) return undefined
  if (isRateLimitError(error)) {
    return new AgentOperationError('RATE_LIMITED', message, true, undefined, extractRetryAfterMs(error))
  }
  if (isRetryableError(error)) {
    return new AgentOperationError('PROVIDER_UNAVAILABLE', message, true, undefined, extractRetryAfterMs(error))
  }
  return undefined
}

export function toAgentOperationError(error: unknown): AgentOperationError {
  if (error instanceof AgentOperationError) return error
  if (error instanceof z.ZodError) {
    return new AgentOperationError(
      'INVALID_INPUT',
      'Agent request validation failed.',
      false,
      error.issues,
    )
  }
  if (
    error instanceof LangChainCancelledError ||
    (error instanceof Error && error.name === 'AbortError')
  ) {
    return new AgentOperationError('CANCELLED', 'Operation was cancelled.', false)
  }
  const providerError = classifyProviderError(error)
  if (providerError) return providerError
  if (error instanceof Error) {
    return new AgentOperationError('OPERATION_FAILED', error.message, false)
  }
  return new AgentOperationError('OPERATION_FAILED', String(error), false)
}

export function createAgentFailureEnvelope(
  operation: AgentOperation,
  error: AgentOperationError,
): AgentFailureEnvelope {
  return {
    version: AGENT_PROTOCOL_VERSION,
    ok: false,
    operation,
    error: {
      code: error.code,
      category: AGENT_ERROR_CODE_CATEGORIES[error.code],
      message: error.message,
      retryable: error.retryable,
      ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
      ...(error.details === undefined ? {} : { details: error.details }),
    },
  }
}
