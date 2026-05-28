import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import simpleGit, { SimpleGit } from 'simple-git'

import { mapWithConcurrency } from '../lib/utils/mapWithConcurrency'

const FIELD_SEPARATOR = '\x1f'

/**
 * Discovery + per-repo summary loader for the workspace surface
 * (#880). The surface lists multiple repos at once; this module
 * walks a configured root, identifies git directories, and pulls a
 * minimal summary per repo so the workspace view can render rows
 * without diving into the full log/history loader stack.
 *
 * Keeps the cost-per-repo small (one batched `for-each-ref` /
 * `status --porcelain` / `log -1` per repo) so a root with a dozen
 * repos stays sub-second on warm fs cache.
 */

export type WorkspaceRepoSummary = {
  /** Absolute, resolved repo path. Stable cache key. */
  path: string
  /** Human label — directory basename unless the caller overrides. */
  name: string
  /** Current branch, or detached-HEAD short hash, or undefined on error. */
  branch?: string
  /** Upstream-tracking divergence. Both 0 when no upstream is set. */
  ahead: number
  behind: number
  /** Number of porcelain entries (unstaged + staged + untracked). */
  dirty: number
  /** Last commit; missing on empty repos. */
  lastCommit?: {
    hash: string
    /** ISO-8601 committer date. */
    date: string
    subject: string
  }
  /** Loader error message — surface should render the row dimmed with the error in the detail pane. */
  error?: string
}

export type WorkspaceDiscoveryOptions = {
  /** Recursion cap from each root. Default 3. */
  maxDepth?: number
  /** Directory names that short-circuit descent. */
  pruneDirs?: ReadonlySet<string>
  /** Follow symlinks during discovery. Default false. */
  followSymlinks?: boolean
}

const DEFAULT_MAX_DEPTH = 3

const DEFAULT_PRUNE_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  '.cache',
  '.next',
  '.nuxt',
  '.turbo',
  '.parcel-cache',
  'dist',
  'build',
  'target',
  'coverage',
  '__pycache__',
  '.venv',
  'venv',
  '.idea',
  '.vscode',
])

/**
 * Expand a user-facing root path. Supports `~` and `~user` prefixes
 * since the config is hand-edited and we don't want users typing
 * absolute paths everywhere. Returns the resolved absolute path; the
 * caller is responsible for the existence check.
 */
export function expandHome(rootPath: string): string {
  if (rootPath === '~') {
    return os.homedir()
  }
  if (rootPath.startsWith('~/')) {
    return path.join(os.homedir(), rootPath.slice(2))
  }
  return path.resolve(rootPath)
}

/**
 * Resolve a path through any symlinks, falling back to the resolved
 * input when the target doesn't exist (so callers can keep going with
 * a sensible best-effort value). This unifies `/var/...` and
 * `/private/var/...` on macOS, plus any user-side `~/code` symlink
 * shenanigans, into a single canonical key.
 */
export function canonicalize(rootPath: string): string {
  const expanded = expandHome(rootPath)
  try {
    return fs.realpathSync(expanded)
  } catch {
    return expanded
  }
}

/**
 * True iff `dir` is a working tree (regular `.git/` directory OR
 * a worktree pointer file). Submodules are also treated as repos —
 * the workspace surface will list them as their own rows so the user
 * can drill in. Bare repos are intentionally skipped (no working
 * tree to summarize).
 */
export function isGitWorkingTree(dir: string): boolean {
  const gitPath = path.join(dir, '.git')
  try {
    const stat = fs.lstatSync(gitPath)
    if (stat.isDirectory()) {
      return true
    }
    if (stat.isFile()) {
      // worktree or submodule pointer
      return true
    }
    return false
  } catch {
    return false
  }
}

/**
 * Walk a single root, returning every directory that looks like a
 * git working tree. Stops descending into a directory as soon as
 * we've identified it as a repo (no point recursing into submodules
 * during discovery — they'd be discovered separately if their
 * containing path is itself a configured root).
 *
 * Discovery is intentionally cheap: pure fs reads, no git invocation.
 */
export function discoverReposInRoot(
  rootPath: string,
  options: WorkspaceDiscoveryOptions = {}
): string[] {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH
  const pruneDirs = options.pruneDirs ?? DEFAULT_PRUNE_DIRS
  const followSymlinks = options.followSymlinks ?? false
  const root = expandHome(rootPath)

  let rootStat: fs.Stats
  try {
    rootStat = fs.statSync(root)
  } catch {
    return []
  }
  if (!rootStat.isDirectory()) {
    return []
  }

  const found: string[] = []
  const visited = new Set<string>()

  const walk = (dir: string, depth: number) => {
    let real: string
    try {
      real = fs.realpathSync(dir)
    } catch {
      return
    }
    if (visited.has(real)) {
      return
    }
    visited.add(real)

    if (isGitWorkingTree(dir)) {
      found.push(real)
      return
    }

    if (depth >= maxDepth) {
      return
    }

    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) {
        continue
      }
      if (pruneDirs.has(entry.name)) {
        continue
      }
      const child = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(child, depth + 1)
      } else if (followSymlinks && entry.isSymbolicLink()) {
        try {
          const childStat = fs.statSync(child)
          if (childStat.isDirectory()) {
            walk(child, depth + 1)
          }
        } catch {
          // Broken symlink — skip silently.
        }
      }
    }
  }

  walk(root, 0)
  return found
}

