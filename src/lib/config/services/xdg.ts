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

/** Shallow object guard used by the config merge writers. */
export function isRecord(value: unknown): value is Record<string, unknown> {
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
      const service = mergeXDGServiceConfig(config.service as LLMService | undefined, parsed.service)

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
