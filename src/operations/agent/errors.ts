import { z } from 'zod'

import { LangChainCancelledError } from '../../lib/langchain/errors'
import {
    AgentFailureEnvelope,
    AgentOperation,
    AGENT_PROTOCOL_VERSION,
} from './schemas'

export class AgentOperationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = false,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'AgentOperationError'
  }
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
      message: error.message,
      retryable: error.retryable,
      ...(error.details === undefined ? {} : { details: error.details }),
    },
  }
}