/**
 * Walk every configured root + merge in user-pinned `knownRepos`.
 * Dedupes by resolved path, drops entries that no longer exist on
 * disk.
 */
export function discoverRepos(
  roots: ReadonlyArray<string>,
  knownRepos: ReadonlyArray<string> = [],
  options: WorkspaceDiscoveryOptions = {}
): string[] {
  const all = new Set<string>()
  for (const root of roots) {
    for (const repo of discoverReposInRoot(root, options)) {
      all.add(repo)
    }
  }
  for (const known of knownRepos) {
    const resolved = canonicalize(known)
    if (isGitWorkingTree(resolved)) {
      all.add(resolved)
    }
  }
  return [...all].sort()
}

export function parseHeadRef(line: string): { branch?: string; upstream?: string } {
  const [branch = '', upstream = ''] = line.split(FIELD_SEPARATOR)
  return {
    branch: branch || undefined,
    upstream: upstream || undefined,
  }
}

export function parseLastCommit(
  line: string
): { hash: string; date: string; subject: string } | undefined {
  const trimmed = line.trim()
  if (!trimmed) {
    return undefined
  }
  const [hash = '', date = '', subject = ''] = trimmed.split(FIELD_SEPARATOR)
  if (!hash) {
    return undefined
  }
  return { hash, date, subject }
}

export function parseDivergence(output: string): { ahead: number; behind: number } {
  const [behind = '0', ahead = '0'] = output.trim().split(/\s+/)
  return {
    ahead: Number.parseInt(ahead, 10) || 0,
    behind: Number.parseInt(behind, 10) || 0,
  }
}

export function countPorcelainEntries(output: string): number {
  return output.split('\n').filter((line) => line.length > 0).length
}

/**
 * Resolve a per-repo summary. One git instance per repo, three
 * batched reads (HEAD ref + status + last commit) plus an optional
 * fourth for upstream divergence. All errors are caught and reported
 * via `error` so a single unhealthy repo never poisons the workspace.
 */
export async function getRepoSummary(
  repoPath: string,
  options: { git?: SimpleGit } = {}
): Promise<WorkspaceRepoSummary> {
  const resolved = path.resolve(repoPath)
  const summary: WorkspaceRepoSummary = {
    path: resolved,
    name: path.basename(resolved),
    ahead: 0,
    behind: 0,
    dirty: 0,
  }

  const git = options.git ?? simpleGit(resolved)

  try {
    const [headOutput, statusOutput, lastCommitOutput] = await Promise.all([
      git.raw([
        'for-each-ref',
        `--format=%(refname:short)${FIELD_SEPARATOR}%(upstream:short)`,
        '--points-at=HEAD',
        'refs/heads',
      ]),
      git.raw(['status', '--porcelain']),
      git
        .raw([
          'log',
          '-1',
          `--format=%H${FIELD_SEPARATOR}%cI${FIELD_SEPARATOR}%s`,
        ])
        .catch(() => ''),
    ])

    const headLine = headOutput.split('\n').map((line) => line.trim()).find(Boolean) || ''
    const parsedHead = parseHeadRef(headLine)

    if (parsedHead.branch) {
      summary.branch = parsedHead.branch
    } else {
      // Detached HEAD — show short hash. Falls back to undefined on
      // an empty repo (no commits yet).
      try {
        const sha = (await git.raw(['rev-parse', '--short', 'HEAD'])).trim()
        summary.branch = sha ? `(${sha})` : undefined
      } catch {
        summary.branch = undefined
      }
    }

    summary.dirty = countPorcelainEntries(statusOutput)
    summary.lastCommit = parseLastCommit(lastCommitOutput)

    if (parsedHead.upstream && parsedHead.branch) {
      try {
        const divergence = await git.raw([
          'rev-list',
          '--left-right',
          '--count',
          `${parsedHead.upstream}...${parsedHead.branch}`,
        ])
        const { ahead, behind } = parseDivergence(divergence)
        summary.ahead = ahead
        summary.behind = behind
      } catch {
        // Upstream might not be fetched locally; treat as 0/0.
      }
    }
  } catch (err) {
    summary.error = err instanceof Error ? err.message : String(err)
  }

  return summary
}

export type WorkspaceOverview = {
  /** Resolved per-root paths that were actually scanned. */
  roots: string[]
  /** Per-repo summary, sorted by path. */
  repos: WorkspaceRepoSummary[]
  /** ISO-8601 timestamp the overview was produced. */
  scannedAt: string
}

export type GetWorkspaceOverviewOptions = WorkspaceDiscoveryOptions & {
  knownRepos?: ReadonlyArray<string>
  /** Override the per-repo loader (used by tests). */
  loadSummary?: (repoPath: string) => Promise<WorkspaceRepoSummary>
  /** Maximum number of repos summarized in parallel. Default 8. */
  concurrency?: number
}

const DEFAULT_CONCURRENCY = 8

export async function getWorkspaceOverview(
  roots: ReadonlyArray<string>,
  options: GetWorkspaceOverviewOptions = {}
): Promise<WorkspaceOverview> {
  const resolvedRoots = roots.map(canonicalize)
  const repoPaths = discoverRepos(roots, options.knownRepos ?? [], options)
  const loader = options.loadSummary ?? ((repoPath: string) => getRepoSummary(repoPath))
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY)
  const repos = await mapWithConcurrency(repoPaths, concurrency, loader)
  return {
    roots: resolvedRoots,
    repos,
    scannedAt: new Date().toISOString(),
  }
}
