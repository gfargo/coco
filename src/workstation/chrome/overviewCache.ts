import * as fs from 'node:fs'
import * as path from 'node:path'

import { GitLogRow } from '../../git/logData'
import { writeFileAtomic } from '../../lib/utils/atomicFileWrite'
import { cacheKeyHash, getCocoCacheDir } from '../../lib/utils/cocoPaths'

/**
 * Per-repo disk cache of the last successful commit-log fetch (#808).
 * Lets the TUI render an immediate stale-but-useful history view on
 * subsequent boots while the fresh `git log` runs in the background;
 * once the fresh data lands the runtime swaps it in transparently.
 *
 * Strict best-effort: read failures fall back to "no cache" (boot
 * shows the loading placeholder), and write failures are swallowed
 * silently (next boot just doesn't have the cache yet). The cache is
 * never load-bearing.
 *
 * Repos are keyed by a short hash of their absolute path. No PII in
 * the cache filename, and re-creating a repo at the same path keeps
 * the same cache.
 */

const CACHE_SCHEMA_VERSION = 1
const CACHE_DIR_NAME = 'overview'

/**
 * Hard cap on rows we'll write per cache entry. The interactive
 * default limit is 300; this caps growth in case a user opts into a
 * much larger window. Keeps the cache file under ~200kb on a typical
 * repo.
 */
const CACHE_ROW_HARD_CAP = 500

type CacheEnvelope = {
  version: number
  savedAt: string
  rows: GitLogRow[]
}

export function getOverviewCachePath(repoPath: string): string {
  return path.join(getCocoCacheDir(CACHE_DIR_NAME), `commits.${cacheKeyHash(repoPath)}.json`)
}

export function readCachedCommits(repoPath: string): GitLogRow[] | undefined {
  try {
    const raw = fs.readFileSync(getOverviewCachePath(repoPath), 'utf8')
    const parsed = JSON.parse(raw) as CacheEnvelope
    if (parsed.version !== CACHE_SCHEMA_VERSION) {
      // Schema mismatch — quietly drop the stale entry on next write.
      // Treating it as "no cache" keeps boot behavior predictable
      // across upgrades.
      return undefined
    }
    if (!Array.isArray(parsed.rows)) {
      return undefined
    }
    return parsed.rows
  } catch {
    return undefined
  }
}

export function writeCachedCommits(repoPath: string, rows: GitLogRow[]): void {
  const file = getOverviewCachePath(repoPath)
  const envelope: CacheEnvelope = {
    version: CACHE_SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    rows: rows.slice(0, CACHE_ROW_HARD_CAP),
  }
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    // tmp+rename so a crash mid-write can't leave truncated JSON (the
    // read path would silently treat it as "no cache"). Random-suffixed
    // 0600/O_EXCL tmp keeps concurrent coco instances off each other's
    // tmp file and closes the predictable-path TOCTOU window.
    writeFileAtomic(file, JSON.stringify(envelope))
  } catch {
    // Best-effort persistence; swallow.
  }
}
