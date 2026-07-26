import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { resolveGitRepoRoot } from '../../../utils/resolveGitRepoRoot'
import { getCocoCacheDir } from '../../../utils/cocoPaths'
import { writeFileAtomic } from '../../../utils/atomicFileWrite'

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

function repoKey(repoPath: string): string {
  // sha256 here is a non-security cache-key derivation — deterministic
  // short identifier for the cache filename so two repos at different
  // paths never collide. We truncate to 16 chars; collision-resistance
  // against an adversary is not required.
  return crypto.createHash('sha256').update(repoPath).digest('hex').slice(0, 16)
}

export function getDiffSummaryCachePath(repoPath: string): string {
  return path.join(getCocoCacheDir(CACHE_DIR_NAME), `summaries.${repoKey(repoPath)}.json`)
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

  const root = resolveGitRepoRoot(cwd)
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

/**
 * In-memory envelope cache, keyed by cache file path (#1923). Each
 * envelope is loaded from disk at most once per process and mutated
 * in place thereafter; `writeDiffSummary`/`touchDiffSummary` used to
 * pay a full parse+stringify+write of the whole file on every call,
 * which meant every cache *hit* (touch) and every cache *write*
 * rewrote the entire 500-entry file synchronously on the hot path.
 * Dirty envelopes are flushed once via `flushDiffSummaryCache`,
 * installed to run on process exit/signal.
 */
const envelopes = new Map<string, CacheEnvelope>()
const dirtyPaths = new Set<string>()
let flushHandlersInstalled = false

function getEnvelope(filePath: string): CacheEnvelope {
  const cached = envelopes.get(filePath)
  if (cached) return cached
  const loaded = readEnvelope(filePath) || {
    version: CACHE_SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    entries: {},
  }
  envelopes.set(filePath, loaded)
  return loaded
}

/**
 * Flush every dirty in-memory envelope to disk, atomically. Installed
 * as an exit/signal handler (best-effort, swallowed) so a normal
 * process end persists the process-lifetime cache exactly once,
 * instead of on every write/touch.
 */
export function flushDiffSummaryCache(): void {
  for (const filePath of dirtyPaths) {
    const envelope = envelopes.get(filePath)
    if (!envelope) continue
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      writeFileAtomic(filePath, JSON.stringify(envelope))
    } catch {
      // Best-effort persistence; swallow.
    }
  }
  dirtyPaths.clear()
}

/**
 * Flush then re-raise the signal so Node's default "terminate
 * immediately" disposition still applies. `writeDiffSummary`/
 * `touchDiffSummary` run on the ordinary `coco commit`/`coco pr`
 * path, not just long-lived `coco ui` — a signal handler that only
 * flushes (and never exits) would silently remove Ctrl+C's ability
 * to kill the process while an LLM request is in flight (#1923
 * review). Removing our own listener before re-sending the signal
 * lets Node apply the default action (or any other registered
 * handler) exactly as if we were never here.
 */
function handleTerminationSignal(signal: NodeJS.Signals): void {
  flushDiffSummaryCache()
  process.removeListener(signal, handleTerminationSignal)
  process.kill(process.pid, signal)
}

function installFlushHandlers(): void {
  if (flushHandlersInstalled) return
  flushHandlersInstalled = true
  process.on('exit', flushDiffSummaryCache)
  process.on('beforeExit', flushDiffSummaryCache)
  process.on('SIGINT', handleTerminationSignal)
  process.on('SIGTERM', handleTerminationSignal)
}

export function readDiffSummary(
  repoPath: string,
  key: string
): DiffSummaryCacheEntry | undefined {
  const envelope = getEnvelope(getDiffSummaryCachePath(repoPath))
  const entry = envelope.entries[key]
  if (!entry) return undefined
  if (!entry.summary || !entry.summary.trim()) return undefined
  return entry
}

export function writeDiffSummary(
  repoPath: string,
  key: string,
  entry: Omit<DiffSummaryCacheEntry, 'lastAccessedAt'>
): void {
  const filePath = getDiffSummaryCachePath(repoPath)
  const envelope = getEnvelope(filePath)
  envelope.entries[key] = { ...entry, lastAccessedAt: new Date().toISOString() }
  envelope.savedAt = new Date().toISOString()

  const evictedEntries = enforceHardCap(envelope.entries)
  for (const evicted of evictedEntries) {
    delete envelope.entries[evicted]
  }

  dirtyPaths.add(filePath)
  installFlushHandlers()
}

/**
 * Touch an existing entry's lastAccessedAt so LRU eviction prefers
 * dropping older / unused entries. Caller is expected to know the
 * entry exists (read returned a hit). Memory-only — no disk I/O — so
 * a fully-cached run no longer pays a rewrite per cache hit (#1923).
 */
export function touchDiffSummary(repoPath: string, key: string): void {
  const filePath = getDiffSummaryCachePath(repoPath)
  const envelope = getEnvelope(filePath)
  if (!envelope.entries[key]) return
  envelope.entries[key] = {
    ...envelope.entries[key],
    lastAccessedAt: new Date().toISOString(),
  }
  envelope.savedAt = new Date().toISOString()
  dirtyPaths.add(filePath)
  installFlushHandlers()
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
  // Drop the in-memory envelope too, so a cleared cache isn't
  // silently re-flushed to disk by the exit handler (#1923).
  envelopes.delete(filePath)
  dirtyPaths.delete(filePath)
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

export const __testInternals = {
  CACHE_ENTRY_HARD_CAP,
  enforceHardCap,
  handleTerminationSignal,
  /** Drop all in-memory envelopes/dirty state between tests. */
  resetInMemoryCache(): void {
    envelopes.clear()
    dirtyPaths.clear()
  },
}
