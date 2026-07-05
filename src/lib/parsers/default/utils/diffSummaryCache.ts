import { execFileSync } from 'node:child_process'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

/**
 * Per-repo disk cache of LLM-summarized diffs (#845, PR 5). On a
 * re-run of `coco commit` after a small change, most files have
 * unchanged content and unchanged diffs — caching their summaries
 * by content hash means the second run skips the LLM entirely for
 * those files and only pays for what's actually different.
 *
 * Strict best-effort: read failures fall back to "no cache" (the
 * pipeline runs the LLM as before), and write failures are
 * swallowed silently. The cache is never load-bearing.
 *
 * Repos are keyed by a short hash of their absolute path — the git
 * toplevel, not `process.cwd()` (#1463), so `coco commit` run from a
 * subdirectory hits the same cache file as a run from the repo root.
 * No PII in the cache filename, and re-creating a repo at the same
 * path keeps the same cache.
 *
 * Cache key: `sha256(diff + ':' + model + ':' + promptHash)`.
 *   - diff: the literal diff text being summarized
 *   - model: switching models invalidates (different summaries)
 *   - promptHash: editing the SUMMARIZE_PROMPT template invalidates
 *
 * Cap: 500 entries per repo. LRU eviction on overflow keeps the
 * cache file under ~500 KB on a typical repo (each entry is a
 * sha256 hash + 200-500-byte summary).
 */

const CACHE_SCHEMA_VERSION = 1
const CACHE_DIR_NAME = 'diff-summaries'
const CACHE_ENTRY_HARD_CAP = 500

export type DiffSummaryCacheEntry = {
  summary: string
  model: string
  tokens: number
  /** ISO timestamp; drives LRU eviction. */
  lastAccessedAt: string
}

type CacheEnvelope = {
  version: number
  savedAt: string
  entries: Record<string, DiffSummaryCacheEntry>
}

function resolveCacheDir(): string {
  const xdg = process.env.XDG_CACHE_HOME
  if (xdg && xdg.trim().length > 0) {
    return path.join(xdg, 'coco', CACHE_DIR_NAME)
  }
  return path.join(os.homedir(), '.cache', 'coco', CACHE_DIR_NAME)
}

function repoKey(repoPath: string): string {
  // sha256 here is a non-security cache-key derivation — deterministic
  // short identifier for the cache filename so two repos at different
  // paths never collide. We truncate to 16 chars; collision-resistance
  // against an adversary is not required.
  return crypto.createHash('sha256').update(repoPath).digest('hex').slice(0, 16)
}

export function getDiffSummaryCachePath(repoPath: string): string {
  return path.join(resolveCacheDir(), `summaries.${repoKey(repoPath)}.json`)
}

let cachedRepoRoot: { cwd: string; root: string } | undefined

/**
 * Resolve the repo identity used as the cache key: the git toplevel
 * for `cwd`, not `cwd` itself (#1463). `coco commit` run from a
 * subdirectory previously produced a different cache file than a run
 * from the repo root, so cache hits were missed depending on
 * invocation directory. Falls back to `cwd` when it isn't inside a
 * git repo (or `git` isn't available) so the cache still has a stable
 * identity. Memoized per `cwd` since it can't change mid-process.
 */
export function resolveDiffSummaryCacheRepoPath(cwd: string = process.cwd()): string {
  if (cachedRepoRoot?.cwd === cwd) return cachedRepoRoot.root

  let root = cwd
  try {
    const toplevel = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (toplevel) {
      // git always prints forward-slash paths, even on Windows, so
      // normalize through realpathSync.native to get a native-separator,
      // fully canonical form. Windows resolves a child process's cwd to
      // its long-name form internally (even if a short 8.3 name like
      // `RUNNER~1` was passed in), so git's output is already long-form;
      // realpathSync.native (unlike plain realpathSync) also expands any
      // remaining short-name segments, keeping this in sync with however
      // the caller's cwd was spelled.
      try {
        root = fs.realpathSync.native(toplevel)
      } catch {
        root = toplevel
      }
    }
  } catch {
    // Not a git repo, or git unavailable — fall back to cwd.
  }

  cachedRepoRoot = { cwd, root }
  return root
}

