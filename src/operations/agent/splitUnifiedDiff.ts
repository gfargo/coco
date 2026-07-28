/**
 * Split a monolithic unified-diff string (as returned by `git diff`)
 * into per-file `FileDiff` records.
 *
 * Segmentation uses `diff --git a/… b/…` header lines as boundaries —
 * never `---`/`+++` body lines — to avoid the #1699 misparse where a
 * SQL or Lua comment (`-- foo`) appears as a deleted content line and
 * its text happens to start with `---`, colliding with the file-header
 * marker pattern used by older implementations.
 *
 * The path is extracted from the `diff --git a/<path> b/<path>` header
 * first. A fallback to the `+++ b/<path>` line covers edge cases such
 * as new-file diffs. `/dev/null` paths (pure deletion / pure addition)
 * are resolved by preferring the non-null side.
 */

import type { FileDiff } from '../../lib/types'
import type { TokenCounter } from '../../lib/utils/tokenizer'

/**
 * Derive the canonical file path from a `diff --git` header line.
 *
 *   diff --git a/src/foo.ts b/src/foo.ts
 *   diff --git a/old.ts b/new.ts           ← rename
 *   diff --git a/foo.ts b/foo.ts           ← new/deleted file
 *
 * We prefer the `b/` (destination) side. If it is `/dev/null` (file
 * deleted) we fall back to the `a/` side.
 */
function pathFromDiffGitHeader(line: string): string | undefined {
  const prefix = 'diff --git a/'
  if (!line.startsWith(prefix)) return undefined
  const rest = line.slice(prefix.length)

  // Common case (no rename): the a/ and b/ sides are identical, so try every
  // ' b/' occurrence and prefer the split where both sides match exactly.
  // This resolves correctly even when the path itself contains the literal
  // substring ' b/' (which a purely greedy regex mis-splits on).
  const marker = ' b/'
  for (let idx = rest.indexOf(marker); idx !== -1; idx = rest.indexOf(marker, idx + 1)) {
    const src = rest.slice(0, idx)
    const dst = rest.slice(idx + marker.length)
    if (src === dst) return src
  }

  // No exact match (rename, or a genuinely ambiguous path) — fall back to a
  // greedy split from the last ' b/' occurrence.
  const match = /^(.+) b\/(.+)$/.exec(rest)
  if (!match) return undefined
  const src = match[1].trim()
  const dst = match[2].trim()
  return dst === '/dev/null' ? src : dst
}

/**
 * Derive the canonical file path from a `+++ b/<path>` line, which
 * git always emits for the destination side of a diff hunk. Returns
 * undefined for `/dev/null` (the file was deleted; the `diff --git`
 * extractor above should have already handled this via the `a/` side).
 */
function pathFromPlusPlusHeader(line: string): string | undefined {
  const match = /^\+\+\+ b\/(.+)$/.exec(line)
  if (!match) return undefined
  const path = match[1].trim()
  return path === '/dev/null' ? undefined : path
}

/**
 * Split a monolithic unified diff string into per-file FileDiff records.
 *
 * Binary files and renames with no content changes are included in the
 * output; their `diff` field will contain only the git header lines.
 * Files with zero content lines are included so the caller can report
 * them as omitted with accurate counts.
 *
 * @param diffText  Raw `git diff` output (may be empty).
 * @param tokenizer Token counter used to populate `FileDiff.tokenCount`.
 * @returns         Array of per-file FileDiff records, in diff order.
 *                  Returns `[]` for an empty input.
 */
export function splitUnifiedDiff(
  diffText: string,
  tokenizer: TokenCounter,
): FileDiff[] {
  if (!diffText || !diffText.trim()) return []

  const lines = diffText.split('\n')
  const results: FileDiff[] = []
  let currentLines: string[] = []
  let currentFile: string | undefined

  function flush() {
    if (currentLines.length === 0) return
    const rawDiff = currentLines.join('\n')
    // If we could not determine the file path from the diff --git header,
    // try the +++ b/path line as a fallback.
    let file = currentFile
    if (!file) {
      for (const line of currentLines) {
        const fallback = pathFromPlusPlusHeader(line)
        if (fallback) {
          file = fallback
          break
        }
      }
    }
    if (!file) {
      // Completely unresolvable — skip this segment rather than emitting
      // a record with an empty path (which would confuse callers).
      return
    }
    results.push({
      file,
      diff: rawDiff,
      // summary is populated later by the condensation pass
      summary: '',
      tokenCount: tokenizer(rawDiff),
    })
  }

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      // Start of a new file segment — flush whatever we have.
      flush()
      currentLines = [line]
      currentFile = pathFromDiffGitHeader(line)
    } else {
      currentLines.push(line)
    }
  }
  // Flush the final segment.
  flush()

  return results
}
