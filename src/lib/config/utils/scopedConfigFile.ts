import * as fs from 'fs'
import * as path from 'path'
import { getXdgConfigPath } from '../services/xdg'
import { TRUSTED_PROJECT_SERVICE_KEYS } from '../services/project'
import { resolveGitRepoRoot } from '../../utils/resolveGitRepoRoot'
import { SCHEMA_PUBLIC_URL } from '../../schema'
import { resolveProjectConfigPath } from './projectConfigPath'

export type ConfigWriteScope = 'global' | 'project'

// Re-exported for existing callers; the candidate list and lookup helpers
// live in `projectConfigPath.ts` so `services/project.ts` can consume them
// without creating an import cycle (this module already imports from
// `services/project.ts` for `TRUSTED_PROJECT_SERVICE_KEYS`).
export { PROJECT_CONFIG_CANDIDATES, findExistingProjectConfig, resolveProjectConfigPath } from './projectConfigPath'

/**
 * Resolve the on-disk path for a `coco config` write scope (#1605).
 *
 * - `global` is always the XDG config (`~/.config/coco/config.json`) — the
 *   same JSON file `telemetry.usage` already persists to. `coco init`'s
 *   global scope instead writes `~/.gitconfig` in INI form; `coco config`
 *   deliberately targets the JSON file instead so get/set/unset don't have
 *   to round-trip INI syntax. Both are read by `loadConfig`, so either is a
 *   valid place to keep global settings.
 * - `project` prefers an existing `.coco.json` / `.coco.config.json` (in
 *   that order); if neither exists yet, defaults to creating `.coco.json`.
 */
export function resolveScopedConfigPath(scope: ConfigWriteScope): string {
  if (scope === 'global') {
    return getXdgConfigPath()
  }

  return resolveProjectConfigPath(resolveGitRepoRoot())
}

/** Reads and parses a scoped config file. Returns `{}` if it doesn't exist. */
export function readScopedConfigFile(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) {
    return {}
  }

  const raw = fs.readFileSync(filePath, 'utf-8')
  if (!raw.trim()) return {}

  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${filePath} does not contain a JSON object at its root.`)
  }

  return parsed as Record<string, unknown>
}

/** Writes a scoped config object back to disk as pretty-printed JSON with a `$schema` pointer. */
export function writeScopedConfigFile(filePath: string, config: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { $schema, ...rest } = config
  fs.writeFileSync(
    filePath,
    JSON.stringify({ $schema: SCHEMA_PUBLIC_URL, ...rest }, null, 2) + '\n'
  )
}

/**
 * A repo-committed project config is untrusted (see
 * `TRUSTED_PROJECT_SERVICE_KEYS` in `services/project.ts`): only tuning
 * knobs under `service.*` may be set there, never anything that decides
 * where a request goes or what credentials it carries. Top-level keys
 * (`defaultBranch`, `conventionalCommits`, `logTui.*`, ...) are unrestricted.
 * Returns an error message when the key is rejected, or undefined when
 * it's allowed.
 */
export function checkProjectScopeKeyTrust(key: string): string | undefined {
  if (!key.startsWith('service.')) return undefined

  const serviceKey = key.slice('service.'.length).split('.')[0]
  if ((TRUSTED_PROJECT_SERVICE_KEYS as readonly string[]).includes(serviceKey)) {
    return undefined
  }

  return (
    `"${key}" can't be set in a repo-committed project config — it can decide where your ` +
    `requests go or what credentials they carry, and a repo-local file is untrusted content ` +
    `(anyone who can get you to clone the repo controls it). Set it via \`coco config ${key} <value> --scope global\`, ` +
    `\`~/.gitconfig\`, or an environment variable instead.`
  )
}
