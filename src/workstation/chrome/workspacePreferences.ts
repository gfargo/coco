import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import {
  WORKSPACE_SORT_MODES,
  type WorkspaceSortMode,
} from '../surfaces/workspace/sort'
import {
  WORKSPACE_TABS,
  type WorkspaceTab,
} from '../surfaces/workspace/filter'

/**
 * Persist sort mode, sidebar tab, and filter text between
 * `coco workspace` launches. Keyed per root set so two different
 * configured root lists keep separate preferences. Mirrors the
 * existing `chrome/sidebarPersistence.ts` pattern.
 *
 * Best-effort: read/write failures fall back to defaults so a stale
 * file or sandboxed FS never blocks boot.
 */

const SCHEMA_VERSION = 1
const STORE_DIR_NAME = 'workspace'

export type WorkspacePreferences = {
  sortMode?: WorkspaceSortMode
  tab?: WorkspaceTab
  filter?: string
}

type Envelope = {
  version: number
  savedAt: string
  preferences: WorkspacePreferences
}

function resolveCacheDir(): string {
  const xdg = process.env.XDG_CACHE_HOME
  if (xdg && xdg.trim().length > 0) {
    return path.join(xdg, 'coco', STORE_DIR_NAME)
  }
  return path.join(os.homedir(), '.cache', 'coco', STORE_DIR_NAME)
}

export function workspacePreferencesKey(roots: ReadonlyArray<string>): string {
  const normalized = [...roots].map((entry) => entry.trim()).filter(Boolean).sort()
  return crypto.createHash('sha1').update(normalized.join('\n')).digest('hex').slice(0, 16) // DevSkim: ignore DS126858
}

export function getWorkspacePreferencesPath(roots: ReadonlyArray<string>): string {
  return path.join(resolveCacheDir(), `preferences.${workspacePreferencesKey(roots)}.json`)
}

function isValidSortMode(value: unknown): value is WorkspaceSortMode {
  return typeof value === 'string' && (WORKSPACE_SORT_MODES as ReadonlyArray<string>).includes(value)
}

function isValidTab(value: unknown): value is WorkspaceTab {
  return typeof value === 'string' && (WORKSPACE_TABS as ReadonlyArray<string>).includes(value)
}

export function readWorkspacePreferences(roots: ReadonlyArray<string>): WorkspacePreferences {
  try {
    const raw = fs.readFileSync(getWorkspacePreferencesPath(roots), 'utf8')
    const parsed = JSON.parse(raw) as Envelope
    if (parsed.version !== SCHEMA_VERSION) {
      return {}
    }
    const prefs = parsed.preferences ?? {}
    const validated: WorkspacePreferences = {}
    if (isValidSortMode(prefs.sortMode)) {
      validated.sortMode = prefs.sortMode
    }
    if (isValidTab(prefs.tab)) {
      validated.tab = prefs.tab
    }
    if (typeof prefs.filter === 'string') {
      validated.filter = prefs.filter
    }
    return validated
  } catch {
    return {}
  }
}

export function writeWorkspacePreferences(
  roots: ReadonlyArray<string>,
  preferences: WorkspacePreferences
): void {
  const envelope: Envelope = {
    version: SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    preferences,
  }
  const file = getWorkspacePreferencesPath(roots)
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(envelope, null, 2))
  } catch {
    // Best-effort persistence.
  }
}
