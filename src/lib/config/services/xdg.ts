import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { LLMService } from '../../langchain/types'
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

    const service = mergeXDGServiceConfig(config.service as LLMService | undefined, xdgConfig.service)

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

/**
 * Merges the on-disk XDG `service` block onto the already-accumulated
 * `base` service (default config, or an earlier layer). Unlike the old
 * `parseServiceConfig` (which round-tripped through a per-provider switch
 * and dropped any key it didn't explicitly whitelist), this preserves every
 * key the file sets — including tuning keys like `temperature` and
 * `maxConcurrent` — and falls back to `base` for anything the file omits,
 * so a partial write (e.g. `{"service":{"model":"gpt-4o"}}`) never wipes
 * out the provider or defaults.
 *
 * The flat on-disk `apiKey` (see `toOnDiskConfigKey`) is converted to the
 * nested `authentication.credentials.apiKey` shape the rest of the app
 * expects.
 */
function mergeXDGServiceConfig(base: LLMService | undefined, fileService: unknown): LLMService | undefined {
  if (!isRecord(fileService)) return base

  const { apiKey, ...rest } = fileService
  const merged: Record<string, unknown> = { ...(base ?? {}), ...rest }
  if (typeof apiKey === 'string') {
    merged.authentication = { type: 'APIKey', credentials: { apiKey } }
  }
  return merged as LLMService
}
