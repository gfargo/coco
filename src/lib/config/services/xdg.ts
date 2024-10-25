import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { AnthropicLLMService, LLMService, OllamaLLMService, OpenAILLMService } from '../../langchain/types'
import { Config } from '../types'

/**
 * Load XDG config
 *
 * @param {Config} config
 * @returns {Config} Updated config
 */
export function loadXDGConfig<ConfigType = Config>(config: Partial<Config>) {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
  const xdgConfigPath = path.join(xdgConfigHome, 'coco', 'config.json')
  if (fs.existsSync(xdgConfigPath)) {
    const xdgConfig = JSON.parse(fs.readFileSync(xdgConfigPath, 'utf-8'))

    const service = parseServiceConfig(xdgConfig.service || config.service)

    config = { 
      ...config, 
      ...xdgConfig, 
      service: service 
    }
  }
  return config as ConfigType
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseServiceConfig(service: any): LLMService | undefined {
  if (!service) return undefined

  switch (service.provider) {
    case 'openai':
      return {
        provider: 'openai',
        model: service.model,
        authentication: {
          type: 'APIKey',
          credentials: {
            apiKey: service.apiKey
          }
        }
      } as OpenAILLMService
    case 'anthropic':
      return {
        provider: 'anthropic',
        model: service.model,
        authentication: {
          type: 'APIKey',
          credentials: {
            apiKey: service.apiKey
          }
        },
        fields: service.fields
      } as AnthropicLLMService
    case 'ollama':
      return {
        provider: 'ollama',
        model: service.model,
        endpoint: service.endpoint,
        fields: service.fields
      } as OllamaLLMService
    default:
      return undefined
  }
}
