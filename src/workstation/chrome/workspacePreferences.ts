import * as crypto from 'node:crypto'

import { canonicalize } from '../../git/workspaceData'
import {
  WORKSPACE_SORT_MODES,
  type WorkspaceSortMode,
} from '../surfaces/workspace/sort'
import {
  WORKSPACE_TABS,
  type WorkspaceTab,
} from '../surfaces/workspace/filter'

import { createJsonStore } from './jsonStore'

/**
 * Persist sort mode, sidebar tab, and filter text between
 * `coco workspace` launches. Keyed per root set so two different
 * configured root lists keep separate preferences. Mirrors the
 * existing `chrome/sidebarPersistence.ts` pattern.
 *
 * Persistence is delegated to `jsonStore.ts`. Stale files (schema
 * mismatch, invalid sort/tab values) read as `{}` so a corrupt
 * preferences file never blocks boot.
 */

const SCHEMA_VERSION = 1

export type WorkspacePreferences = {
  sortMode?: WorkspaceSortMode
  tab?: WorkspaceTab
  filter?: string
}

function isValidSortMode(value: unknown): value is WorkspaceSortMode {
  return typeof value === 'string' && (WORKSPACE_SORT_MODES as ReadonlyArray<string>).includes(value)
}

function isValidTab(value: unknown): value is WorkspaceTab {
  return typeof value === 'string' && (WORKSPACE_TABS as ReadonlyArray<string>).includes(value)
}

const store = createJsonStore<WorkspacePreferences>({
  subdir: 'workspace',
  basename: (key) => `preferences.${key}.json`,
  version: SCHEMA_VERSION,
  // Legacy envelopes used `preferences` as the payload field.
  payloadField: 'preferences',
  validate: (raw) => {
    if (!raw || typeof raw !== 'object') return undefined
    const source = raw as WorkspacePreferences
    const result: WorkspacePreferences = {}
    if (isValidSortMode(source.sortMode)) result.sortMode = source.sortMode
    if (isValidTab(source.tab)) result.tab = source.tab
    if (typeof source.filter === 'string') result.filter = source.filter
    return result
  },
})

export function workspacePreferencesKey(roots: ReadonlyArray<string>): string {
  // Canonicalize before hashing (mirrors `workspaceCacheKey`): two
  // spellings of one directory must share preferences, and two
  // different directories launched with the same relative `--root`
  // must NOT cross-pollinate sort/tab/filter.
  const normalized = [...roots]
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => canonicalize(entry))
    .sort()
  return crypto.createHash('sha1').update(normalized.join('\n')).digest('hex').slice(0, 16) // DevSkim: ignore DS126858
}

export function getWorkspacePreferencesPath(roots: ReadonlyArray<string>): string {
  return store.path(workspacePreferencesKey(roots))
}

export function readWorkspacePreferences(roots: ReadonlyArray<string>): WorkspacePreferences {
  return store.read(workspacePreferencesKey(roots)) ?? {}
}

export function writeWorkspacePreferences(
  roots: ReadonlyArray<string>,
  preferences: WorkspacePreferences
): void {
  store.write(preferences, workspacePreferencesKey(roots))
}
