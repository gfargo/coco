import { FileDiff } from '../../../types'

/**
 * Diff-shape detection + deterministic summarization for "trivial"
 * diffs (#845). A trivial diff is one whose meaning is fully
 * captured by its shape — pure additions, pure deletions, renames
 * with no content change, and binary file changes — so an LLM
 * summary adds nothing the templated string can't already convey.
 *
 * Used by the pre-process pass in `summarizeLargeFiles` to skip
 * the LLM call for trivial files entirely. On the bench's
 * pure-additions fixtures (initial commit, feature add) the wave
 * consolidation often doesn't even fire afterward because the
 * synthetic summaries collapse the directory token totals under
 * the budget.
 *
 * Defensive about input shape: the helpers run before any other
 * parsing, so a malformed diff (zero hunks, missing headers, weird
 * formatting from a custom diff producer) should fall through as
 * "modification" — the existing LLM path still handles it.
 */

export type TrivialDiffShape = 'addition' | 'deletion' | 'rename' | 'binary'

/**
 * Inspect a unified-diff string and report its shape, or undefined
 * if the diff isn't trivial (mixed +/- lines, weird headers, etc.).
 *
 * Detection rules (cheap on purpose — we're called per-file and the
 * goal is to skip work, not be exhaustive):
 *
 *   - `Binary files ... differ` header → 'binary'
 *   - `rename from`/`rename to` headers and no `+`/`-` content
 *     lines → 'rename'
 *   - All content lines are `+` (and at least one is) → 'addition'
 *   - All content lines are `-` (and at least one is) → 'deletion'
 *   - Otherwise → undefined (let the LLM handle it)
 */
export function detectTrivialDiffShape(diff: string): TrivialDiffShape | undefined {
  if (!diff) return undefined

  // Binary marker is unambiguous and short-circuits early.
  if (/^Binary files .+ and .+ differ$/m.test(diff)) {
    return 'binary'
  }

  // Pure rename: git emits `rename from` / `rename to` and no body.
  // We require BOTH markers AND no `+`/`-` content lines. Some
  // renames-with-edit show rename headers AND a hunk; those should
  // fall through to the LLM path.
  const hasRenameFrom = /^rename from /m.test(diff)
  const hasRenameTo = /^rename to /m.test(diff)
  if (hasRenameFrom && hasRenameTo) {
    const hasContentChange = diff
      .split('\n')
      .some((line) => isContentChangeLine(line))
    if (!hasContentChange) {
      return 'rename'
    }
  }

  // Walk the body once classifying content lines. We skip header
  // lines (diff --git, index, ---, +++, @@, etc.) and only inspect
  // the lines that represent actual change content.
  let plus = 0
  let minus = 0
  for (const line of diff.split('\n')) {
    if (isHeaderLine(line)) continue
    if (line.startsWith('+')) plus++
    else if (line.startsWith('-')) minus++
    // Context lines (' ' prefix) are ignored for shape classification:
    // a pure addition can still have surrounding context if a hunk
    // anchors at line 0, though `git diff` for a brand-new file
    // typically has none.
  }

  if (plus > 0 && minus === 0) return 'addition'
  if (minus > 0 && plus === 0) return 'deletion'
  return undefined
}

/**
 * Build a deterministic summary string for a trivial diff. Returns
 * undefined when the shape can't be templated (caller should fall
 * back to the LLM path).
 */
export function summarizeTrivialDiff(fileDiff: FileDiff): string | undefined {
  const shape = detectTrivialDiffShape(fileDiff.diff)
  if (!shape) return undefined

  const lineCount = countContentLines(fileDiff.diff, shape)
  switch (shape) {
    case 'addition':
      return `Added \`${fileDiff.file}\` (${lineCount} line${lineCount === 1 ? '' : 's'}).`
    case 'deletion':
      return `Removed \`${fileDiff.file}\` (${lineCount} line${lineCount === 1 ? '' : 's'}).`
    case 'rename': {
      const oldPath = extractRenameOldPath(fileDiff.diff)
      return oldPath
        ? `Renamed \`${oldPath}\` → \`${fileDiff.file}\`.`
        : `Renamed file to \`${fileDiff.file}\`.`
    }
    case 'binary':
      return `Updated binary file \`${fileDiff.file}\`.`
  }
}

function isHeaderLine(line: string): boolean {
  return (
    line.startsWith('diff --git') ||
    line.startsWith('index ') ||
    /^--- (a\/|b\/|\/dev\/null)/.test(line) ||
    /^\+\+\+ (a\/|b\/|\/dev\/null)/.test(line) ||
    line.startsWith('@@') ||
    line.startsWith('new file mode') ||
    line.startsWith('deleted file mode') ||
    line.startsWith('similarity index') ||
    line.startsWith('rename from ') ||
    line.startsWith('rename to ') ||
    line.startsWith('Binary files ')
  )
}

function isContentChangeLine(line: string): boolean {
  if (isHeaderLine(line)) return false
  return line.startsWith('+') || line.startsWith('-')
}

function countContentLines(diff: string, shape: TrivialDiffShape): number {
  if (shape === 'binary' || shape === 'rename') return 0
  const prefix = shape === 'addition' ? '+' : '-'
  let count = 0
  for (const line of diff.split('\n')) {
    if (isHeaderLine(line)) continue
    if (line.startsWith(prefix)) count++
  }
  return count
}

function extractRenameOldPath(diff: string): string | undefined {
  const match = diff.match(/^rename from (.+)$/m)
  return match ? match[1].trim() : undefined
}
