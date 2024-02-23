import { removeUndefined } from '../../utils/removeUndefined'
import { Config } from '../types'
import { CONFIG_KEYS } from '../constants'
import { updateFileSection } from '../../utils/updateFileSection'
import { CONFIG_ALREADY_EXISTS } from '../../ui/helpers'
import { COCO_CONFIG_START_COMMENT } from '../constants'
import { COCO_CONFIG_END_COMMENT } from '../constants'

type ValuesTypes = Config[keyof Config]

/**
 * Load environment variables
 *
 * @param {Config} config
 * @returns {Config} Updated config
 **/
export function loadEnvConfig<ConfigType = Config>(config: Partial<Config>) {
  const envConfig: Partial<Config> = {}

  CONFIG_KEYS.forEach((key) => {
    const envVarName = toEnvVarName(key as string)
    const envValue = parseEnvValue(key as string, process.env[envVarName])

    if (envValue === undefined) {
      return
    }
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    envConfig[key as string] = envValue
  })

  return { ...config, ...removeUndefined(envConfig) } as ConfigType
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
      return value.split(',')
    // Handle boolean values
    case typeof value === 'string' && (value === 'false' || value === 'true'):
      return value === 'true'
    default:
      return value
  }
}

function toEnvVarName(key: string): string {
  switch (key) {
    case 'openAIApiKey':
      return 'OPENAI_API_KEY'
    default:
      return `COCO_${key.replace(/([A-Z])/g, '_$1').toLocaleUpperCase()}`
  }
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
      .map(
        ([key, value]) => `${toEnvVarName(key as string)}=${formatEnvValue(value as ValuesTypes)}`
      )
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
