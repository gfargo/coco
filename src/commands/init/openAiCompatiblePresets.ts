/**
 * Named presets for OpenAI-compatible endpoints (#1610). `service.baseURL`
 * on the OpenAI provider already supports pointing at any OpenAI-compatible
 * API — these presets just make that capability discoverable from the
 * `coco init` wizard instead of requiring a hand-edited config file.
 */
export type OpenAiCompatiblePresetId = 'openrouter' | 'groq' | 'lmstudio' | 'vllm' | 'custom'

export type OpenAiCompatiblePreset = {
  id: OpenAiCompatiblePresetId
  label: string
  /** Fixed endpoint, or undefined when the user must supply one (vLLM / custom). */
  baseURL?: string
  /** Env var name hint shown in the API-key prompt. */
  apiKeyEnvVar: string
  /** Local/self-hosted endpoints typically don't enforce a real key. */
  requiresApiKey: boolean
}

export const OPENAI_COMPATIBLE_PRESETS: OpenAiCompatiblePreset[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    apiKeyEnvVar: 'OPENROUTER_API_KEY',
    requiresApiKey: true,
  },
  {
    id: 'groq',
    label: 'Groq',
    baseURL: 'https://api.groq.com/openai/v1',
    apiKeyEnvVar: 'GROQ_API_KEY',
    requiresApiKey: true,
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    baseURL: 'http://localhost:1234/v1',
    apiKeyEnvVar: 'LMSTUDIO_API_KEY',
    requiresApiKey: false,
  },
  {
    id: 'vllm',
    label: 'vLLM',
    apiKeyEnvVar: 'VLLM_API_KEY',
    requiresApiKey: false,
  },
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
