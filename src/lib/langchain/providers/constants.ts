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
