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
 * Config is loaded many times per command run, so a malformed XDG file
 * would otherwise print the same warning repeatedly for one invocation.
 * Mirrors project.ts's warn-once guard, kept independent (own file, own
 * key) so the two loaders don't couple or suppress each other.
 */
const warnedXdgPaths = new Set<string>()

function warnXdgParseOnce(resolvedPath: string, message: string): void {
  if (warnedXdgPaths.has(resolvedPath)) return
  warnedXdgPaths.add(resolvedPath)
  console.warn(message)
}

/**
 * Clears the warn-once guard. Intended for tests that exercise the
 * warning paths in isolation — production code never needs to reset it.
 */
export function resetXdgConfigLoadWarnings(): void {
  warnedXdgPaths.clear()
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

    // Parse defensively — a malformed XDG config (stray comma, truncated
    // file) must not crash every command at load time. Warn with the file
    // path + reason and fall back to the other config sources instead.
    let parsed: unknown
    try {
      parsed = JSON.parse(fs.readFileSync(xdgConfigPath, 'utf-8'))
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      warnXdgParseOnce(
        xdgConfigPath,
        `[coco] Warning: could not parse ${xdgConfigPath} as JSON — ignoring it.\n` +
        `  Parse error: ${reason}\n` +
        `  Fix the file's syntax (or run \`coco init\` to regenerate it). ` +
        `Other config sources (defaults, project, git, env) still apply.`
      )
    }

    if (isRecord(parsed)) {
      const service = parseServiceConfig(parsed.service || config.service)

      config = {
        ...config,
        ...parsed,
        service: service
      }
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
