import { SimpleGit } from 'simple-git'
import { CommandHandler } from '../../lib/types'
import { getRepo } from '../../lib/simple-git/getRepo'
import { handleResult } from '../../lib/ui/handleResult'
import { LogArgv, LogFormat } from './config'

const FIELD_SEPARATOR = '\x1f'
const LOG_FORMAT = `%x1f%h%x1f%H%x1f%ad%x1f%an%x1f%d%x1f%s`
const DETAIL_FORMAT = `%H%x1f%h%x1f%ad%x1f%an%x1f%d%x1f%s%x1f%b`

export type GitLogEntry = {
  graph: string
  shortHash: string
  hash: string
  date: string
  author: string
  refs: string[]
  message: string
}

export type GitCommitDetail = Omit<GitLogEntry, 'graph'> & {
  body: string
  files: Array<{
    status: string
    path: string
    oldPath?: string
  }>
}

function toArray(value: string | string[] | undefined): string[] {
  if (!value) {
    return []
  }

  return Array.isArray(value) ? value : [value]
}

function normalizeLimit(limit: number | undefined): number {
  if (!limit || Number.isNaN(limit) || limit < 1) {
    return 30
  }

  return Math.floor(limit)
}

function cleanRefs(refs: string): string[] {
  const trimmed = refs.trim()

  if (!trimmed) {
    return []
  }

  return trimmed
    .replace(/^\(/, '')
    .replace(/\)$/, '')
    .split(',')
    .map((ref) => ref.trim())
    .filter(Boolean)
}

export function parseLogOutput(output: string): GitLogEntry[] {
  return output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.includes(FIELD_SEPARATOR))
    .map((line) => {
      const [graph, shortHash, hash, date, author, refs, message] = line.split(FIELD_SEPARATOR)

      return {
        graph: graph.trimEnd(),
        shortHash,
        hash,
        date,
        author,
        refs: cleanRefs(refs),
        message,
      }
    })
}

function parseNameStatus(output: string): GitCommitDetail['files'] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [status, firstPath, secondPath] = line.split('\t')

      if (status.startsWith('R') || status.startsWith('C')) {
        return {
          status,
          oldPath: firstPath,
          path: secondPath,
        }
      }

      return {
        status,
        path: firstPath,
      }
    })
}

export function parseCommitDetail(metadata: string, files: string): GitCommitDetail {
  const [hash, shortHash, date, author, refs, message, body = ''] = metadata
    .trimEnd()
    .split(FIELD_SEPARATOR)

  return {
    shortHash,
    hash,
    date,
    author,
    refs: cleanRefs(refs),
    message,
    body: body.trim(),
    files: parseNameStatus(files),
  }
}

function truncate(value: string, width: number): string {
  if (value.length <= width) {
    return value
  }

  return `${value.slice(0, Math.max(0, width - 1))}.`
}

function pad(value: string, width: number): string {
  return truncate(value, width).padEnd(width, ' ')
}

export function formatLogTable(entries: GitLogEntry[]): string {
  if (entries.length === 0) {
    return 'No commits found.'
  }

  const rows = entries.map((entry) => {
    const refs = entry.refs.join(', ')

    return [
      pad(entry.graph || '*', 8),
      pad(entry.shortHash, 9),
      pad(entry.date, 10),
      pad(entry.author, 18),
      pad(refs, 26),
      entry.message,
    ].join('  ')
  })

  return [
    [
      pad('Graph', 8),
      pad('Commit', 9),
      pad('Date', 10),
      pad('Author', 18),
      pad('Refs', 26),
      'Message',
    ].join('  '),
    ...rows,
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

function buildLogArgs(argv: LogArgv): string[] {
  const args = [
    'log',
    '--graph',
    '--decorate=short',
    '--date=short',
    '--color=never',
    `--max-count=${normalizeLimit(argv.limit)}`,
    `--pretty=format:${LOG_FORMAT}`,
  ]

  if (argv.noMerges) {
    args.push('--no-merges')
  }

  if (argv.author) {
    args.push(`--author=${argv.author}`)
  }

  if (argv.since) {
    args.push(`--since=${argv.since}`)
  }

  if (argv.until) {
    args.push(`--until=${argv.until}`)
  }

  if (argv.all) {
    args.push('--all')
  } else if (argv.branch) {
    args.push(argv.branch)
  }

  const paths = toArray(argv.path)
  if (paths.length > 0) {
    args.push('--', ...paths)
  }

  return args
}

async function getCommitDetail(git: SimpleGit, commit: string): Promise<GitCommitDetail> {
  const metadata = await git.raw([
    'show',
    '--no-patch',
    '--date=short',
    '--color=never',
    `--pretty=format:${DETAIL_FORMAT}`,
    commit,
  ])
  const files = await git.raw([
    'show',
    '--name-status',
    '--format=',
    '--find-renames',
    '--color=never',
    commit,
  ])

  return parseCommitDetail(metadata, files)
}

export const handler: CommandHandler<LogArgv> = async (argv) => {
  const git = getRepo()
  const mode = argv.interactive ? 'interactive' : 'stdout'
  const format = argv.format === 'json' ? 'json' : 'table'

  if (argv.commit) {
    const detail = await getCommitDetail(git, argv.commit)
    await handleResult({
      result: formatCommitDetail(detail, format),
      mode,
    })
    return
  }

  const output = await git.raw(buildLogArgs(argv))
  const entries = parseLogOutput(output)
  const result = format === 'json' ? JSON.stringify(entries, null, 2) : formatLogTable(entries)

  await handleResult({
    result,
    mode,
  })
}
