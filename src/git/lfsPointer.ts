/**
 * Git LFS pointer parsing + diff summarization (#884).
 *
 * Without this layer, an LFS pointer file renders in the TUI as
 * a few lines of meaningless metadata (the pointer's text form):
 *
 *     version https://git-lfs.github.com/spec/v1
 *     oid sha256:1234567890abcdef…
 *     size 12345
 *
 * That's technically the file's content — git LFS substitutes
 * pointers for the real binary blob — but it's useless to a human
 * looking at a "binary file changed" event. This module detects
 * pointer files and produces a one-line replacement summary
 * ("binary file (LFS): <oid>, <size> bytes") that the surface
 * can swap in for the noisy hunk lines.
 *
 * The detection is purely textual — no `git lfs` subprocess, no
 * `.gitattributes` parsing. The pointer format is well-defined,
 * deterministic, and embedded directly in the diff content, so
 * the parser is the single source of truth. `.gitattributes`-based
 * detection (for "is this path LFS-tracked even when unmodified?")
 * is a separate concern handled by a follow-up.
 */

const POINTER_VERSION_PREFIX = 'version https://git-lfs.github.com/spec/v1'
const OID_PREFIX = 'oid sha256:'
const SIZE_PREFIX = 'size '

export type LfsPointer = {
  /** sha256 OID of the underlying binary (no `sha256:` prefix). */
  oid: string
  /** Byte size of the underlying binary, as recorded in the pointer. */
  size: number
}

/**
 * Parse a raw pointer-file body into structured data, or return
 * undefined when the body isn't a recognized pointer. Tolerates
 * trailing newlines and whitespace; requires the canonical
 * version + oid + size triple in any order (real LFS pointers
 * always emit them in that order, but defensive parsing keeps
 * downstream surfaces robust against odd line endings or future
 * fields).
 */
export function parseLfsPointer(text: string): LfsPointer | undefined {
  // Pointer files are always small (~130 bytes); reject anything
  // that's clearly too large to be a pointer to avoid scanning
  // megabytes of source code looking for the version prefix.
  if (text.length > 1024) return undefined

  const lines = text.split('\n').map((line) => line.trim())
  if (!lines.some((line) => line === POINTER_VERSION_PREFIX)) return undefined

  let oid: string | undefined
  let size: number | undefined
  for (const line of lines) {
    if (line.startsWith(OID_PREFIX)) {
      oid = line.slice(OID_PREFIX.length).trim()
    } else if (line.startsWith(SIZE_PREFIX)) {
      const parsed = Number.parseInt(line.slice(SIZE_PREFIX.length).trim(), 10)
      if (Number.isFinite(parsed) && parsed >= 0) size = parsed
    }
  }
  if (!oid || size === undefined) return undefined

  return { oid, size }
}

export type LfsPatchChange =
  | { kind: 'added'; after: LfsPointer }
  | { kind: 'removed'; before: LfsPointer }
  | { kind: 'modified'; before: LfsPointer; after: LfsPointer }

/**
 * Scan a `git diff`'s addition / deletion lines to identify when
 * the patch is just an LFS pointer change. Returns the structured
 * before/after pointers when detected, or undefined for normal
 * (non-LFS) patches.
 *
 * Accepts the raw diff lines (the same shape `getCommitFilePreview`
 * already produces) and ignores hunk headers / context lines.
 * Three cases:
 *
 *   - **added**    : only `+`-prefixed pointer body lines (new LFS file)
 *   - **removed**  : only `-`-prefixed pointer body lines (deleted LFS file)
 *   - **modified** : both `-` and `+` pointer bodies (LFS content rev'd)
 */
export function extractLfsPatchChange(lines: string[]): LfsPatchChange | undefined {
  const additions: string[] = []
  const deletions: string[] = []
  for (const line of lines) {
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+')) additions.push(line.slice(1))
    else if (line.startsWith('-')) deletions.push(line.slice(1))
  }

  const after = additions.length > 0 ? parseLfsPointer(additions.join('\n')) : undefined
  const before = deletions.length > 0 ? parseLfsPointer(deletions.join('\n')) : undefined

  if (after && before) return { kind: 'modified', before, after }
  if (after) return { kind: 'added', after }
  if (before) return { kind: 'removed', before }
  return undefined
}

/**
 * Format a `LfsPatchChange` as a one-line human-readable summary
 * suitable for swapping into the diff renderer in place of the
 * noisy pointer-body hunks. The output is intentionally terse —
 * surfaces add their own framing.
 *
 * Examples:
 *   `binary file added (LFS): 1234567a…, 12.3 MB`
 *   `binary file modified (LFS): 1234567a… → 89abcdef…, 12.3 MB → 14.1 MB`
 *   `binary file removed (LFS): 1234567a…, 12.3 MB`
 */
export function renderLfsSummary(change: LfsPatchChange): string {
  if (change.kind === 'added') {
    return `binary file added (LFS): ${shortenOid(change.after.oid)}, ${humanSize(change.after.size)}`
  }
  if (change.kind === 'removed') {
    return `binary file removed (LFS): ${shortenOid(change.before.oid)}, ${humanSize(change.before.size)}`
  }
  return `binary file modified (LFS): ${shortenOid(change.before.oid)} → ${shortenOid(change.after.oid)}, ${humanSize(change.before.size)} → ${humanSize(change.after.size)}`
}

function shortenOid(oid: string): string {
  return oid.length > 8 ? `${oid.slice(0, 8)}…` : oid
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}
