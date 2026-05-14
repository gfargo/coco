/**
 * Lazy-loaded tree-sitter parser manifest (#933 phase 3).
 *
 * The source of truth for "which .wasm files can be lazy-downloaded
 * and where they live upstream". Each entry pins an explicit
 * version + SHA-256 so a corrupt or tampered download is rejected
 * before the file ever touches the parser. Updating a language's
 * parser version is a deliberate manifest edit, NOT something that
 * floats with package.json updates — keeps the supply chain
 * surface area small and explicit.
 *
 * URL choice: jsdelivr's CDN-of-npm path serves the raw .wasm file
 * (~450 KB for Python) from a globally-distributed CDN, without
 * pulling the full npm tarball (which would be 10× larger for the
 * same content). The URL pattern is stable across versions; only
 * the version segment changes. Mirrors (unpkg, fastly) are options
 * if jsdelivr proves unreliable in practice.
 *
 * SHA-256s are computed at manifest-edit time by downloading the
 * file once and running `shasum -a 256`. The download module
 * (`download.ts`) re-computes after every fetch and refuses to
 * write the cached file when the hash doesn't match.
 */

import type { LazyTreeSitterLanguageId } from './cache'

export type TreeSitterManifestEntry = {
  /** Language id — matches `LazyTreeSitterLanguageId`. */
  language: LazyTreeSitterLanguageId
  /** Human-readable name for log / status messages. */
  displayName: string
  /** Upstream package version pinned in the manifest. */
  version: string
  /** Direct URL to the `.wasm` file. */
  wasmUrl: string
  /**
   * Lower-case hex sha-256 of the bytes at `wasmUrl`. The download
   * module verifies before writing to the cache.
   */
  sha256: string
  /** Approximate uncompressed size in bytes — drives the user-facing "~XXX KB" prompt. */
  approxBytes: number
}

/**
 * Per-language manifest. Every `LazyTreeSitterLanguageId` MUST
 * have an entry here — that's enforced by the `Record` typing.
 * Phase 3 ships Python; Rust + Go follow in phases 5 / 6.
 */
export const TREE_SITTER_MANIFEST: Record<LazyTreeSitterLanguageId, TreeSitterManifestEntry> = {
  python: {
    language: 'python',
    displayName: 'Python',
    version: '0.23.6',
    wasmUrl: 'https://cdn.jsdelivr.net/npm/tree-sitter-python@0.23.6/tree-sitter-python.wasm',
    sha256: '8c93692fb368e288a5824cee55773c9b3602804f513bda48c97661e52e9c2da2',
    approxBytes: 458_752,
  },
}

/**
 * List the languages known to the lazy-load path. Order is the
 * iteration order of the manifest entries — informational only.
 */
export function listManifestLanguages(): LazyTreeSitterLanguageId[] {
  return Object.keys(TREE_SITTER_MANIFEST) as LazyTreeSitterLanguageId[]
}
