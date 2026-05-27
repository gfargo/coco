import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { WorkspaceOverview } from '../../git/workspaceData'

/**
 * Disk cache of the most recent workspace overview (#880). Discovery
 * walks every configured root, which can take a noticeable amount of
 * time on machines with many sibling repos and cold filesystem cache.
 * On subsequent boots the workspace surface paints from this cache
 * immediately and then refreshes in the background, mirroring the
 * three-stage boot the `coco ui` command already uses for commits
 * (see `overviewCache.ts`).
 *
 * Best-effort: read failures silently fall back to "no cache" and
 * write failures are swallowed.
 *
 * The cache is keyed by a hash of the sorted root list — different
 * `workspace.roots` configurations don't collide and don't poison
 * each other's caches when the user toggles between two setups.
 */

const CACHE_SCHEMA_VERSION = 1
const CACHE_DIR_NAME = 'workspace'

type CacheEnvelope = {
  version: number
  savedAt: string
  overview: WorkspaceOverview
}

function resolveCacheDir(): string {
  const xdg = process.env.XDG_CACHE_HOME
  if (xdg && xdg.trim().length > 0) {
    return path.join(xdg, 'coco', CACHE_DIR_NAME)
  }
  return path.join(os.homedir(), '.cache', 'coco', CACHE_DIR_NAME)
}

export function workspaceCacheKey(roots: ReadonlyArray<string>): string {
  const normalized = [...roots].map((entry) => entry.trim()).filter(Boolean).sort()
  // sha1 here is a non-security cache-key derivation. DevSkim DS126858
  // does not apply.
  // DevSkim: ignore DS126858
  return crypto.createHash('sha1').update(normalized.join('\n')).digest('hex').slice(0, 16)
}

export function getWorkspaceCachePath(roots: ReadonlyArray<string>): string {
  return path.join(resolveCacheDir(), `overview.${workspaceCacheKey(roots)}.json`)
}

export function readCachedWorkspace(
  roots: ReadonlyArray<string>
): WorkspaceOverview | undefined {
  try {
    const raw = fs.readFileSync(getWorkspaceCachePath(roots), 'utf8')
    const parsed = JSON.parse(raw) as CacheEnvelope
    if (parsed.version !== CACHE_SCHEMA_VERSION) {
      return undefined
    }
    if (!parsed.overview || !Array.isArray(parsed.overview.repos)) {
      return undefined
    }
    return parsed.overview
  } catch {
    return undefined
  }
}

export function writeCachedWorkspace(
  roots: ReadonlyArray<string>,
  overview: WorkspaceOverview
): void {
  const file = getWorkspaceCachePath(roots)
  const envelope: CacheEnvelope = {
    version: CACHE_SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    overview,
  }
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(envelope))
  } catch {
    // Best-effort persistence; swallow.
  }
}
