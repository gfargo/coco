import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { AnthropicLLMService, AzureLLMService, GeminiLLMService, LLMService, MistralLLMService, OllamaLLMService, OpenAILLMService } from '../../langchain/types'
import { Config } from '../types'

/**
 * Load XDG config
 *
 * @param {Config} config
 * @param {object} opts
 * @returns {Config} Updated config
 */
export function loadXDGConfig<ConfigType = Config>(
  config: Partial<Config>,
  opts: { returnSource: true }
): { config: ConfigType; path?: string }
export function loadXDGConfig<ConfigType = Config>(
  config: Partial<Config>,
  opts?: { returnSource?: false }
): ConfigType
export function loadXDGConfig<ConfigType = Config>(
  config: Partial<Config>,
  opts?: { returnSource?: boolean }
): ConfigType | { config: ConfigType; path?: string } {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
  const xdgConfigPath = path.join(xdgConfigHome, 'coco', 'config.json')
  let foundPath: string | undefined

  if (fs.existsSync(xdgConfigPath)) {
    foundPath = xdgConfigPath
    const xdgConfig = JSON.parse(fs.readFileSync(xdgConfigPath, 'utf-8'))

    const service = parseServiceConfig(xdgConfig.service || config.service)

    config = { 
      ...config, 
      ...xdgConfig, 
      service: service 
    }
  }

  if (opts?.returnSource) {
    return { config: config as ConfigType, path: foundPath }
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
        baseURL: service.baseURL,
        authentication: {
          type: 'APIKey',
          credentials: {
            apiKey: service.apiKey
          }
        },
        fields: service.fields
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
    case 'gemini':
      return {
        provider: 'gemini',
        model: service.model,
        authentication: {
          type: 'APIKey',
          credentials: {
            apiKey: service.apiKey
          }
        },
        fields: service.fields
      } as GeminiLLMService
    case 'mistral':
      return {
        provider: 'mistral',
        model: service.model,
        authentication: {
          type: 'APIKey',
          credentials: {
            apiKey: service.apiKey
          }
        },
        fields: service.fields
      } as MistralLLMService
    case 'azure':
      return {
        provider: 'azure',
        model: service.model,
        instanceName: service.instanceName,
        deploymentName: service.deploymentName,
        apiVersion: service.apiVersion,
        authentication: {
          type: 'APIKey',
          credentials: {
            apiKey: service.apiKey
          }
        },
        fields: service.fields
      } as AzureLLMService
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
