import * as fs from 'fs'
import * as path from 'path'
import { getXdgConfigPath } from '../services/xdg'
import { TRUSTED_PROJECT_SERVICE_KEYS } from '../services/project'
import { resolveGitRepoRoot } from '../../utils/resolveGitRepoRoot'
import { SCHEMA_PUBLIC_URL } from '../../schema'

export type ConfigWriteScope = 'global' | 'project'

/**
 * The filenames coco looks for when resolving a project-scoped config,
 * in priority order. Exported so callers that need the raw list (the
 * workstation's editor-open flow, `coco init`) don't have to hardcode
 * their own copy (#1731).
 */
export const PROJECT_CONFIG_CANDIDATES = ['.coco.json', '.coco.config.json'] as const

/**
 * Resolve the project config path for a given repo root: the first
 * existing candidate file, or the preferred default (`.coco.json`) when
 * none exists yet. Exported as the single source of truth for the
 * candidate-walk logic previously duplicated in 4 places (#1731).
 */
export function resolveProjectConfigPath(repoRoot: string): string {
  for (const candidate of PROJECT_CONFIG_CANDIDATES) {
    const candidatePath = path.join(repoRoot, candidate)
    if (fs.existsSync(candidatePath)) {
      return candidatePath
    }
  }
  return path.join(repoRoot, PROJECT_CONFIG_CANDIDATES[0])
}

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
