import { SimpleGit } from 'simple-git'
import { extractLfsPatchChange, renderLfsSummary } from '../../git/lfsPointer'
import { extractSubmoduleChange, renderSubmoduleSummary, type SubmoduleChange } from '../../git/submoduleDiff'
import { LogArgv, LogView } from './config'

export const FIELD_SEPARATOR = '\x1f'
// `%P` (parent hashes, space-separated) lets the TUI distinguish
// merge commits (parents.length > 1) from regular commits without a
// second round-trip to git. See #791 stage 3 — merge glyph + HEAD ring.
const LOG_FORMAT = `%x1f%h%x1f%H%x1f%P%x1f%ad%x1f%an%x1f%d%x1f%s`
const DETAIL_FORMAT = `%H%x1f%h%x1f%P%x1f%ad%x1f%an%x1f%d%x1f%s%x1f%b`
export const LOG_DEFAULT_LIMIT = 30
// Bumped from 300 → 1000 in 0.54.2. With the full-graph default
// (#1034) the workstation surfaces many more refs (all branches, all
// tags, plus stash commits added via `extraRefs`), and on active repos
// the 300-commit cap was cutting off year+-old stash bases and old
// tag commits — making the cursor-syncs-history effect report "tip
// not in loaded window" instead of moving the graph cursor. 1000
// fits a year of activity for most repos, git log is still sub-200ms,
// and Ink virtualises scroll so render cost stays flat.
export const LOG_INTERACTIVE_DEFAULT_LIMIT = 1000

export type LogRowLoadOptions = {
  limit?: number
  skip?: number
  /**
   * Additional refs / commit hashes to include as graph roots beyond
   * what `--all` covers. The canonical use case is stashes: `git log
   * --all` only includes `refs/stash` (the latest stash; stash@{0}),
   * not older `stash@{N}` entries which live in the stash reflog
   * rather than as refs. Passing their commit hashes here makes them
   * appear as nodes in the loaded graph window, so cursor-syncs from
   * the stash sidebar can actually land somewhere.
   *
   * Appended as positional args at the end of the `git log` command,
   * after the `--all` flag and before any path separator. Each entry
   * should be a resolvable ref / commit hash; the caller is
   * responsible for filtering out invalid values.
   */
  extraRefs?: string[]
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
  // #1622 — an explicit `--view` must win over `--all`'s full-view
  // implication. This relies on `view` having no yargs `default` (see
  // config.ts): `argv.view` is only ever set when the user actually
  // passed `--view`.
  if (argv.view) {
    return argv.view
  }

  if (argv.all) {
    return 'full'
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
    // Viewer-local calendar day, not the committer's recorded offset
    // (#1336): the TUI's Today/Yesterday buckets and the compact `Nd`
    // column compare this against the VIEWER's day, so a committer-tz
    // day (`--date=short`) put fresh commits under "Yesterday" whenever
    // the two zones straddled midnight. Same `YYYY-MM-DD` shape.
    '--date=format-local:%Y-%m-%d',
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

  if (argv.pickaxe) {
    args.push(`-S${argv.pickaxe}`)
  }

  if (argv.grep) {
    args.push(`-G${argv.grep}`)
  }

  // #1618 — message search, distinct from --grep's diff-content search.
  if (argv.message) {
    args.push(`--grep=${argv.message}`)
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

  // Extra refs (stash commits etc.) — append after the --all / branch
  // selector but BEFORE the path separator. Git treats them as
  // additional graph roots, so the traversal includes them alongside
  // whatever --all / --branch already covers.
  if (options.extraRefs && options.extraRefs.length > 0) {
    args.push(...options.extraRefs)
  }

  const paths = toArray(argv.path)
  if (paths.length > 0) {
    args.push('--', ...paths)
  }

  return args
}

/**
 * Default size of a targeted-context window. Sized to comfortably
 * cover a year of activity on most repos so the cursor-sync's
 * "jump to commit anchored on a ref I just selected" can succeed
 * without paginating through the whole history.
 */
export const COMMIT_CONTEXT_DEFAULT_LIMIT = 5000

/**
 * Load a window of commits anchored on a specific hash. Used by the
 * cursor-sync effect when the user selects a ref (branch / tag /
 * stash) whose target commit isn't in the loaded graph window.
 *
 * Critical detail: this walks **only from the target** (and its
 * ancestors), NOT from `--all`. Why: when you combine `--all` with
 * `<targetHash>` AND `--max-count=N`, git unions the walks, sorts
 * the result by date, and slices the newest N rows. If the target
 * is older than the Nth newest commit across all refs (very common
 * for year-old tags / branches on active repos), it falls off the
 * slice even though it was passed as a root. Walking from the
 * target alone guarantees the target IS the first row of the
 * output and its ancestors fill the rest.
 *
 * The caller merges the result via the `appendRows` reducer action
 * which deduplicates by hash, so the target's ancestry slots into
 * the existing `--all` graph cleanly. The user's loaded view ends
 * up as the union of: the original `--all` window + target's
 * ancestry — exactly what's needed for the cursor to land.
 *
 * Capped at `options.limit` (default 5000) to keep one targeted
 * fetch bounded. For most refs, even a 100-commit limit would be
 * enough to surface the target; we go higher to also pull in the
 * surrounding context so the user can scroll around the landed
 * cursor.
 */
export async function getLogRowsAnchoredOn(
  git: SimpleGit,
  argv: LogArgv,
  targetHash: string,
  options: { limit?: number } = {}
): Promise<GitLogRow[]> {
  // Strip every "walk many refs" toggle so buildLogArgs produces a
  // clean `git log <flags> <targetHash>` — exactly the walk that
  // guarantees the target's inclusion.
  const merged: LogArgv = {
    ...argv,
    all: false,
    view: 'compact',  // suppresses 'full' → '--all' mapping
    branch: undefined,
    path: undefined,
  }
  // Also drop --first-parent / --no-merges so the target's ancestry
  // renders with full topology (matters for stash commits which are
  // merges by construction).
  const baseArgs = buildLogArgs(merged, {
    limit: options.limit ?? COMMIT_CONTEXT_DEFAULT_LIMIT,
  }).filter((arg) => arg !== '--first-parent' && arg !== '--no-merges')
  // Splice the target as the positional ref. `buildLogArgs` already
  // appended any `--all`/`--branch`/`<extraRefs>` it considered;
  // since we cleared all those above, the only positional ref we
  // add is the target.
  baseArgs.push(targetHash)
  return parseLogOutput(await git.raw(baseArgs))
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
  // Catch git's "does not have any commits yet" error instead of
  // probing isEmptyRepo before every fetch (#1364 item 5). The probe
  // added a subprocess to every getLogRows call (boot, refresh, each
  // load-more page, graph toggle, filter refetch). Catching the error
  // is O(0) on non-empty repos.
  try {
    return parseLogOutput(await git.raw(buildLogArgs(argv, options)))
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('does not have any commits yet') || message.includes('bad default revision')) {
      return []
    }
    throw err
  }
}

export async function getCommitDetail(git: SimpleGit, commit: string): Promise<GitCommitDetail> {
  const [metadata, files, numstat] = await Promise.all([
    git.raw([
      'show',
      '--no-patch',
      // Same viewer-local day as buildLogArgs (#1336) so the inspector
      // and the history rows never disagree about a commit's date.
      '--date=format-local:%Y-%m-%d',
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
