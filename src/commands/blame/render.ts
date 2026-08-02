import { BlameLine } from '../../git/blameData'
import { GitCommitDetail } from '../../git/logData'
import { cellWidth, padCells, truncateCells } from '../../workstation/chrome/text'

export type LineRange = { start: number; end: number }

/**
 * Parse `--lines`. Accepts `a:b` (inclusive), `a:` (open-ended), or a bare
 * `a` (single line). Returns `undefined` for anything that doesn't match —
 * including an inverted range (`b < a`) — so callers can distinguish "no
 * range requested" from "range parse failed" and error accordingly.
 */
export function parseLineRange(arg: string | undefined): LineRange | undefined {
  if (!arg) return undefined
  const match = arg.trim().match(/^(\d+)(:(\d+)?)?$/)
  if (!match) return undefined

  const start = Number.parseInt(match[1], 10)
  if (start < 1) return undefined

  if (match[2] === undefined) {
    return { start, end: start }
  }
  if (match[3] === undefined) {
    return { start, end: Number.POSITIVE_INFINITY }
  }
  const end = Number.parseInt(match[3], 10)
  if (end < start) return undefined
  return { start, end }
}

export function filterBlameLines(lines: BlameLine[], range: LineRange | undefined): BlameLine[] {
  if (!range) return lines
  return lines.filter((line) => line.lineNumber >= range.start && line.lineNumber <= range.end)
}

function truncate(value: string, width: number): string {
  return truncateCells(value, width, { ascii: true })
}

export function formatBlameTable(lines: BlameLine[]): string {
  if (lines.length === 0) {
    return 'No blame lines found.'
  }

  const authorWidth = Math.min(
    20,
    lines.reduce((max, line) => Math.max(max, cellWidth(line.author)), 'Author'.length)
  )
  const lineNoWidth = String(lines[lines.length - 1].lineNumber).length

  return lines
    .map((line) => {
      const lineNo = String(line.lineNumber).padStart(lineNoWidth, ' ')
      return `${line.shortHash}  ${padCells(truncate(line.author, authorWidth), authorWidth)}  ${lineNo}  ${line.content}`
    })
    .join('\n')
}

export function formatBlameJson(path: string, lines: BlameLine[]): string {
  return JSON.stringify({ path, lines }, null, 2)
}

/** Collapse an ascending list of line numbers into "12-18, 25, 30-31". */
export function formatLineRanges(lineNumbers: number[]): string {
  if (lineNumbers.length === 0) return ''
  const ranges: string[] = []
  let start = lineNumbers[0]
  let prev = lineNumbers[0]

  for (const lineNumber of lineNumbers.slice(1)) {
    if (lineNumber === prev + 1) {
      prev = lineNumber
      continue
    }
    ranges.push(start === prev ? `${start}` : `${start}-${prev}`)
    start = lineNumber
    prev = lineNumber
  }
  ranges.push(start === prev ? `${start}` : `${start}-${prev}`)
  return ranges.join(', ')
}

export type BlameCommitGroup = {
  hash: string
  shortHash: string
  author: string
  lineNumbers: number[]
}

/** Group blame lines by introducing commit, in file order of first appearance. */
export function groupLinesByHash(lines: BlameLine[]): BlameCommitGroup[] {
  const order: string[] = []
  const groups = new Map<string, BlameCommitGroup>()

  for (const line of lines) {
    let group = groups.get(line.hash)
    if (!group) {
      group = { hash: line.hash, shortHash: line.shortHash, author: line.author, lineNumbers: [] }
      groups.set(line.hash, group)
      order.push(line.hash)
    }
    group.lineNumbers.push(line.lineNumber)
  }

  return order.map((hash) => groups.get(hash)!)
}

export type BlameExplanation = {
  hash: string
  explanation: string
}

export type BlameExplainEntry = BlameCommitGroup & {
  detail: GitCommitDetail
  explanation: string
}

/** Renders the per-commit block fed into the explain prompt. */
export function formatCommitContext(entry: {
  hash: string
  lineNumbers: number[]
  detail: GitCommitDetail
}): string {
  const lines = [
    `Commit: ${entry.hash}`,
    `Lines: ${formatLineRanges(entry.lineNumbers)}`,
    `Author: ${entry.detail.author}`,
    `Date: ${entry.detail.date}`,
    `Subject: ${entry.detail.message}`,
  ]
  if (entry.detail.body) {
    lines.push(`Body: ${entry.detail.body}`)
  }
  return lines.join('\n')
}

export function formatExplanations(entries: BlameExplainEntry[]): string {
  if (entries.length === 0) {
    return 'No explanations available.'
  }

  return entries
    .map((entry) => {
      return [
        `${entry.shortHash}  ${entry.author}  lines ${formatLineRanges(entry.lineNumbers)}`,
        `  ${entry.detail.message}`,
        '',
        entry.explanation
          .split('\n')
          .map((line) => `  ${line}`)
          .join('\n'),
      ].join('\n')
    })
    .join('\n\n')
}
