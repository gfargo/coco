/**
 * Resolve + scaffold the coco config files the workstation can open in
 * `$EDITOR` (the `gk` / `gK` chords and their command-palette entries).
 *
 * Two scopes:
 *   - `global`  → `$XDG_CONFIG_HOME/coco/config.json` (default
 *                 `~/.config/coco/config.json`) — applies to every repo.
 *   - `project` → `.coco.json` (preferred) or the legacy
 *                 `.coco.config.json` at the repo root — applies to the
 *                 current repository only.
 *
 * When the chosen file doesn't exist yet we write a minimal templated
 * starter (just the `$schema` link + a sample `logTui.theme.preset`) so
 * the user lands in an editable, schema-aware file instead of an empty
 * buffer or an error.
 */
import * as fs from 'fs'
import * as path from 'path'
import { SCHEMA_PUBLIC_URL } from '../../lib/schema'
import { getXdgConfigPath } from '../chrome/themePersistence'

export type CocoConfigScope = 'global' | 'project'

/**
 * Minimal starter config written when scaffolding a missing file. Keeps
 * the `$schema` link (so editors offer completion/validation) and one
 * illustrative key showing where settings live — small enough to not
 * impose opinions, structured enough to be a useful starting point.
 */
const STARTER_CONFIG = `${JSON.stringify(
  {
    $schema: SCHEMA_PUBLIC_URL,
    logTui: { theme: { preset: 'default' } },
  },
  null,
  2
)}\n`

/** `$XDG_CONFIG_HOME/coco/config.json` (default `~/.config/coco/config.json`). */
export function getGlobalConfigPath(): string {
  return getXdgConfigPath()
}

/**
 * The project config path for `repoRoot`: the first existing of
 * `.coco.json` / `.coco.config.json`, else `.coco.json` as the default
 * to create.
 */
export function getProjectConfigPath(repoRoot: string): string {
  for (const name of ['.coco.json', '.coco.config.json']) {
    const candidate = path.join(repoRoot, name)
    if (fs.existsSync(candidate)) return candidate
  }
  return path.join(repoRoot, '.coco.json')
}

/** Resolve the config path for a scope. `project` needs the repo root. */
export function resolveConfigPath(scope: CocoConfigScope, repoRoot: string): string {
  return scope === 'global' ? getGlobalConfigPath() : getProjectConfigPath(repoRoot)
}

/**
 * Ensure `filePath` exists, scaffolding the starter template (and any
 * missing parent directories) when it doesn't. Returns whether it was
 * just created so the caller can surface a "Created …" message.
 */
export function ensureConfigFile(filePath: string): { created: boolean } {
  if (fs.existsSync(filePath)) {
    return { created: false }
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, STARTER_CONFIG)
  return { created: true }
}
