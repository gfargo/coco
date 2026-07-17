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
 * Returns -1 when the cursor sits before the first hunk of ITS OWN
 * file — i.e. on a `diff --git` / `---` / `+++` header line. The walk
 * stops at a `diff --git` boundary: in a multi-file patch, running
 * past it used to resolve the PREVIOUS file's last hunk while the
 * caller labeled the patch with the cursored file's path, producing a
 * mismatched patch (`git apply` failure at best, the wrong hunk
 * applied to the wrong file at worst).
 */
function findHunkHeaderAtOrBefore(lines: string[], cursorOffset: number): number {
  const start = Math.min(cursorOffset, lines.length - 1)
  for (let i = start; i >= 0; i -= 1) {
    if (lines[i]?.startsWith(HUNK_HEADER_PREFIX)) {
      return i
    }
    if (lines[i]?.startsWith(DIFF_GIT_PREFIX)) {
      // Reached a file boundary (possibly the cursored line itself)
      // without meeting a hunk header — the cursor sits in a file
      // preamble, and any `@@` above belongs to a different file.
      return -1
    }
  }
  return -1
}

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

type HunkHeaderCounts = {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
}

/**
 * Parse the `@@ -oldStart,oldCount +newStart,newCount @@` header. A
 * missing count (e.g. `@@ -1 +1,2 @@`) means a count of 1, per the
 * unified-diff spec. Returns null when `line` isn't a well-formed hunk
 * header, so callers can fall back to legacy behavior for odd-but-
 * appliable input.
 */
function parseHunkHeader(line: string | undefined): HunkHeaderCounts | null {
  const match = line ? HUNK_HEADER_RE.exec(line) : null
  if (!match) {
    return null
  }
  return {
    oldStart: Number(match[1]),
    oldCount: match[2] === undefined ? 1 : Number(match[2]),
    newStart: Number(match[3]),
    newCount: match[4] === undefined ? 1 : Number(match[4]),
  }
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

/**
 * Verify a hunk's body actually contains as many old-file (context +
 * removal) and new-file (context + addition) lines as its `@@ -a,b +c,d @@`
 * header declares. commit-diff mode feeds `extractDiffHunk` the file's
 * `filePreview.hunks`, which upstream truncates to a fixed line count
 * (`getCommitFilePreview`'s `.slice(0, limit)`); when that cut lands mid-hunk
 * the last hunk's body is shorter than its header claims, and `git apply`
 * rejects the resulting patch with a low-level "corrupt patch" error. Bail
 * out here instead so the caller can show its existing clear status message.
 */
function hunkBodyMatchesHeader(hunkLines: string[]): boolean {
  const counts = parseHunkHeader(hunkLines[0])
  if (!counts) {
    return false
  }

  let oldLines = 0
  let newLines = 0
  for (let i = 1; i < hunkLines.length; i += 1) {
    const line = hunkLines[i] ?? ''
    if (line.startsWith('-')) {
      oldLines += 1
    } else if (line.startsWith('+')) {
      newLines += 1
    } else if (line.startsWith('\\')) {
      // "\ No newline at end of file" marker — not a counted body line.
    } else {
      oldLines += 1
      newLines += 1
    }
  }

  return oldLines >= counts.oldCount && newLines >= counts.newCount
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
  if (!hunkBodyMatchesHeader(hunkLines)) {
    return null
  }

  const counts = parseHunkHeader(hunkLines[0])

  const fileHeaderLines: string[] = []
  if (counts && counts.oldStart === 0 && counts.oldCount === 0) {
    // The hunk creates the file from nothing — the original patch's
    // `---` side is `/dev/null`. Synthesizing `--- a/<path>` instead
    // makes `git apply` fail with "No such file or directory" because
    // it tries to read the pre-image of a file that doesn't exist yet.
    // The mode is guessed as 100644 since hunk bodies carry no mode
    // data; an executable new file would be recreated non-executable.
    fileHeaderLines.push('new file mode 100644', '--- /dev/null', `+++ b/${path}`)
  } else if (counts && counts.newStart === 0 && counts.newCount === 0) {
    // The hunk deletes the whole file — the original patch's `+++`
    // side is `/dev/null`. Synthesizing `+++ b/<path>` instead makes
    // `git apply` "succeed" while leaving a 0-byte tracked file behind
    // instead of removing it.
    fileHeaderLines.push('deleted file mode 100644', `--- a/${path}`, '+++ /dev/null')
  } else {
    fileHeaderLines.push(`--- a/${path}`, `+++ b/${path}`)
  }

  const patchText = [
    `diff --git a/${path} b/${path}`,
    ...fileHeaderLines,
    ...hunkLines,
    '',
  ].join('\n')

  return { patchText }
}

export const inkHunkExtractionTestInternals = {
  findHunkHeaderAtOrBefore,
  findHunkBodyEnd,
  hunkBodyMatchesHeader,
  parseHunkHeader,
}
