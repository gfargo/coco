import { LLMProvider, LLMService, OllamaLLMService, OpenAILLMService } from '../../langchain/types'
import { CONFIG_ALREADY_EXISTS } from '../../ui/helpers'
import { removeUndefined } from '../../utils/removeUndefined'
import { updateFileSection } from '../../utils/updateFileSection'
import { COCO_CONFIG_END_COMMENT, COCO_CONFIG_START_COMMENT, CONFIG_KEYS } from '../constants'
import { Config } from '../types'

type ValuesTypes = Config[keyof Config]

/**
 * Load environment variables
 *
 * @param {Config} config
 * @param {object} opts
 * @returns {Config} Updated config
 **/
export function loadEnvConfig<ConfigType = Config>(
  config: Partial<Config>,
  opts: { returnSource: true }
): { config: ConfigType; active: boolean }
export function loadEnvConfig<ConfigType = Config>(
  config: Partial<Config>,
  opts?: { returnSource?: false }
): ConfigType
export function loadEnvConfig<ConfigType = Config>(
  config: Partial<Config>,
  opts?: { returnSource?: boolean }
): ConfigType | { config: ConfigType; active: boolean } {
  const envConfig: Partial<Record<keyof Config, ValuesTypes>> = {}
  let foundAny = false

  const envKeys = [
    ...CONFIG_KEYS,
    'COCO_SERVICE_PROVIDER',
    'COCO_SERVICE_MODEL',
    'OPEN_AI_KEY',
    'GEMINI_API_KEY',
    'GOOGLE_API_KEY',
    'MISTRAL_API_KEY',
    'AZURE_OPENAI_API_KEY',
    'COCO_SERVICE_BASE_URL',
    'COCO_SERVICE_ENDPOINT',
    'COCO_SERVICE_REQUEST_OPTIONS_TIMEOUT',
    'COCO_SERVICE_REQUEST_OPTIONS_MAX_RETRIES',
    'COCO_SERVICE_FIELDS',
    'COCO_SERVICE_DYNAMIC_MODELS',
    'COCO_SERVICE_DYNAMIC_MODEL_PREFERENCE',
  ]

  envKeys.forEach((key) => {
    const envVarName = toEnvVarName(key as string)
    const envValue = parseEnvValue(key as string, process.env[envVarName])

    if (envValue === undefined) {
      return
    }

    if (
      key === 'COCO_SERVICE_PROVIDER' ||
      key === 'COCO_SERVICE_MODEL' ||
      key === 'OPEN_AI_KEY' ||
      key === 'GEMINI_API_KEY' ||
      key === 'GOOGLE_API_KEY' ||
      key === 'MISTRAL_API_KEY' ||
      key === 'AZURE_OPENAI_API_KEY' ||
      key === 'COCO_SERVICE_BASE_URL' ||
      key === 'COCO_SERVICE_ENDPOINT' ||
      key === 'COCO_SERVICE_REQUEST_OPTIONS_TIMEOUT' ||
      key === 'COCO_SERVICE_REQUEST_OPTIONS_MAX_RETRIES' ||
      key === 'COCO_SERVICE_FIELDS' ||
      key === 'COCO_SERVICE_DYNAMIC_MODELS' ||
      key === 'COCO_SERVICE_DYNAMIC_MODEL_PREFERENCE'
    ) {
      // NOTE: We want to ensure that the service object is always defined
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      envConfig.service = envConfig.service || {}
      // Provider-scoped env vars (API keys) must be matched against the
      // EFFECTIVE provider, which usually comes from an earlier config layer
      // (config file / git), not from this env pass. Fall back to it so e.g.
      // OPEN_AI_KEY applies to a file-configured openai service even when
      // COCO_SERVICE_PROVIDER isn't also set.
      const effectiveProvider =
        (envConfig.service as Partial<LLMService>).provider ?? config.service?.provider
      handleServiceEnvVar(envConfig.service as LLMService, key, envValue, effectiveProvider)
      foundAny = true
    } else {
      if (key === 'service' || !envValue) {
        return
      }

      envConfig[key as keyof typeof envConfig] = envValue as ValuesTypes
      foundAny = true
    }
  })

  const cleanedEnv = removeUndefined(envConfig)
  const merged = { ...config, ...cleanedEnv } as ConfigType

  // Deep-merge `service` rather than letting the shallow top-level spread
  // replace it. An env var that only touches the service (e.g. OPEN_AI_KEY sets
  // just `authentication`) would otherwise clobber the provider/model/etc. that
  // an earlier config layer already established.
  if (envConfig.service && config.service) {
    ;(merged as Config).service = {
      ...(config.service as object),
      ...(envConfig.service as object),
    } as Config['service']
  }

  if (opts?.returnSource) {
    return { config: merged, active: foundAny }
  }
  return merged
}

