import { SimpleGit } from 'simple-git'
import { LogArgv, LogView } from './config'

export const FIELD_SEPARATOR = '\x1f'
const LOG_FORMAT = `%x1f%h%x1f%H%x1f%ad%x1f%an%x1f%d%x1f%s`
const DETAIL_FORMAT = `%H%x1f%h%x1f%ad%x1f%an%x1f%d%x1f%s%x1f%b`

export type GitLogCommitRow = {
  type: 'commit'
  graph: string
  shortHash: string
  hash: string
  date: string
  author: string
  refs: string[]
  message: string
}

export type GitLogGraphRow = {
  type: 'graph'
  graph: string
}

export type GitLogRow = GitLogCommitRow | GitLogGraphRow

export type GitCommitDetail = Omit<GitLogCommitRow, 'type' | 'graph'> & {
  body: string
  files: Array<{
    status: string
    path: string
    oldPath?: string
  }>
}

export function toArray(value: string | string[] | undefined): string[] {
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

export function getLogView(argv: LogArgv): LogView {
  if (argv.all) {
    return 'full'
  }

  if (argv.view) {
    return argv.view
  }

  return 'compact'
}

export function getCommitRows(rows: GitLogRow[]): GitLogCommitRow[] {
  return rows.filter((row): row is GitLogCommitRow => row.type === 'commit')
}

export function parseLogOutput(output: string): GitLogRow[] {
  return output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line): GitLogRow => {
      if (!line.includes(FIELD_SEPARATOR)) {
        return {
          type: 'graph',
          graph: line,
        }
      }

      const [graph, shortHash, hash, date, author, refs, message] = line.split(FIELD_SEPARATOR)

      return {
        type: 'commit',
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

export function buildLogArgs(argv: LogArgv): string[] {
  const view = getLogView(argv)
  const args = [
    'log',
    '--graph',
    '--decorate=short',
    '--date=short',
    '--color=never',
    `--max-count=${normalizeLimit(argv.limit)}`,
    `--pretty=format:${LOG_FORMAT}`,
  ]

  if (view === 'compact') {
    args.push('--first-parent')
  }

  if (view === 'compact' && !argv.merges) {
    args.push('--no-merges')
  } else if (argv.noMerges) {
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

  if (view === 'full' || argv.all) {
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

export async function getLogRows(git: SimpleGit, argv: LogArgv): Promise<GitLogRow[]> {
  return parseLogOutput(await git.raw(buildLogArgs(argv)))
}

export async function getCommitDetail(git: SimpleGit, commit: string): Promise<GitCommitDetail> {
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
