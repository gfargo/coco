/**
 * Split a monolithic unified-diff string (as returned by `git diff`)
 * into per-file `FileDiff` records.
 *
 * Segmentation primarily uses `diff --git a/… b/…` header lines as
 * boundaries. A caller-supplied `patch` source may lack `diff --git`
 * headers entirely (a plain unified diff from `diff -u` or another
 * tool) — for that case, a `--- a/<path>` line immediately followed by
 * a `+++ b/<path>` line is also treated as a boundary, since the two-line
 * pairing is the actual header signal in the unified-diff format.
 *
 * Neither rule ever treats a lone `---`/`+++`-prefixed line as a boundary
 * on its own. That avoids the #1699 misparse where a SQL or Lua comment
 * (`-- foo`) appears as a deleted content line and its text happens to
 * start with `---`: the very next line is the corresponding added line
 * (`+-- foo`), which does not match `+++ `, so the pair check never fires.
 *
 * The path is extracted from the `diff --git a/<path> b/<path>` header
 * first. A fallback to the `+++ b/<path>` line covers edge cases such
 * as new-file diffs and headerless plain diffs. `/dev/null` paths (pure
 * deletion / pure addition) are resolved by preferring the non-null side.
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
  // True immediately after a `diff --git` line until its own `--- `/`+++ `
  // header pair (if any) has been consumed, so that pair isn't mistaken
  // for a second, headerless file boundary within the same segment.
  let awaitingGitHeaderBody = false

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

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.startsWith('diff --git ')) {
      // Start of a new file segment — flush whatever we have.
      flush()
      currentLines = [line]
      currentFile = pathFromDiffGitHeader(line)
      awaitingGitHeaderBody = true
      continue
    }

    // A `--- a/<path>` line immediately followed by `+++ b/<path>` is the
    // real unified-diff header pair. Checking both lines together (rather
    // than either line alone) is what keeps this from firing on a lone
    // `---`/`+++`-prefixed content line (see #1699 note above).
    const isHeaderPair =
      line.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ')

    if (isHeaderPair && awaitingGitHeaderBody) {
      // This is the header pair belonging to the `diff --git` segment we
      // just started — absorb it, don't treat it as a new boundary.
      awaitingGitHeaderBody = false
      currentLines.push(line)
      continue
    }

    if (isHeaderPair) {
      // No preceding `diff --git` — this is a headerless plain unified
      // diff's file boundary.
      flush()
      currentLines = [line]
      currentFile = undefined
      continue
    }

    currentLines.push(line)
  }
  // Flush the final segment.
  flush()

  return results
}
