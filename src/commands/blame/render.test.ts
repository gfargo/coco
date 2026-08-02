import { BlameLine } from '../../git/blameData'
import { GitCommitDetail } from '../../git/logData'
import {
  BlameExplainEntry,
  filterBlameLines,
  formatBlameJson,
  formatBlameTable,
  formatCommitContext,
  formatExplanations,
  formatLineRanges,
  groupLinesByHash,
  parseLineRange,
} from './render'

const LINES: BlameLine[] = [
  { hash: 'a'.repeat(40), shortHash: 'aaaaaaaa', author: 'Ada Lovelace', authorTime: 1700000000, lineNumber: 1, content: 'const answer = 42' },
  { hash: 'a'.repeat(40), shortHash: 'aaaaaaaa', author: 'Ada Lovelace', authorTime: 1700000000, lineNumber: 2, content: 'const doubled = answer * 2' },
  { hash: 'b'.repeat(40), shortHash: 'bbbbbbbb', author: 'Grace Hopper', authorTime: 1710000000, lineNumber: 3, content: 'return doubled' },
]

describe('parseLineRange', () => {
  it('parses an inclusive a:b range', () => {
    expect(parseLineRange('10:20')).toEqual({ start: 10, end: 20 })
  })

  it('parses a single bare line as start === end', () => {
    expect(parseLineRange('10')).toEqual({ start: 10, end: 10 })
  })

  it('parses an open-ended a: range', () => {
    expect(parseLineRange('10:')).toEqual({ start: 10, end: Number.POSITIVE_INFINITY })
  })

  it('returns undefined for missing input', () => {
    expect(parseLineRange(undefined)).toBeUndefined()
  })

  it('returns undefined for an inverted range', () => {
    expect(parseLineRange('20:10')).toBeUndefined()
  })

  it('returns undefined for garbage input', () => {
    expect(parseLineRange('abc')).toBeUndefined()
    expect(parseLineRange('')).toBeUndefined()
  })
})

describe('filterBlameLines', () => {
  it('returns all lines when no range is given', () => {
    expect(filterBlameLines(LINES, undefined)).toEqual(LINES)
  })

  it('filters to the inclusive range', () => {
    expect(filterBlameLines(LINES, { start: 2, end: 3 })).toEqual(LINES.slice(1))
  })
})

describe('formatBlameTable / formatBlameJson', () => {
  it('renders one row per line with hash, author, line number, content', () => {
    const output = formatBlameTable(LINES)
    expect(output).toContain('aaaaaaaa')
    expect(output).toContain('Ada Lovelace')
    expect(output).toContain('const answer = 42')
    expect(output).toContain('bbbbbbbb')
    expect(output).toContain('return doubled')
  })

  it('reports no lines found for an empty input', () => {
    expect(formatBlameTable([])).toBe('No blame lines found.')
  })

  it('serializes path + lines as JSON', () => {
    const parsed = JSON.parse(formatBlameJson('src/example.ts', LINES))
    expect(parsed.path).toBe('src/example.ts')
    expect(parsed.lines).toHaveLength(3)
  })
})

describe('formatLineRanges', () => {
  it('collapses contiguous runs and separates gaps', () => {
    expect(formatLineRanges([12, 13, 14, 15, 18, 25, 26])).toBe('12-15, 18, 25-26')
  })

  it('handles a single line', () => {
    expect(formatLineRanges([5])).toBe('5')
  })

  it('handles an empty list', () => {
    expect(formatLineRanges([])).toBe('')
  })
})

describe('groupLinesByHash', () => {
  it('groups lines that share the same introducing commit, in first-appearance order', () => {
    const groups = groupLinesByHash(LINES)
    expect(groups).toEqual([
      { hash: 'a'.repeat(40), shortHash: 'aaaaaaaa', author: 'Ada Lovelace', lineNumbers: [1, 2] },
      { hash: 'b'.repeat(40), shortHash: 'bbbbbbbb', author: 'Grace Hopper', lineNumbers: [3] },
    ])
  })

  it('collapses two lines from the same sha into one commit fetch worth of grouping', () => {
    const groups = groupLinesByHash(LINES)
    const distinctHashes = new Set(groups.map((g) => g.hash))
    expect(distinctHashes.size).toBe(2)
  })
})

const DETAIL: GitCommitDetail = {
  hash: 'a'.repeat(40),
  shortHash: 'aaaaaaaa',
  parents: [],
  date: '2026-04-27',
  author: 'Ada Lovelace',
  refs: [],
  message: 'feat: add doubling helper',
  body: '',
  files: [],
  stats: { filesChanged: 1, insertions: 2, deletions: 0 },
}

describe('formatCommitContext', () => {
  it('includes commit sha, line ranges, author, date, and subject', () => {
    const context = formatCommitContext({ hash: DETAIL.hash, lineNumbers: [1, 2], detail: DETAIL })
    expect(context).toContain(`Commit: ${DETAIL.hash}`)
    expect(context).toContain('Lines: 1-2')
    expect(context).toContain('Author: Ada Lovelace')
    expect(context).toContain('Subject: feat: add doubling helper')
    expect(context).not.toContain('Body:')
  })

  it('includes the commit body when present', () => {
    const context = formatCommitContext({
      hash: DETAIL.hash,
      lineNumbers: [1],
      detail: { ...DETAIL, body: 'Adds a helper used by the calculator.' },
    })
    expect(context).toContain('Body: Adds a helper used by the calculator.')
  })
})

describe('formatExplanations', () => {
  it('renders one block per commit with the explanation text', () => {
    const entries: BlameExplainEntry[] = [
      {
        hash: DETAIL.hash,
        shortHash: DETAIL.shortHash,
        author: DETAIL.author,
        lineNumbers: [1, 2],
        detail: DETAIL,
        explanation: 'Introduced to support doubling a value.',
      },
    ]
    const output = formatExplanations(entries)
    expect(output).toContain('aaaaaaaa')
    expect(output).toContain('lines 1-2')
    expect(output).toContain('Introduced to support doubling a value.')
  })

  it('reports no explanations for an empty input', () => {
    expect(formatExplanations([])).toBe('No explanations available.')
  })
})
