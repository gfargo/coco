/**
 * Base class for all LangChain-related errors
 */
export class LangChainError extends Error {
  constructor(
    message: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(message)
    this.name = this.constructor.name
  }
}

/**
 * Configuration-related errors (invalid service configs, missing settings, etc.)
 */
export class LangChainConfigurationError extends LangChainError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, context)
  }
}

/**
 * Input validation errors (missing required parameters, invalid types, etc.)
 */
export class LangChainValidationError extends LangChainError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, context)
  }
}

/**
 * Runtime execution errors (LLM failures, parsing errors, etc.)
 */
export class LangChainExecutionError extends LangChainError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, context)
  }
}

/**
 * Schema/format parse failures (#1460 / OSS-503) — the model's output could
 * not be parsed into the requested shape (bad JSON, schema mismatch). A
 * subclass of `LangChainExecutionError` so existing `instanceof
 * LangChainExecutionError` call sites still treat it as a LangChain error,
 * while `withRetry`'s default predicate can single it out to avoid
 * re-billing an identical call that's unlikely to parse differently.
 */
export class LangChainSchemaParseError extends LangChainExecutionError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, context)
  }
}

/**
 * Authentication-related errors (missing API keys, invalid credentials, etc.)
 *
 * Carries `provider` + `endpoint` context so the formatter (in
 * `commandExecutor`) can render provider-specific recovery hints
 * ("set OPENAI_API_KEY", "run `gh auth login`", etc.) instead of the
 * generic "verify your API key" copy. Mirrors the shape of
 * `LangChainNetworkError` so call sites can hand the same fields to
 * either constructor depending on which condition fired.
 */
export class LangChainAuthenticationError extends LangChainError {
  constructor(
    message: string,
    public readonly provider?: string,
    public readonly endpoint?: string,
    context?: Record<string, unknown>
  ) {
    super(message, { ...context, provider, endpoint })
  }
}

/**
 * Timeout and retry-related errors
 */
export class LangChainTimeoutError extends LangChainError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, context)
  }
}

/**
 * Network/connection errors (service unreachable, DNS failures, etc.)
 */
export class LangChainNetworkError extends LangChainError {
  constructor(
    message: string,
    public readonly endpoint?: string,
    public readonly provider?: string,
    context?: Record<string, unknown>
  ) {
    super(message, { ...context, endpoint, provider })
  }
}

/**
 * User-initiated cancellation (#881 phase 3). Thrown by streaming
 * helpers when an `AbortSignal` they were given fires. Distinct from
 * `LangChainNetworkError` / `LangChainTimeoutError` so callers can
 * pattern-match: a cancelled LLM call is the user's intent, not a
 * failure to surface in the status line as an error.
 *
 * Carries the accumulated text up to the cancel point (when
 * available) so the caller can decide whether to salvage a partial
 * result or discard it. Today the workstation discards — the
 * preview pane was the only consumer of the accumulated text and it
 * gets cleared on cancel anyway.
 */
export class LangChainCancelledError extends LangChainError {
  constructor(
    message: string,
    public readonly accumulated?: string,
    context?: Record<string, unknown>,
  ) {
    super(message, { ...context, accumulated })
  }
}