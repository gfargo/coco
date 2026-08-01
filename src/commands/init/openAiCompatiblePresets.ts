/**
 * Named presets for OpenAI-compatible endpoints (#1610). `service.baseURL`
 * on the OpenAI provider already supports pointing at any OpenAI-compatible
 * API — these presets just make that capability discoverable from the
 * `coco init` wizard instead of requiring a hand-edited config file.
 *
 * OpenRouter, Groq, LM Studio, and vLLM used to live here too, but they're
 * now first-class providers in their own right (`openrouter` / `groq` /
 * `lmstudio` / `vllm` — #OSS-1623): registered in the provider registry with
 * their own `tokenCorrectionFactor`, auth env var, and doctor support, none
 * of which this `openai` + `baseURL` escape hatch gets. `custom` is what's
 * left: the generic fallback for any OpenAI-compatible API that isn't (yet)
 * one of the named providers.
 */
export type OpenAiCompatiblePresetId = 'custom'

export type OpenAiCompatiblePreset = {
  id: OpenAiCompatiblePresetId
  label: string
  /** Fixed endpoint, or undefined when the user must supply one (custom). */
  baseURL?: string
  /** Env var name hint shown in the API-key prompt. */
  apiKeyEnvVar: string
  /** Local/self-hosted endpoints typically don't enforce a real key. */
  requiresApiKey: boolean
}

export const OPENAI_COMPATIBLE_PRESETS: OpenAiCompatiblePreset[] = [
  {
    id: 'custom',
    label: 'Custom OpenAI-compatible URL',
    apiKeyEnvVar: 'OPENAI_COMPATIBLE_API_KEY',
    requiresApiKey: false,
  },
]

export function findOpenAiCompatiblePreset(id: string): OpenAiCompatiblePreset | undefined {
  return OPENAI_COMPATIBLE_PRESETS.find((preset) => preset.id === id)
}
