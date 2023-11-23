import { removeUndefined } from '../../utils/removeUndefined'
import { Config } from '../types'

/**
 * Load environment variables
 *
 * @param {Config} config
 * @returns {Config} Updated config
 **/
export function loadEnvConfig(config: Config): Config {
  const envConfig: Partial<Config> = {
    model: process.env.COCO_MODEL || undefined,
    openAIApiKey: process.env.OPENAI_API_KEY || undefined,
    huggingFaceHubApiKey: process.env.HUGGINGFACE_HUB_API_KEY || undefined,
    tokenLimit: process.env.COCO_TOKEN_LIMIT
      ? parseInt(process.env.COCO_TOKEN_LIMIT)
      : undefined,
    prompt: process.env.COCO_PROMPT,
    mode: process.env.COCO_MODE as Config['mode'],
    summarizePrompt: process.env.COCO_SUMMARIZE_PROMPT,
    ignoredFiles: process.env.COCO_IGNORED_FILES
      ? process.env.COCO_IGNORED_FILES.split(',')
      : undefined,
    ignoredExtensions: process.env.COCO_IGNORED_EXTENSIONS
      ? process.env.COCO_IGNORED_EXTENSIONS.split(',')
      : undefined,
    defaultBranch: process.env.COCO_DEFAULT_BRANCH || undefined,
  }

  config = { ...config, ...removeUndefined(envConfig) }
  return config
}
