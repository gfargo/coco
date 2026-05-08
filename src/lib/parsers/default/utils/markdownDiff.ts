import { FileDiff } from '../../../types'

/**
 * Markdown-aware fast path (#861, angle 5). For modification diffs to
 * `.md` / `.mdx` / `.markdown` files, build a templated summary from
 * the changed structure (added / removed / updated headings) instead
 * of paying for an LLM call. Mirrors `trivialDiff` from #845: a deterministic
 * skip when the diff's meaning is captured by its shape.
 *
 * Quality / cost trade-off, on purpose: LLM summaries of markdown edits
 * are wordier ("expanded the configuration section with new examples,
 * fixed typos in troubleshooting") but most of that detail isn't load-
 * bearing for a commit message. The templated summary names the
 * structural changes (which sections moved) plus a +/- line count, and
 * defers to the LLM only when the diff has no clear structural signals
 * (paragraph-only edits, where a templated summary would actually drop
 * useful context).
 */

const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdx']
const MAX_HEADINGS_PER_BUCKET = 6

export function isMarkdownFile(path: string): boolean {
  const lower = path.toLowerCase()
  return MARKDOWN_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

export function summarizeMarkdownDiff(fileDiff: FileDiff): string | undefined {
  if (!isMarkdownFile(fileDiff.file)) return undefined

  const addedHeadings = new Set<string>()
  const removedHeadings = new Set<string>()
  let addedLines = 0
  let removedLines = 0

  for (const line of fileDiff.diff.split('\n')) {
    if (isHeaderLine(line)) continue
    if (line.startsWith('+')) {
      addedLines++
      const heading = parseHeading(line.slice(1))
      if (heading) addedHeadings.add(heading)
    } else if (line.startsWith('-')) {
      removedLines++
      const heading = parseHeading(line.slice(1))
      if (heading) removedHeadings.add(heading)
    }
  }

  // No content change → nothing to summarize. Caller falls through.
  if (addedLines === 0 && removedLines === 0) return undefined

  // No structural signal → fall through to LLM. We only fast-path
  // when the diff has heading-level changes; pure paragraph edits go
  // to the LLM so the summary keeps its detail.
  if (addedHeadings.size === 0 && removedHeadings.size === 0) {
    return undefined
  }

  // A heading that appears in both buckets is likely an update (kept
  // around but its body changed) rather than two distinct events.
  // The naive split-by-bucket diff format used by git emits the old
  // text under `-` and the new text under `+`; an unchanged heading
  // line shouldn't show up in either bucket via the standard hunk
  // path, but defensively de-dupe in case the diff producer emits
  // surrounding context as +/-.
  const updated = new Set([...addedHeadings].filter((h) => removedHeadings.has(h)))
  const purelyAdded = [...addedHeadings].filter((h) => !updated.has(h))
  const purelyRemoved = [...removedHeadings].filter((h) => !updated.has(h))

  const parts: string[] = [`Updated markdown \`${fileDiff.file}\``]
  if (purelyAdded.length) {
    parts.push(`new sections: ${formatHeadingList(purelyAdded)}`)
  }
  if (purelyRemoved.length) {
    parts.push(`removed sections: ${formatHeadingList(purelyRemoved)}`)
  }
  if (updated.size) {
    parts.push(`updated sections: ${formatHeadingList([...updated])}`)
  }
  parts.push(`+${addedLines}/-${removedLines} lines`)

  return `${parts.join('. ')}.`
}

function formatHeadingList(headings: string[]): string {
  if (headings.length <= MAX_HEADINGS_PER_BUCKET) {
    return headings.join(', ')
  }
  const shown = headings.slice(0, MAX_HEADINGS_PER_BUCKET)
  const remainder = headings.length - shown.length
  return `${shown.join(', ')} (+${remainder} more)`
}

function isHeaderLine(line: string): boolean {
  return (
    line.startsWith('diff --git') ||
    line.startsWith('index ') ||
    line.startsWith('--- ') ||
    line.startsWith('+++ ') ||
    line.startsWith('@@') ||
    line.startsWith('new file mode') ||
    line.startsWith('deleted file mode') ||
    line.startsWith('similarity index') ||
    line.startsWith('rename from ') ||
    line.startsWith('rename to ') ||
    line.startsWith('Binary files ')
  )
}

function parseHeading(line: string): string | undefined {
  const match = line.match(/^#{1,6}\s+(.+?)\s*$/)
  return match ? match[1].trim() : undefined
}
