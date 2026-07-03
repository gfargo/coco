import * as crypto from 'node:crypto'

import { canonicalize, WorkspaceOverview } from '../../git/workspaceData'

import { createJsonStore } from './jsonStore'

/**
 * Disk cache of the most recent workspace overview (#880). Discovery
 * walks every configured root, which can take a noticeable amount of
 * time on machines with many sibling repos and cold filesystem cache.
 * On subsequent boots the workspace surface paints from this cache
 * immediately and then refreshes in the background, mirroring the
 * three-stage boot the `coco ui` command already uses for commits
 * (see `overviewCache.ts`).
 *
 * Persistence is delegated to `jsonStore.ts`. The cache is keyed by
 * a hash of the sorted root list — different `workspace.roots`
 * configurations don't collide and don't poison each other's caches
 * when the user toggles between two setups.
 */

const CACHE_SCHEMA_VERSION = 1

export function workspaceCacheKey(roots: ReadonlyArray<string>): string {
  // Canonicalize before hashing: roots arrive as typed (`--root ./code`,
  // `~/code`, config strings). Hashing the raw spelling split one
  // directory's cache across spellings AND collided different
  // directories launched with the same relative `--root` — boot then
  // painted the OTHER workspace's cached repo list until discovery
  // corrected it.
  const normalized = [...roots]
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => canonicalize(entry))
    .sort()
  // sha1 here is a non-security cache-key derivation. DevSkim DS126858
  // does not apply.
  return crypto.createHash('sha1').update(normalized.join('\n')).digest('hex').slice(0, 16) // DevSkim: ignore DS126858
}

const store = createJsonStore<WorkspaceOverview>({
  subdir: 'workspace',
  basename: (key) => `overview.${key}.json`,
  version: CACHE_SCHEMA_VERSION,
  // Legacy envelopes used `overview` as the payload field; preserve
  // it so files written by previous coco versions remain readable.
  payloadField: 'overview',
  format: 'compact',
  validate: (raw) =>
    raw && Array.isArray((raw as { repos?: unknown }).repos)
      ? (raw as WorkspaceOverview)
      : undefined,
})

export function getWorkspaceCachePath(roots: ReadonlyArray<string>): string {
  return store.path(workspaceCacheKey(roots))
}

export function readCachedWorkspace(
  roots: ReadonlyArray<string>
): WorkspaceOverview | undefined {
  return store.read(workspaceCacheKey(roots))
}

export function writeCachedWorkspace(
  roots: ReadonlyArray<string>,
  overview: WorkspaceOverview
): void {
  store.write(overview, workspaceCacheKey(roots))
}