function handleServiceEnvVar(
  service: LLMService,
  key: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any,
  effectiveProvider?: LLMProvider
) {
  switch (key) {
    case 'COCO_SERVICE_PROVIDER':
      service.provider = value
      break
    case 'COCO_SERVICE_MODEL':
      service.model = value
      break
    case 'OPEN_AI_KEY':
      if (effectiveProvider === 'openai') {
        service.authentication = {
          type: 'APIKey',
          credentials: {
            apiKey: value,
          },
        }
      }
      break
    case 'GEMINI_API_KEY':
    case 'GOOGLE_API_KEY':
      if (effectiveProvider === 'gemini') {
        service.authentication = {
          type: 'APIKey',
          credentials: {
            apiKey: value,
          },
        }
      }
      break
    case 'MISTRAL_API_KEY':
      if (effectiveProvider === 'mistral') {
        service.authentication = {
          type: 'APIKey',
          credentials: {
            apiKey: value,
          },
        }
      }
      break
    case 'AZURE_OPENAI_API_KEY':
      if (effectiveProvider === 'azure') {
        service.authentication = {
          type: 'APIKey',
          credentials: {
            apiKey: value,
          },
        }
      }
      break
    case 'COCO_SERVICE_BASE_URL':
      if (effectiveProvider === 'openai') {
        // Cast to OpenAILLMService to access baseURL property
        (service as OpenAILLMService).baseURL = value
      }
      break
    case 'COCO_SERVICE_ENDPOINT':
      if (effectiveProvider === 'ollama') {
        (service as OllamaLLMService).endpoint = value
      }
      break
    case 'COCO_SERVICE_REQUEST_OPTIONS_TIMEOUT':
      service.requestOptions = { ...service.requestOptions, timeout: value }
      break
    case 'COCO_SERVICE_REQUEST_OPTIONS_MAX_RETRIES':
      service.requestOptions = { ...service.requestOptions, maxRetries: value }
      break
    case 'COCO_SERVICE_FIELDS':
      service.fields = value
      break
    case 'COCO_SERVICE_DYNAMIC_MODELS':
      service.dynamicModels = value
      break
    case 'COCO_SERVICE_DYNAMIC_MODEL_PREFERENCE':
      service.dynamicModelPreference = value
      break
  }
}

/**
 * Keys whose env-var values should be coerced to numbers. All other
 * numeric-looking strings (e.g. a model name that happens to be all digits)
 * are left as strings so downstream schema validation (type: "string") and
 * provider-mismatch checks see the correct type. (#1468)
 */
const NUMERIC_ENV_KEYS = new Set([
  'COCO_SERVICE_REQUEST_OPTIONS_TIMEOUT',
  'COCO_SERVICE_REQUEST_OPTIONS_MAX_RETRIES',
])

function parseEnvValue(key: string, value: ValuesTypes) {
  switch (true) {
    // Handle undefined values
    case value === undefined:
      return undefined

    // Handle comma separated strings for ignoredFiles and ignoredExtensions arrays
    case (key === 'ignoredFiles' || key === 'ignoredExtensions') &&
      typeof value === 'string' &&
      value.includes(','):
      return (value as string).split(',')

    // Handle boolean values
    case typeof value === 'string' && (value === 'false' || value === 'true'):
      return value === 'true'

    // Handle number values — only for explicitly numeric keys (#1468)
    case typeof value === 'string' && NUMERIC_ENV_KEYS.has(key) && !isNaN(Number(value)):
      return Number(value)

    // Handle JSON strings — wrap in try/catch so malformed JSON degrades
    // gracefully instead of crashing every command (#1468)
    case typeof value === 'string' && value.startsWith('{'):
      try {
        return JSON.parse(value)
      } catch {
        console.warn(
          `[coco] Warning: env var ${toEnvVarName(key)} contains malformed JSON — ignoring.`
        )
        return undefined
      }

    default:
      return value
  }
}

function toEnvVarName(key: string): string {
  if (key === 'service') {
    return key
  }

  if (key.includes('COCO_')) {
    return key
  }

  // Already an env-var-form name (UPPER_SNAKE_CASE), e.g. OPEN_AI_KEY,
  // GEMINI_API_KEY, AZURE_OPENAI_API_KEY. Read these verbatim — the
  // camelCase→COCO_ transform below would mangle every uppercase letter
  // (OPEN_AI_KEY → COCO__O_P_E_N__A_I__K_E_Y), so without this guard the
  // provider API-key env vars were never resolved.
  if (/^[A-Z0-9]+(?:_[A-Z0-9]+)*$/.test(key)) {
    return key
  }

  return `COCO_${key.replace(/([A-Z])/g, '_$1').toLocaleUpperCase()}`
}

const flattenObject = (obj: object, prefix = '') => {
  let flattened: Record<string, string> = {}

  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const propName = prefix ? `${prefix}_${key}` : key
      const value = obj[key as keyof typeof obj]

      // Skip undefined or null values
      if (value === undefined || value === null) {
        continue;
      }

      if (typeof value === 'object' && !Array.isArray(value)) {
        // Handle nested objects, but specifically handle 'fields' as JSON string
        if (key === 'fields') {
          flattened[propName.toUpperCase()] = JSON.stringify(value)
        } else {
          flattened = { ...flattened, ...flattenObject(value, propName) }
        }
      } else {
        // For primitive types (string, number, boolean, symbol, bigint) and arrays
        flattened[propName.toUpperCase()] = String(value)
      }
    }
  }

  return flattened
}

export const appendToEnvFile = async (filePath: string, config: Partial<Config>) => {
  const getNewContent = async () => {
    const flattenedConfig = flattenObject(config)
    return Object.entries(flattenedConfig)
      .map(([key, value]) => {
        const envVarName = toEnvVarName(key)
        return `${envVarName}=${value}`
      })
      .join('\n')
  }

  await updateFileSection({
    filePath,
    startComment: COCO_CONFIG_START_COMMENT,
    endComment: COCO_CONFIG_END_COMMENT,
    getNewContent,
    confirmMessage: CONFIG_ALREADY_EXISTS,
  })
}
