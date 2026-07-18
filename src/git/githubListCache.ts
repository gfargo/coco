import * as fs from 'node:fs'
import * as path from 'node:path'

import type { IssueListItem, IssueListFilter } from './issuesListData'
import type {
  PullRequestListItem,
  PullRequestListFilter,
} from './pullRequestListData'
import { cacheKeyHash, getCocoCacheDir } from '../lib/utils/cocoPaths'

/**
 * Disk-backed cache for `coco issues` / `coco prs` list fetches
 * (#882 phase 2). Triage is bursty — a user runs `coco issues` a
 * dozen times in a few minutes, then doesn't touch it for hours —
 * so a short TTL (default 5 minutes) buys a lot of latency back
 * without serving stale data outside that window.
 *
 * Best-effort, same as `overviewCache.ts`: read failures fall back
 * to "no cache" (the fetcher does a fresh `gh` call), write failures
 * are swallowed silently (next call just re-fetches). The cache is
 * never load-bearing — `gh` is always the source of truth.
 *
 * Keying: `{kind}.{repoHash}.{filterHash}.json` where:
 *   - `kind` is `'issues'` or `'prs'` so the two surfaces don't
 *     collide.
 *   - `repoHash` is a stable short hash of the absolute repo path
 *     (same scheme as `overviewCache.ts`).
 *   - `filterHash` is a stable short hash of the canonicalized
 *     filter object so different `--state` / `--assignee` / `--label`
 *     combinations cache independently.
 *
 * No PII in filenames; no auth context is hashed; no
 * collision-resistance against an adversary is required.
 */

export const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000

const CACHE_SCHEMA_VERSION = 1
const CACHE_DIR_NAME = 'github'

export type GitHubListCacheKind = 'issues' | 'prs'

export type CachedIssueList = {
  kind: 'issues'
  items: IssueListItem[]
}

export type CachedPullRequestList = {
  kind: 'prs'
  items: PullRequestListItem[]
}

export type CachedList = CachedIssueList | CachedPullRequestList

type CacheEnvelope<T extends CachedList> = {
  version: number
  savedAt: string
  payload: T
}

export type CacheReadResult<T extends CachedList> = {
  payload: T
  savedAt: Date
  ageMs: number
  fresh: boolean
}

/**
 * Canonicalize the filter object into a stable string before hashing.
 * Sorts keys + drops undefined entries so equivalent filters
 * (`{state: 'open'}` and `{state: 'open', limit: undefined}`) hash to
 * the same key and share cached data.
 */
export function canonicalizeFilter(
  filter: IssueListFilter | PullRequestListFilter
): string {
  const entries = Object.entries(filter)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .sort(([a], [b]) => a.localeCompare(b))
  return JSON.stringify(entries)
}

export function getCachePath(
  kind: GitHubListCacheKind,
  repoPath: string,
  filter: IssueListFilter | PullRequestListFilter
): string {
  const repoHash = cacheKeyHash(repoPath)
  const filterHash = cacheKeyHash(canonicalizeFilter(filter))
  return path.join(getCocoCacheDir(CACHE_DIR_NAME), `${kind}.${repoHash}.${filterHash}.json`)
}

export function readCachedList<T extends CachedList>(
  kind: T['kind'],
  repoPath: string,
  filter: IssueListFilter | PullRequestListFilter,
  ttlMs: number = DEFAULT_CACHE_TTL_MS
): CacheReadResult<T> | undefined {
  try {
    const raw = fs.readFileSync(getCachePath(kind, repoPath, filter), 'utf8')
    const parsed = JSON.parse(raw) as CacheEnvelope<T>

    if (parsed.version !== CACHE_SCHEMA_VERSION) return undefined
    if (!parsed.payload || parsed.payload.kind !== kind) return undefined
    if (!Array.isArray((parsed.payload as CachedList).items)) return undefined

    const savedAt = new Date(parsed.savedAt)
    if (Number.isNaN(savedAt.getTime())) return undefined

    const ageMs = Date.now() - savedAt.getTime()
    return {
      payload: parsed.payload,
      savedAt,
      ageMs,
      fresh: ageMs < ttlMs,
    }
  } catch {
    return undefined
  }
}

export function writeCachedList<T extends CachedList>(
  repoPath: string,
  filter: IssueListFilter | PullRequestListFilter,
  payload: T
): void {
  const file = getCachePath(payload.kind, repoPath, filter)
  const envelope: CacheEnvelope<T> = {
    version: CACHE_SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    payload,
  }
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(envelope))
  } catch {
    // Best-effort persistence; swallow.
  }
}

/**
 * Drop every cached file under the github cache directory. Used by
 * `--no-cache` / explicit purge commands. Best-effort: ENOENT on a
 * never-populated cache directory is treated as success.
 */
export function clearGitHubListCache(): { removed: number } {
  const dir = getCocoCacheDir(CACHE_DIR_NAME)
  let removed = 0
  try {
    const entries = fs.readdirSync(dir)
    for (const entry of entries) {
      try {
        fs.unlinkSync(path.join(dir, entry))
        removed++
      } catch {
        // Skip individual file failures; keep counting the rest.
      }
    }
  } catch {
    // Directory missing → nothing to clear, treat as success.
  }
  return { removed }
}
