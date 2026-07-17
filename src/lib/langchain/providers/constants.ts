/**
 * Default cap on model output tokens, applied by every provider before an
 * explicit `service.fields` override. Without this, providers fall back to
 * their SDK's own default (which varies per model and can be lower than a
 * verbose commit body or split-plan JSON response needs) — see the AI-core
 * audit's "no max-output-tokens set" finding. Comfortably above the 512-token
 * `responseTokenReserve` in `enforcePromptBudget` and the `tokenLimit` input
 * default in `utils.ts`.
 */
export const DEFAULT_MAX_OUTPUT_TOKENS = 4096

/**
 * Default cap on the LangChain AsyncCaller's internal retry count, applied by
 * every provider before an explicit `service.requestOptions.maxRetries` or
 * `service.fields` override. Without this, providers fall back to the SDK's
 * default of 6 internal retries with exponential backoff (~63s worst case),
 * which then multiplies against coco's own retry layers (`invokeWithBackoff`,
 * `withRetry`) — up to ~28 attempts for a single failing call. Coco's outer
 * layers are the single retry authority; the provider itself should not retry.
 */
export const DEFAULT_PROVIDER_MAX_RETRIES = 0
