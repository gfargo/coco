import { SimpleGit } from 'simple-git'
import { LogArgv, LogView } from './config'

export const FIELD_SEPARATOR = '\x1f'
const LOG_FORMAT = `%x1f%h%x1f%H%x1f%ad%x1f%an%x1f%d%x1f%s`
const DETAIL_FORMAT = `%H%x1f%h%x1f%ad%x1f%an%x1f%d%x1f%s%x1f%b`
export const LOG_DEFAULT_LIMIT = 30
export const LOG_INTERACTIVE_DEFAULT_LIMIT = 300

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
    additions?: number
    binary?: boolean
    deletions?: number
    status: string
    path: string
    oldPath?: string
  }>
  stats: {
    filesChanged: number
    insertions: number
    deletions: number
  }
}

export type GitCommitFilePreview = {
  path: string
  oldPath?: string
  stats: {
    additions?: number
    binary?: boolean
    deletions?: number
  }
  hunks: string[]
}

export function toArray(value: string | string[] | undefined): string[] {
  if (!value) {
    return []
  }

  return Array.isArray(value) ? value : [value]
}

function normalizeLimit(limit: number | undefined, interactive: boolean | undefined): number {
  if (!limit || Number.isNaN(limit) || limit < 1) {
    return interactive ? LOG_INTERACTIVE_DEFAULT_LIMIT : LOG_DEFAULT_LIMIT
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

type ParsedNumstat = {
  additions?: number
  binary?: boolean
  deletions?: number
  path: string
}

function parseNumericStat(value: string): number | undefined {
  return value === '-' ? undefined : Number(value)
}

function parseNumstat(output: string): ParsedNumstat[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [additions, deletions, path] = line.split('\t')

      return {
        additions: parseNumericStat(additions),
        binary: additions === '-' || deletions === '-',
        deletions: parseNumericStat(deletions),
        path,
      }
    })
}

function summarizeNumstat(entries: ParsedNumstat[]): GitCommitDetail['stats'] {
  return entries.reduce<GitCommitDetail['stats']>((summary, entry) => ({
    filesChanged: summary.filesChanged + 1,
    insertions: summary.insertions + (entry.additions || 0),
    deletions: summary.deletions + (entry.deletions || 0),
  }), {
    filesChanged: 0,
    insertions: 0,
    deletions: 0,
  })
}

function parseNameStatus(output: string, numstat: ParsedNumstat[] = []): GitCommitDetail['files'] {
  const statsByPath = new Map(numstat.map((entry) => [entry.path, entry]))

  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [status, firstPath, secondPath] = line.split('\t')

      if (status.startsWith('R') || status.startsWith('C')) {
        const stats = statsByPath.get(secondPath) || statsByPath.get(`${firstPath} => ${secondPath}`)

        return {
          additions: stats?.additions,
          binary: stats?.binary,
          deletions: stats?.deletions,
          status,
          oldPath: firstPath,
          path: secondPath,
        }
      }
      const stats = statsByPath.get(firstPath)

      return {
        additions: stats?.additions,
        binary: stats?.binary,
        deletions: stats?.deletions,
        status,
        path: firstPath,
      }
    })
}

export function parseCommitDetail(metadata: string, files: string, numstatOutput = ''): GitCommitDetail {
  const [hash, shortHash, date, author, refs, message, body = ''] = metadata
    .trimEnd()
    .split(FIELD_SEPARATOR)
  const numstat = parseNumstat(numstatOutput)

  return {
    shortHash,
    hash,
    date,
    author,
    refs: cleanRefs(refs),
    message,
    body: body.trim(),
    files: parseNameStatus(files, numstat),
    stats: summarizeNumstat(numstat),
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
    `--max-count=${normalizeLimit(argv.limit, argv.interactive)}`,
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
  const [metadata, files, numstat] = await Promise.all([
    git.raw([
      'show',
      '--no-patch',
      '--date=short',
      '--color=never',
      `--pretty=format:${DETAIL_FORMAT}`,
      commit,
    ]),
    git.raw([
      'show',
      '--name-status',
      '--format=',
      '--find-renames',
      '--color=never',
      commit,
    ]),
    git.raw([
      'show',
      '--numstat',
      '--format=',
      '--find-renames',
      '--color=never',
      commit,
    ]),
  ])

  return parseCommitDetail(metadata, files, numstat)
}

export async function getCommitFilePreview(
  git: SimpleGit,
  commit: string,
  file: GitCommitDetail['files'][number],
  limit = 40
): Promise<GitCommitFilePreview> {
  const paths = file.oldPath ? [file.oldPath, file.path] : [file.path]
  const patch = await git.raw([
    'show',
    '--format=',
    '--find-renames',
    '--color=never',
    '--unified=3',
    commit,
    '--',
    ...paths,
  ])
  const hunks = patch
    .split('\n')
    .filter((line) => (
      line.startsWith('@@') ||
      line.startsWith('+') ||
      line.startsWith('-') ||
      line.startsWith(' ')
    ))
    .slice(0, limit)

  return {
    path: file.path,
    oldPath: file.oldPath,
    stats: {
      additions: file.additions,
      binary: file.binary,
      deletions: file.deletions,
    },
    hunks,
  }
}