/**
 * Build the cache key for a (diff, model, prompt) tuple. sha256
 * because we want a strong content-hash; the per-entry storage cost
 * is dominated by the summary text anyway.
 */
export function diffSummaryKey(diff: string, model: string, promptHash: string): string {
  return crypto
    .createHash('sha256')
    .update(`${diff}\x1f${model}\x1f${promptHash}`)
    .digest('hex')
}

function readEnvelope(filePath: string): CacheEnvelope | undefined {
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(raw) as CacheEnvelope
    if (parsed.version !== CACHE_SCHEMA_VERSION) return undefined
    if (!parsed.entries || typeof parsed.entries !== 'object') return undefined
    return parsed
  } catch {
    return undefined
  }
}

export function readDiffSummary(
  repoPath: string,
  key: string
): DiffSummaryCacheEntry | undefined {
  const envelope = readEnvelope(getDiffSummaryCachePath(repoPath))
  if (!envelope) return undefined
  const entry = envelope.entries[key]
  if (!entry) return undefined
  return entry
}

export function writeDiffSummary(
  repoPath: string,
  key: string,
  entry: Omit<DiffSummaryCacheEntry, 'lastAccessedAt'>
): void {
  const filePath = getDiffSummaryCachePath(repoPath)
  const existing = readEnvelope(filePath) || {
    version: CACHE_SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    entries: {},
  }
  existing.entries[key] = { ...entry, lastAccessedAt: new Date().toISOString() }
  existing.savedAt = new Date().toISOString()

  const evictedEntries = enforceHardCap(existing.entries)
  if (evictedEntries.length > 0) {
    for (const evicted of evictedEntries) {
      delete existing.entries[evicted]
    }
  }

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, JSON.stringify(existing))
  } catch {
    // Best-effort persistence; swallow.
  }
}

/**
 * Touch an existing entry's lastAccessedAt so LRU eviction prefers
 * dropping older / unused entries. Caller is expected to know the
 * entry exists (read returned a hit).
 */
export function touchDiffSummary(repoPath: string, key: string): void {
  const filePath = getDiffSummaryCachePath(repoPath)
  const envelope = readEnvelope(filePath)
  if (!envelope || !envelope.entries[key]) return
  envelope.entries[key] = {
    ...envelope.entries[key],
    lastAccessedAt: new Date().toISOString(),
  }
  envelope.savedAt = new Date().toISOString()
  try {
    fs.writeFileSync(filePath, JSON.stringify(envelope))
  } catch {
    // Swallow.
  }
}

function enforceHardCap(entries: Record<string, DiffSummaryCacheEntry>): string[] {
  const keys = Object.keys(entries)
  if (keys.length <= CACHE_ENTRY_HARD_CAP) return []
  // Sort by lastAccessedAt ascending (oldest first), drop the
  // oldest (keys.length - CACHE_ENTRY_HARD_CAP) entries.
  const sorted = keys
    .map((key) => ({ key, accessed: Date.parse(entries[key].lastAccessedAt) || 0 }))
    .sort((a, b) => a.accessed - b.accessed)
  const toEvict = sorted.slice(0, keys.length - CACHE_ENTRY_HARD_CAP).map((entry) => entry.key)
  return toEvict
}

/** Remove the entire cache file for the repo. Used by `coco cache:clear`. */
export function clearDiffSummaryCache(repoPath: string): { ok: boolean; removed: boolean } {
  const filePath = getDiffSummaryCachePath(repoPath)
  if (!fs.existsSync(filePath)) {
    return { ok: true, removed: false }
  }
  try {
    fs.unlinkSync(filePath)
    return { ok: true, removed: true }
  } catch {
    return { ok: false, removed: false }
  }
}

export const __testInternals = { CACHE_ENTRY_HARD_CAP, enforceHardCap }
