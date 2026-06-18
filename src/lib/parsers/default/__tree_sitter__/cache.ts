/**
 * Cache directory resolution for lazy-loaded tree-sitter parsers
 * (#933 phase 3).
 *
 * Languages NOT bundled with coco (Python, Rust, Go) ship their
 * `.wasm` parsers via lazy-download from a CDN, validated against
 * a manifest in `manifest.ts`. This module owns the on-disk
 * location: where the downloads land, and how runtime resolves a
 * language id back to a `.wasm` path.
 *
 * Layout follows the XDG Base Directory spec where applicable:
 *
 *   - Linux/macOS: `$XDG_CACHE_HOME/coco/tree-sitter/` if set,
 *     else `~/.cache/coco/tree-sitter/`.
 *   - Windows: `%LOCALAPPDATA%/coco/Cache/tree-sitter/` if set,
 *     else `%USERPROFILE%/AppData/Local/coco/Cache/tree-sitter/`.
 *
 * The cache is shared across all projects on the machine — once a
 * user opts into a language's parser, every coco invocation
 * (across every repo) reuses it.
 *
 * The cache is also a one-way write target: this module exposes
 * the path resolution + a `ensureCacheDir()` helper that creates
 * the directory on demand. Eviction / `coco cache clear` is a
 * polish-phase concern; today, users `rm -rf` the dir manually.
 */

import { existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'

/**
 * Tree-sitter language identifiers eligible for the lazy-load path.
 * Bundled languages (`typescript`, `tsx`) are intentionally NOT in
 * this list — they ship in `dist/tree-sitter/` via the postbuild
 * copy step. Adding a lazy-loaded language: extend this union AND
 * add the matching entry to `TREE_SITTER_MANIFEST`.
 */
export type LazyTreeSitterLanguageId = 'python' | 'rust' | 'go' | 'json' | 'yaml'

/**
 * Resolve the root cache directory for coco. Honors three env-var
 * overrides in priority order:
 *
 *   1. `COCO_CACHE_DIR` — direct override of the cache root.
 *      Useful for CI (pin a known location) and for tests
 *      (each test file points at its own temp dir so parallel
 *      workers don't stomp on each other).
 *   2. `XDG_CACHE_HOME` (Unix) / `LOCALAPPDATA` (Windows) —
 *      respects the platform-canonical override.
 *   3. Platform default — `~/.cache/coco` on Unix,
 *      `%USERPROFILE%\AppData\Local\coco\Cache` on Windows.
 *
 * No filesystem operations — pure path computation. Callers that
 * actually want to write should pass through `ensureCacheDir`.
 */
export function getCacheRootDir(): string {
  const direct = process.env.COCO_CACHE_DIR
  if (direct) return direct
  if (platform() === 'win32') {
    const local = process.env.LOCALAPPDATA
    if (local) return join(local, 'coco', 'Cache')
    return join(homedir(), 'AppData', 'Local', 'coco', 'Cache')
  }
  // Linux/macOS — XDG-style. macOS technically has its own
  // `~/Library/Caches/<app>` convention but most CLI tools use the
  // XDG layout there for consistency with Linux. The XDG env var
  // takes precedence when set, which lets containerized / sandboxed
  // setups override.
  const xdg = process.env.XDG_CACHE_HOME
  if (xdg) return join(xdg, 'coco')
  return join(homedir(), '.cache', 'coco')
}

/**
 * Tree-sitter cache subdir: where lazy-loaded `.wasm` parsers
 * land. Sibling to any other cache dirs coco might grow.
 */
export function getTreeSitterCacheDir(): string {
  return join(getCacheRootDir(), 'tree-sitter')
}

/**
 * Filesystem path for a lazy-loaded language's cached `.wasm`.
 * Filenames mirror what the runtime expects in `dist/tree-sitter/`
 * for bundled languages, so the resolver can fall through cleanly
 * between bundled and cached locations.
 */
export function getCachedWasmPath(language: LazyTreeSitterLanguageId): string {
  return join(getTreeSitterCacheDir(), `tree-sitter-${language}.wasm`)
}

/**
 * Create the tree-sitter cache directory (and any missing
 * parents). Idempotent — safe to call before every write.
 *
 * Returns the directory path so the caller can use it directly.
 * Errors here would otherwise cascade into confusing
 * "ENOENT" reports during download; the explicit ensure step
 * keeps failures observable at the right layer.
 */
export function ensureTreeSitterCacheDir(): string {
  const dir = getTreeSitterCacheDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * True when a lazy-loaded language's `.wasm` is already cached
 * locally. Used by the runtime to decide whether to short-circuit
 * to the cached file or fall through to the regex parser.
 */
export function isLanguageCached(language: LazyTreeSitterLanguageId): boolean {
  return existsSync(getCachedWasmPath(language))
}

export type CachedParserStatus = {
  language: LazyTreeSitterLanguageId
  /** True when the .wasm exists on disk in the cache. */
  cached: boolean
  /** Filesystem path the cache lookup checks. */
  path: string
  /** On-disk size in bytes when cached; undefined otherwise. */
  bytes?: number
  /** Last-modified timestamp when cached; undefined otherwise. */
  mtime?: Date
}

/**
 * Inspect the on-disk state of a single lazy-loaded parser. Used by
 * `coco cache parsers` to render the status table and by the
 * interactive prefetch picker to mark already-cached entries.
 */
export function getCachedParserStatus(
  language: LazyTreeSitterLanguageId,
): CachedParserStatus {
  const path = getCachedWasmPath(language)
  const cached = existsSync(path)
  if (!cached) return { language, cached: false, path }
  try {
    const stat = statSync(path)
    return { language, cached: true, path, bytes: stat.size, mtime: stat.mtime }
  } catch {
    // Race window: file disappeared between existsSync and statSync.
    // Report uncached rather than crash.
    return { language, cached: false, path }
  }
}

/**
 * Remove a single language's cached .wasm. Idempotent — no-op when
 * the file isn't present. Returns true when a file was actually
 * deleted, false otherwise.
 */
export function clearCachedParser(language: LazyTreeSitterLanguageId): boolean {
  const path = getCachedWasmPath(language)
  if (!existsSync(path)) return false
  try {
    unlinkSync(path)
    return true
  } catch {
    return false
  }
}
