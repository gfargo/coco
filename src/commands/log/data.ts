import { SimpleGit } from 'simple-git'
import { extractLfsPatchChange, renderLfsSummary } from '../../git/lfsPointer'
import { extractSubmoduleChange, renderSubmoduleSummary, type SubmoduleChange } from '../../git/submoduleDiff'
import { isEmptyRepo } from '../../lib/simple-git/isEmptyRepo'
import { LogArgv, LogView } from './config'

export const FIELD_SEPARATOR = '\x1f'
// `%P` (parent hashes, space-separated) lets the TUI distinguish
// merge commits (parents.length > 1) from regular commits without a
// second round-trip to git. See #791 stage 3 — merge glyph + HEAD ring.
const LOG_FORMAT = `%x1f%h%x1f%H%x1f%P%x1f%ad%x1f%an%x1f%d%x1f%s`
const DETAIL_FORMAT = `%H%x1f%h%x1f%P%x1f%ad%x1f%an%x1f%d%x1f%s%x1f%b`
export const LOG_DEFAULT_LIMIT = 30
export const LOG_INTERACTIVE_DEFAULT_LIMIT = 300

export type LogRowLoadOptions = {
  limit?: number
  skip?: number
}

export type GitLogCommitRow = {
  type: 'commit'
  graph: string
  shortHash: string
  hash: string
  /**
   * Full parent commit hashes, in order. `parents.length > 1` flags a
   * merge commit; the renderer paints these with `◆` instead of `●`
   * so they stand out from the run of regular commits.
   */
  parents: string[]
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
  /**
   * When the file is a submodule (gitlink) change, the structured
   * `Subproject commit <sha>` extraction (#884). The `hunks` array
   * is already summarized to a single human-readable line; this
   * field carries the raw before/after shas so consumers like the
   * recursive submodule navigation drill-in (#931) can build a
   * concrete `entryRange` without re-running the diff extraction.
   * Undefined for non-submodule files.
   */
  submoduleChange?: SubmoduleChange
}

export function toArray(value: string | string[] | undefined): string[] {
  if (!value) {
    return []
  }

  return Array.isArray(value) ? value : [value]
}

function normalizeLimit(
  limit: number | undefined,
  interactive: boolean | undefined,
  options: LogRowLoadOptions = {}
): number {
  if (options.limit !== undefined) {
    return Math.max(1, Math.floor(options.limit))
  }

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

      const [graph, shortHash, hash, parentsStr, date, author, refs, message] =
        line.split(FIELD_SEPARATOR)

      return {
        type: 'commit',
        graph: graph.trimEnd(),
        shortHash,
        hash,
        parents: parentsStr ? parentsStr.trim().split(' ').filter(Boolean) : [],
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
  const [hash, shortHash, parentsStr, date, author, refs, message, body = ''] = metadata
    .trimEnd()
    .split(FIELD_SEPARATOR)
  const numstat = parseNumstat(numstatOutput)

  return {
    shortHash,
    hash,
    parents: parentsStr ? parentsStr.trim().split(' ').filter(Boolean) : [],
    date,
    author,
    refs: cleanRefs(refs),
    message,
    body: body.trim(),
    files: parseNameStatus(files, numstat),
    stats: summarizeNumstat(numstat),
  }
}

export function buildLogArgs(argv: LogArgv, options: LogRowLoadOptions = {}): string[] {
  const view = getLogView(argv)
  const args = [
    'log',
    '--graph',
    '--decorate=short',
    '--date=short',
    '--color=never',
    `--max-count=${normalizeLimit(argv.limit, argv.interactive, options)}`,
    `--pretty=format:${LOG_FORMAT}`,
  ]

  if (options.skip && options.skip > 0) {
    args.push(`--skip=${Math.floor(options.skip)}`)
  }

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

/**
 * Build merged `LogArgv` for the interactive TUI's `g` graph toggle.
 *
 * The TUI tracks a transient `fullGraph` boolean; toggling it must produce
 * a fresh fetch with the right `view` so the renderer actually has graph
 * topology to draw. When switching to full mode we override `view` to
 * `'full'` (which `buildLogArgs` already maps to `--all`, dropping
 * `--first-parent`/`--no-merges`). When switching back we honor the user's
 * original `view` from argv, defaulting to `'compact'`.
 *
 * Pure helper so the effect that calls it stays trivially testable.
 */
export function buildToggleGraphArgs(argv: LogArgv, fullGraph: boolean): LogArgv {
  if (fullGraph) {
    return { ...argv, view: 'full' }
  }
  return { ...argv, view: argv.view ?? 'compact' }
}

export async function getLogRows(
  git: SimpleGit,
  argv: LogArgv,
  options: LogRowLoadOptions = {}
): Promise<GitLogRow[]> {
  // Unborn HEAD short-circuit. Without this, `git log` on a freshly
  // `git init`'d repo throws "fatal: your current branch 'main' does
  // not have any commits yet" — fine when the caller can catch and
  // translate, painful otherwise (the workstation runtime surfaces it
  // as "Failed to load commits: fatal: ..." in the status line).
  //
  // Returning [] is the natural contract: callers that already render
  // an empty-history surface (`formatLogInkHistoryEmpty`) get the
  // right experience automatically; `coco log` retains its own
  // friendlier message via the handler's isEmptyRepo check.
  if (await isEmptyRepo(git)) {
    return []
  }
  return parseLogOutput(await git.raw(buildLogArgs(argv, options)))
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

  // #884 — replace LFS pointer hunks and submodule "Subproject
  // commit" hunks with one-line summaries. Both detections are
  // mutually exclusive (a file is either LFS-tracked or a
  // submodule, never both) so the priority order doesn't matter;
  // we check LFS first because the pattern is more specific.
  const lfsChange = extractLfsPatchChange(hunks)
  const submoduleChange = lfsChange ? undefined : extractSubmoduleChange(hunks)
  const finalHunks = lfsChange
    ? [renderLfsSummary(lfsChange)]
    : submoduleChange
      ? [renderSubmoduleSummary(submoduleChange)]
      : hunks

  return {
    path: file.path,
    oldPath: file.oldPath,
    stats: {
      additions: file.additions,
      binary: file.binary,
      deletions: file.deletions,
    },
    hunks: finalHunks,
    submoduleChange,
  }
}
