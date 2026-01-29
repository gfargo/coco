import { LLMService, OllamaLLMService, OpenAILLMService } from '../../langchain/types'
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
 * @returns {Config} Updated config
 **/
export function loadEnvConfig<ConfigType = Config>(config: Partial<Config>) {
  const envConfig: Partial<Record<keyof Config, ValuesTypes>> = {}

  const envKeys = [
    ...CONFIG_KEYS,
    'COCO_SERVICE_PROVIDER',
    'COCO_SERVICE_MODEL',
    'OPEN_AI_KEY',
    'COCO_SERVICE_BASE_URL',
    'COCO_SERVICE_ENDPOINT',
    'COCO_SERVICE_REQUEST_OPTIONS_TIMEOUT',
    'COCO_SERVICE_REQUEST_OPTIONS_MAX_RETRIES',
    'COCO_SERVICE_FIELDS',
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
      key === 'COCO_SERVICE_BASE_URL' ||
      key === 'COCO_SERVICE_ENDPOINT' ||
      key === 'COCO_SERVICE_REQUEST_OPTIONS_TIMEOUT' ||
      key === 'COCO_SERVICE_REQUEST_OPTIONS_MAX_RETRIES' ||
      key === 'COCO_SERVICE_FIELDS'
    ) {
      // NOTE: We want to ensure that the service object is always defined
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      envConfig.service = envConfig.service || {}
      handleServiceEnvVar(envConfig.service as LLMService, key, envValue)
    } else {
      if (key === 'service' || !envValue) {
        return
      }

      envConfig[key as keyof typeof envConfig] = envValue as ValuesTypes
    }
  })

  return { ...config, ...removeUndefined(envConfig) } as ConfigType
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function handleServiceEnvVar(service: LLMService, key: string, value: any) {
  switch (key) {
    case 'COCO_SERVICE_PROVIDER':
      service.provider = value
      break
    case 'COCO_SERVICE_MODEL':
      service.model = value
      break
    case 'OPEN_AI_KEY':
      if (service.provider === 'openai') {
        service.authentication = {
          type: 'APIKey',
          credentials: {
            apiKey: value,
          },
        }
      }
      break
    case 'COCO_SERVICE_BASE_URL':
      if (service.provider === 'openai') {
        // Cast to OpenAILLMService to access baseURL property
        (service as OpenAILLMService).baseURL = value
      }
      break
    case 'COCO_SERVICE_ENDPOINT':
      if (service.provider === 'ollama') {
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
  }
}

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

    // Handle number values
    case typeof value === 'string' && !isNaN(Number(value)):
      return Number(value)

    // Handle JSON strings
    case typeof value === 'string' && value.startsWith('{'):
      return JSON.parse(value)

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
