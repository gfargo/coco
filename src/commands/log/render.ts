import { GitCommitDetail, GitLogRow, getCommitRows } from '../../git/logData'
import { cellWidth, padCells, truncateCells } from '../../workstation/chrome/text'
import { LogFormat } from './config'

const DEFAULT_TERMINAL_WIDTH = 120

type RenderOptions = {
  terminalWidth?: number
}

function truncate(value: string, width: number): string {
  return truncateCells(value, width, { ascii: true })
}

function maxLength(values: string[], minimum: number): number {
  return values.reduce((max, value) => Math.max(max, cellWidth(value)), minimum)
}

function getTerminalWidth(options?: RenderOptions): number {
  return options?.terminalWidth || process.stdout.columns || DEFAULT_TERMINAL_WIDTH
}

export function formatLogJson(rows: GitLogRow[]): string {
  return JSON.stringify(getCommitRows(rows), null, 2)
}

export function formatLogTable(rows: GitLogRow[], options?: RenderOptions): string {
  const commits = getCommitRows(rows)

  if (commits.length === 0) {
    return 'No commits found.'
  }

  const graphWidth = maxLength(rows.map((row) => row.graph), 'Graph'.length)
  const authorWidth = Math.min(
    24,
    maxLength(commits.map((entry) => entry.author), 'Author'.length)
  )
  const refsByHash = new Map(commits.map((entry) => [entry.hash, entry.refs.join(', ')]))
  const terminalWidth = getTerminalWidth(options)
  const baseWidth = graphWidth + 2 + 9 + 2 + 10 + 2 + authorWidth + 2

  const renderedRows = rows.map((row) => {
    if (row.type === 'graph') {
      return row.graph
    }

    const refs = refsByHash.get(row.hash)
    const refText = refs ? `  [${refs}]` : ''
    const messageWidth = Math.max(24, terminalWidth - baseWidth - refText.length)

    return [
      padCells(row.graph || '*', graphWidth),
      padCells(row.shortHash, 9),
      padCells(row.date, 10),
      padCells(truncate(row.author, authorWidth), authorWidth),
      `${truncate(row.message, messageWidth)}${refText}`,
    ].join('  ')
  })

  return [
    [
      padCells('Graph', graphWidth),
      padCells('Commit', 9),
      padCells('Date', 10),
      padCells('Author', authorWidth),
      'Message',
    ].join('  '),
    ...renderedRows,
  ].join('\n')
}

export function formatCommitDetail(detail: GitCommitDetail, format: LogFormat): string {
  if (format === 'json') {
    return JSON.stringify(detail, null, 2)
  }

  const refs = detail.refs.length ? ` (${detail.refs.join(', ')})` : ''
  const body = detail.body ? `\n\n${detail.body}` : ''
  const files = detail.files.length
    ? detail.files
      .map((file) => {
        if (file.oldPath) {
          return `  ${file.status}  ${file.oldPath} -> ${file.path}`
        }

        return `  ${file.status}  ${file.path}`
      })
      .join('\n')
    : '  No changed files found.'

  return [
    `commit ${detail.hash}${refs}`,
    `Author: ${detail.author}`,
    `Date:   ${detail.date}`,
    '',
    `    ${detail.message}${body}`,
    '',
    'Changed files:',
    files,
  ].join('\n')
}
