import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { AnthropicLLMService, AzureLLMService, BedrockLLMService, GeminiLLMService, LLMService, MistralLLMService, OllamaLLMService, OpenAILLMService } from '../../langchain/types'
import { Config } from '../types'

/** Path to the global XDG config (`$XDG_CONFIG_HOME/coco/config.json`). */
export function getXdgConfigPath(): string {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
  return path.join(xdgConfigHome, 'coco', 'config.json')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Persist `telemetry.usage` into the global XDG config, merging into any
 * existing content (only this one key is touched). This is the per-machine home
 * for the recording preference — deliberately NOT the project config, so a
 * shared repo can't flip a collaborator's local recording on. Returns true on
 * success; best-effort, so a read-only HOME or malformed file never throws.
 */
export function persistUsagePreference(usage: boolean): boolean {
  const file = getXdgConfigPath()
  try {
    let config: Record<string, unknown> = {}
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (isRecord(parsed)) config = parsed
    } catch {
      // No existing file (or unreadable/malformed) — start fresh.
      config = {}
    }
    const telemetry = isRecord(config.telemetry) ? config.telemetry : {}
    config.telemetry = { ...telemetry, usage }

    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`)
    return true
  } catch {
    return false
  }
}

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
  const xdgConfigPath = getXdgConfigPath()
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
    case 'bedrock':
      return {
        provider: 'bedrock',
        model: service.model,
        region: service.region,
        accessKeyId: service.accessKeyId,
        secretAccessKey: service.secretAccessKey,
        sessionToken: service.sessionToken,
        authentication: {
          type: 'None',
          credentials: undefined
        },
        fields: service.fields
      } as BedrockLLMService
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
