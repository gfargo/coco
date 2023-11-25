import { removeUndefined } from '../../utils/removeUndefined'
import { Config } from '../types'
import { CONFIG_KEYS } from '../constants'
import { updateFileSection } from '../../utils/updateFileSection'

type Keys = keyof Config
type ValuesTypes = Config[Keys]

/**
 * Load environment variables
 *
 * @param {Config} config
 * @returns {Config} Updated config
 **/
export function loadEnvConfig(config: Config): Config {
  const envConfig: Partial<Config> = {}

  CONFIG_KEYS.forEach((key) => {
    const envVarName = toEnvVarName(key as keyof Config)
    const envValue = parseEnvValue(key, process.env[envVarName])

    if (envValue === undefined) return
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    envConfig[key as Keys] = envValue
  })

  return { ...config, ...removeUndefined(envConfig) }
}

function parseEnvValue(key: string, value: ValuesTypes) {
  if (value === undefined) {
    return undefined
  } else if (key === 'tokenLimit' && typeof value === 'string') {
    return parseInt(value)
  } else if (
    (key === 'ignoredFiles' || key === 'ignoredExtensions') &&
    typeof value === 'string' &&
    value.includes(',')
  ) {
    return value.split(',')
  }
  return value
}

function toEnvVarName(key: Keys): string {
  switch (key) {
    case 'openAIApiKey':
      return 'OPENAI_API_KEY'
    case 'huggingFaceHubApiKey':
      return 'HUGGINGFACE_HUB_API_KEY'
    default:
      return 'COCO_' + key.replace(/([A-Z])/g, '_$1').toUpperCase()
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
  const startComment = '# -- Start coco config --'
  const endComment = '# -- End coco config --'

  const getNewContent = async () => {
    return Object.entries(config)
      .map(([key, value]) => `${toEnvVarName(key as keyof Config)}=${formatEnvValue(value)}`)
      .join('\n')
  }

  await updateFileSection(filePath, startComment, endComment, getNewContent)
}
