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
 * the version segment changes. If jsdelivr is unreachable, the
 * download module falls back to its Fastly edge and then unpkg —
 * the same byte-for-byte file (see `treeSitterMirrorUrls`).
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
 * Phase 3 shipped Python; phases 5 + 6 add Rust + Go.
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
  rust: {
    language: 'rust',
    displayName: 'Rust',
    version: '0.24.0',
    wasmUrl: 'https://cdn.jsdelivr.net/npm/tree-sitter-rust@0.24.0/tree-sitter-rust.wasm',
    sha256: 'f65f354215611fd94ad34134b3427eb3d58cbb745df7b6509ba722184db73d57',
    approxBytes: 1_102_547,
  },
  go: {
    language: 'go',
    displayName: 'Go',
    version: '0.25.0',
    wasmUrl: 'https://cdn.jsdelivr.net/npm/tree-sitter-go@0.25.0/tree-sitter-go.wasm',
    sha256: '9504573f352b20be7f2f1911754d710622aedc15afff16d5ed8fb5645681aee7',
    approxBytes: 217_182,
  },
  json: {
    language: 'json',
    displayName: 'JSON',
    version: '0.24.8',
    wasmUrl: 'https://cdn.jsdelivr.net/npm/tree-sitter-json@0.24.8/tree-sitter-json.wasm',
    sha256: 'd2119fb98d5912719b13f9458574f8608d2d29dfbe45f6be1f860ea1fe2a2405',
    approxBytes: 5_596,
  },
  yaml: {
    language: 'yaml',
    displayName: 'YAML',
    version: '0.7.1',
    // Maintained under the @tree-sitter-grammars scope (the unscoped
    // tree-sitter-yaml is stale). jsdelivr serves scoped npm paths, and
    // the mirror chain (fastly / unpkg) handles the scope transparently.
    wasmUrl:
      'https://cdn.jsdelivr.net/npm/@tree-sitter-grammars/tree-sitter-yaml@0.7.1/tree-sitter-yaml.wasm',
    sha256: 'e752dc21c3591df9b45692fe417d101f45d1828c28c44d79005f4066dc7e4e91',
    approxBytes: 189_255,
  },
}

/**
 * List the languages known to the lazy-load path. Order is the
 * iteration order of the manifest entries — informational only.
 */
export function listManifestLanguages(): LazyTreeSitterLanguageId[] {
  return Object.keys(TREE_SITTER_MANIFEST) as LazyTreeSitterLanguageId[]
}
