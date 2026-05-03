/**
 * Extract a single hunk from a unified-patch diff so it can be fed to
 * `git apply` (or `git apply --cached`) for a hunk-level cherry-pick.
 *
 * The TUI's diff explore views render two flavors of patch text:
 *
 *   - stash-diff: full `git stash show -p` output, which includes
 *     `diff --git`, `---`, `+++`, and one or more `@@ ... @@` hunks
 *     per file.
 *   - commit-diff: the per-file `filePreview.hunks` array, which is
 *     hunks-only (no `diff --git` / `---` / `+++` headers).
 *
 * Either way, this helper walks `lines` from `cursorOffset` backwards
 * to find the most recent `@@` header, walks forward to the end of
 * that hunk's body, and synthesizes a fresh `diff --git` /
 * `---` / `+++` set using the caller-provided path. The output is a
 * complete, self-contained patch suitable for `git apply` without
 * having to preserve original headers from `lines`.
 */

export type ExtractDiffHunkInput = {
  /** Patch text split into lines. For stash-diff, the full
   *  `git stash show -p` output. For commit-diff, the file's
   *  `filePreview.hunks` (hunks-only). */
  lines: string[]
  /** Current cursor offset within `lines`. Determines which hunk
   *  the user has selected. */
  cursorOffset: number
  /** Repo-relative path of the file the hunk belongs to. The caller
   *  resolves this from `commitDiffSelectedPath` /
   *  `stashDiffSelectedPath` (already post-rename for renamed files). */
  path: string
}

export type ExtractDiffHunkResult = {
  /** Complete patch text — `diff --git` header, file header, single
   *  `@@` block, and that block's body. Trailing newline included
   *  so the patch can be written straight to a tempfile and consumed
   *  by `git apply` without any additional munging. */
  patchText: string
}

const HUNK_HEADER_PREFIX = '@@'
const DIFF_GIT_PREFIX = 'diff --git '

/**
 * Find the index of the `@@` hunk header at or before `cursorOffset`.
 * Returns -1 when the cursor sits before the first hunk in the patch
 * (i.e. on a `diff --git` / `---` / `+++` header line) — caller treats
 * that as "no hunk at cursor" and surfaces a status message.
 */
function findHunkHeaderAtOrBefore(lines: string[], cursorOffset: number): number {
  const start = Math.min(cursorOffset, lines.length - 1)
  for (let i = start; i >= 0; i -= 1) {
    if (lines[i]?.startsWith(HUNK_HEADER_PREFIX)) {
      return i
    }
  }
  return -1
}

/**
 * Walk forward from a hunk header to either the next `@@` header or
 * the next `diff --git` line — that's where this hunk's body ends.
 * The end index is exclusive (the line at `endIndex` is NOT part of
 * this hunk).
 */
function findHunkBodyEnd(lines: string[], headerIndex: number): number {
  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (line?.startsWith(HUNK_HEADER_PREFIX) || line?.startsWith(DIFF_GIT_PREFIX)) {
      return i
    }
  }
  return lines.length
}

export function extractDiffHunk(input: ExtractDiffHunkInput): ExtractDiffHunkResult | null {
  const { lines, cursorOffset, path } = input

  if (!lines.length || !path) {
    return null
  }

  const headerIndex = findHunkHeaderAtOrBefore(lines, cursorOffset)
  if (headerIndex < 0) {
    return null
  }

  const bodyEnd = findHunkBodyEnd(lines, headerIndex)
  // Header itself + at least one body line. An empty hunk body would
  // mean the patch is malformed and `git apply` would reject it; bail
  // out early so the caller can surface a clear status message.
  if (bodyEnd <= headerIndex + 1) {
    return null
  }

  const hunkLines = lines.slice(headerIndex, bodyEnd)
  const patchText = [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    ...hunkLines,
    '',
  ].join('\n')

  return { patchText }
}

export const inkHunkExtractionTestInternals = {
  findHunkHeaderAtOrBefore,
  findHunkBodyEnd,
}
