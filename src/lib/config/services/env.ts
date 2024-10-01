import { removeUndefined } from '../../utils/removeUndefined'
import { Config } from '../types'
import { CONFIG_KEYS } from '../constants'
import { updateFileSection } from '../../utils/updateFileSection'
import { CONFIG_ALREADY_EXISTS } from '../../ui/helpers'
import { COCO_CONFIG_END_COMMENT, COCO_CONFIG_START_COMMENT } from '../constants'
import { LLMService, OpenAILLMService } from '../../langchain/types'

type ValuesTypes = Config[keyof Config]

/**
 * Load environment variables
 *
 * @param {Config} config
 * @returns {Config} Updated config
 **/
export function loadEnvConfig<ConfigType = Config>(config: Partial<Config>) {
  const envConfig: Partial<Config> = {}

  const envKeys = [...CONFIG_KEYS, 'COCO_SERVICE_PROVIDER', 'COCO_SERVICE_MODEL', 'OPEN_AI_KEY']

  envKeys.forEach((key) => {
    const envVarName = toEnvVarName(key as string)
    const envValue = parseEnvValue(key as string, process.env[envVarName])

    if (envValue === undefined) {
      return
    }

    if (key === 'COCO_SERVICE_PROVIDER' || key === 'COCO_SERVICE_MODEL' || key === 'OPEN_AI_KEY') {
      // NOTE: We want to ensure that the service object is always defined
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      envConfig.service = envConfig.service || {}
      handleServiceEnvVar(envConfig.service as LLMService, key, envValue)
    } else {
      envConfig[key as keyof Config] = envValue
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
        ;(service as OpenAILLMService).fields = { apiKey: value }
      }
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

function formatEnvValue(value: ValuesTypes): string {
  if (typeof value === 'number') {
    return `${value}`
  } else if (Array.isArray(value)) {
    return `${value.join(',')}`
  } else if (typeof value === 'string') {
    // Escape newlines and tabs in strings
    return `${value.replace(/\n/g, '\\n').replace(/\t/g, '\\t')}`
  }

  return `${value}`
}

export const appendToEnvFile = async (filePath: string, config: Partial<Config>) => {
  const getNewContent = async () => {
    return Object.entries(config)
      .map(([key, value]) => {
        if (key === 'service') {
          const service = value as LLMService
          return `${service.provider ? `COCO_SERVICE_PROVIDER=${service.provider}` : ''}\n${
            service.model ? `COCO_SERVICE_MODEL=${service.model}` : ''
          }\n${
            service.authentication.type === 'APIKey'
              ? `OPEN_AI_KEY=${service.authentication.credentials.apiKey}`
              : ''
          }`
        }

        const envVarName = toEnvVarName(key)
        const envValue = formatEnvValue(value)

        return `${envVarName}=${envValue}`
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
