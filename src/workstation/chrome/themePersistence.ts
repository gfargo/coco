import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { writeFileAtomic } from '../../lib/utils/atomicFileWrite'
import { getLogInkThemePresets, type LogInkThemePreset } from './theme'

/**
 * Persist the user's chosen `coco ui` theme preset to the global XDG
 * config (`$XDG_CONFIG_HOME/coco/config.json`, default `~/.config/...`),
 * so a theme picked in the workstation sticks across every repo and
 * launch. This is the same file `loadXDGConfig` reads.
 *
 * Read-modify-write that preserves every other key (we only touch
 * `logTui.theme.preset`), unlike the whole-object project-config writer.
 * Best-effort: a read-only HOME or malformed file never throws — the
 * picker still applies the theme for the session.
 */

const VALID_PRESETS = new Set<string>(getLogInkThemePresets())

export function getXdgConfigPath(): string {
  const home = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
  return path.join(home, 'coco', 'config.json')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Write `logTui.theme.preset = <preset>` into the global config, merging
 * into any existing content. Returns `true` on success, `false` if the
 * preset is unknown or the write failed (caller treats failure as
 * "applied for this session only").
 */
export function saveThemePreset(preset: LogInkThemePreset): boolean {
  if (!VALID_PRESETS.has(preset)) {
    return false
  }
  const file = getXdgConfigPath()
  try {
    let config: Record<string, unknown> = {}
    if (fs.existsSync(file)) {
      // The file exists: it must parse as an object before we merge into
      // it. Treating a malformed file (hand-edit with a trailing comma,
      // truncated write) as "start fresh" silently ERASED every other
      // setting the user had — abort instead; the theme still applies
      // for the session.
      let parsed: unknown
      try {
        parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
      } catch {
        return false
      }
      if (!isRecord(parsed)) {
        return false
      }
      config = parsed
    }

    const logTui = isRecord(config.logTui) ? config.logTui : {}
    const theme = isRecord(logTui.theme) ? logTui.theme : {}
    config.logTui = { ...logTui, theme: { ...theme, preset } }

    fs.mkdirSync(path.dirname(file), { recursive: true })
    // tmp+rename so a crash mid-write can't leave a truncated config.
    writeFileAtomic(file, `${JSON.stringify(config, null, 2)}\n`)
    return true
  } catch {
    return false
  }
}

/**
 * Read back the persisted preset (used by tests and any caller that
 * wants to reflect the saved value). Returns `undefined` when nothing
 * valid is stored.
 */
export function getSavedThemePreset(): LogInkThemePreset | undefined {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(getXdgConfigPath(), 'utf8'))
    if (!isRecord(parsed)) return undefined
    const logTui = isRecord(parsed.logTui) ? parsed.logTui : undefined
    const theme = logTui && isRecord(logTui.theme) ? logTui.theme : undefined
    const preset = theme?.preset
    return typeof preset === 'string' && VALID_PRESETS.has(preset)
      ? (preset as LogInkThemePreset)
      : undefined
  } catch {
    return undefined
  }
}
