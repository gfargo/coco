/**
 * Tree-sitter parser download + verification (#933 phase 3).
 *
 * Owns the contract:
 *
 *   1. Fetch the manifest-pinned `.wasm` from the CDN URL, falling back
 *      through mirror CDNs (jsdelivr → jsdelivr-Fastly → unpkg) if a
 *      source is unreachable (#1247)
 *   2. Compute SHA-256 over the bytes
 *   3. Compare against the manifest-pinned hash; refuse to write
 *      on mismatch
 *   4. Write to the cache dir atomically (temp file + rename)
 *
 * Errors at any stage surface as a typed result the caller can
 * branch on, NOT as exceptions — the prefetch orchestrator
 * processes multiple languages and shouldn't tear down because
 * one failed.
 *
 * No interactive prompts here. The caller (prefetch.ts) decides
 * whether to ask the user before triggering a download; this
 * module is a quiet workhorse.
 */

import { createHash } from 'node:crypto'
import { renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ensureTreeSitterCacheDir,
  getCachedWasmPath,
  LazyTreeSitterLanguageId,
} from './cache'
import { TREE_SITTER_MANIFEST, TreeSitterManifestEntry } from './manifest'

export type DownloadOutcome =
  | { ok: true; path: string; bytes: number }
  | { ok: false; reason: 'network'; message: string }
  | { ok: false; reason: 'sha-mismatch'; expected: string; actual: string }
  | { ok: false; reason: 'write-failed'; message: string }

/**
 * Fetch the manifest-pinned `.wasm` for a language, verify its
 * SHA-256 against the manifest, and write it to the cache dir.
 *
 * Atomic-write strategy: we fetch the full body into memory
 * (these files are small — ~450 KB for Python), write to a
 * sibling `.tmp` file, rename into place. This avoids leaving
 * a partial / corrupt `.wasm` at the canonical cache path if
 * the process is interrupted mid-write.
 *
 * Returns a structured `DownloadOutcome` rather than throwing.
 * The orchestrator handles `ok: false` cases by surrendering to
 * the regex fallback and (optionally) logging.
 */
/**
 * Mirror chain for a manifest `.wasm` URL. The manifest pins jsdelivr's
 * canonical npm path; the same file is served byte-for-byte by jsdelivr's
 * Fastly edge and by unpkg, so if one CDN is down or blocked we fall through
 * to the next. SHA-256 verification in {@link downloadTreeSitterParser} guards
 * integrity regardless of which mirror answered, so adding sources is safe.
 */
export function treeSitterMirrorUrls(wasmUrl: string): string[] {
  const urls = [wasmUrl]
  const npmPath = wasmUrl.match(/^https:\/\/cdn\.jsdelivr\.net\/npm\/(.+)$/)?.[1]
  if (npmPath) {
    urls.push(`https://fastly.jsdelivr.net/npm/${npmPath}`)
    urls.push(`https://unpkg.com/${npmPath}`)
  }
  return urls
}

export async function downloadTreeSitterParser(
  language: LazyTreeSitterLanguageId,
  options?: { fetchImpl?: typeof globalThis.fetch },
): Promise<DownloadOutcome> {
  const entry: TreeSitterManifestEntry = TREE_SITTER_MANIFEST[language]
  const fetchImpl = options?.fetchImpl || globalThis.fetch

  let lastFailure: DownloadOutcome = {
    ok: false,
    reason: 'network',
    message: 'no download URLs available',
  }

  // Try each mirror in order; advance to the next on a network failure, a
  // non-2xx response, or a SHA mismatch (a mirror serving unexpected bytes).
  for (const url of treeSitterMirrorUrls(entry.wasmUrl)) {
    let body: ArrayBuffer
    try {
      const response = await fetchImpl(url)
      if (!response.ok) {
        lastFailure = { ok: false, reason: 'network', message: `HTTP ${response.status} ${response.statusText}` }
        continue
      }
      body = await response.arrayBuffer()
    } catch (error) {
      lastFailure = { ok: false, reason: 'network', message: (error as Error).message }
      continue
    }

    const bytes = new Uint8Array(body)
    const actualHash = createHash('sha256').update(bytes).digest('hex')
    if (actualHash !== entry.sha256) {
      lastFailure = { ok: false, reason: 'sha-mismatch', expected: entry.sha256, actual: actualHash }
      continue
    }

    const cacheDir = ensureTreeSitterCacheDir()
    const finalPath = getCachedWasmPath(language)
    const tempPath = join(cacheDir, `tree-sitter-${language}.wasm.tmp-${process.pid}-${Date.now()}`)
    try {
      writeFileSync(tempPath, bytes)
      renameSync(tempPath, finalPath)
    } catch (error) {
      // A write failure is local, not mirror-specific — retrying other
      // sources won't help, so surface it immediately.
      return { ok: false, reason: 'write-failed', message: (error as Error).message }
    }

    return { ok: true, path: finalPath, bytes: bytes.byteLength }
  }

  return lastFailure
}

/**
 * Human-readable summary of a `DownloadOutcome`, for status
 * messages + log output. The orchestrator emits this to stdout/
 * stderr; tests use it for assertions.
 */
export function formatDownloadOutcome(
  language: LazyTreeSitterLanguageId,
  outcome: DownloadOutcome,
): string {
  const entry = TREE_SITTER_MANIFEST[language]
  if (outcome.ok) {
    const kb = (outcome.bytes / 1024).toFixed(0)
    return `✓ ${entry.displayName} parser cached (${kb} KB) at ${outcome.path}`
  }
  if (outcome.reason === 'network') {
    return `✗ ${entry.displayName}: network error — ${outcome.message}`
  }
  if (outcome.reason === 'sha-mismatch') {
    return `✗ ${entry.displayName}: SHA-256 mismatch (expected ${outcome.expected.slice(0, 12)}…, got ${outcome.actual.slice(0, 12)}…) — refusing to cache`
  }
  return `✗ ${entry.displayName}: write failed — ${outcome.message}`
}
