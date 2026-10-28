import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { SimpleGit } from 'simple-git'
import { createHeadlessGit } from '../lib/simple-git/headlessGit'

import { createConcurrencyLimit } from '../lib/utils/createConcurrencyLimit'
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

/**
 * Async twin of `canonicalize` for the discovery path: a stale network
 * mount can park a synchronous `realpathSync` for a long time (#2210).
 */
async function canonicalizeAsync(rootPath: string): Promise<string> {
  const expanded = expandHome(rootPath)
  try {
    return await fsp.realpath(expanded)
  } catch {
    return expanded
  }
}

/** Async twin of `isGitWorkingTree`. */
export async function isGitWorkingTreeAsync(dir: string): Promise<boolean> {
  try {
    const stat = await fsp.lstat(path.join(dir, '.git'))
    return stat.isDirectory() || stat.isFile()
  } catch {
    return false
  }
}

/** How many fs calls the async walk keeps in flight at once. */
const DISCOVERY_FS_CONCURRENCY = 16

/**
 * Async twin of `discoverReposInRoot` (#2210). The synchronous walk ran
 * before the first `await` of `getWorkspaceOverview`, so scanning a big
 * root (bare `coco` from `~`) froze the whole UI, Ctrl-C included, until
 * it finished. Same rules (depth, prune list, hidden dirs, symlink
 * policy, canonical de-dupe, stop at the first repo), but every fs call
 * is a promise bounded by a small limiter, so the event loop keeps
 * turning while it walks.
 */
export async function discoverReposInRootAsync(
  rootPath: string,
  options: WorkspaceDiscoveryOptions = {}
): Promise<string[]> {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH
  const pruneDirs = options.pruneDirs ?? DEFAULT_PRUNE_DIRS
  const followSymlinks = options.followSymlinks ?? false
  const root = expandHome(rootPath)
  const limit = createConcurrencyLimit(DISCOVERY_FS_CONCURRENCY)

  try {
    const rootStat = await limit(() => fsp.stat(root))
    if (!rootStat.isDirectory()) return []
  } catch {
    return []
  }

  const found: string[] = []
  const visited = new Set<string>()

  const walk = async (dir: string, depth: number): Promise<void> => {
    let real: string
    try {
      real = await limit(() => fsp.realpath(dir))
    } catch {
      return
    }
    // Check-and-add happens with no await in between, so concurrent
    // branches can't both claim the same directory.
    if (visited.has(real)) return
    visited.add(real)

    if (await limit(() => isGitWorkingTreeAsync(dir))) {
      found.push(real)
      return
    }
    if (depth >= maxDepth) return

    let entries: fs.Dirent[]
    try {
      entries = await limit(() => fsp.readdir(dir, { withFileTypes: true }))
    } catch {
      return
    }

    await Promise.all(
      entries.map(async (entry) => {
        if (entry.name.startsWith('.') || pruneDirs.has(entry.name)) return
        const child = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          await walk(child, depth + 1)
        } else if (followSymlinks && entry.isSymbolicLink()) {
          try {
            const childStat = await limit(() => fsp.stat(child))
            if (childStat.isDirectory()) await walk(child, depth + 1)
          } catch {
            // Broken symlink — skip silently.
          }
        }
      })
    )
  }

  await walk(root, 0)
  return found
}

/** Async twin of `discoverRepos`: roots walked in parallel, then known repos merged in. */
export async function discoverReposAsync(
  roots: ReadonlyArray<string>,
  knownRepos: ReadonlyArray<string> = [],
  options: WorkspaceDiscoveryOptions = {}
): Promise<string[]> {
  const all = new Set<string>()
  const perRoot = await Promise.all(roots.map((root) => discoverReposInRootAsync(root, options)))
  for (const repos of perRoot) {
    for (const repo of repos) all.add(repo)
  }
  await Promise.all(
    knownRepos.map(async (known) => {
      const resolved = await canonicalizeAsync(known)
      if (await isGitWorkingTreeAsync(resolved)) all.add(resolved)
    })
  )
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

export type ParsedStatusV2 = {
  /** Checked-out branch; `(sha)` when detached; undefined for an unborn HEAD with no name. */
  branch?: string
  ahead: number
  behind: number
  dirty: number
}

/**
 * Parse `git status --porcelain=v2 --branch -z` (#2210). One process
 * answers what used to take `for-each-ref --points-at=HEAD` (which lists
 * EVERY branch at HEAD's commit, sorted by name, so the row could show a
 * sibling branch and compute ahead/behind against its upstream), a
 * status, and a `rev-list`. `branch.head` is the branch actually checked
 * out. With `-z` every record is NUL-terminated and a rename (`2 `) is
 * followed by one extra NUL field holding the original path.
 */
export function parseStatusV2(output: string): ParsedStatusV2 {
  const result: ParsedStatusV2 = { ahead: 0, behind: 0, dirty: 0 }
  let oid: string | undefined
  let head: string | undefined
  const records = output.split('\0')

  for (let i = 0; i < records.length; i += 1) {
    const record = records[i]
    if (record.startsWith('# branch.oid ')) {
      oid = record.slice('# branch.oid '.length)
    } else if (record.startsWith('# branch.head ')) {
      head = record.slice('# branch.head '.length)
    } else if (record.startsWith('# branch.ab ')) {
      const match = /\+(\d+) -(\d+)/.exec(record)
      if (match) {
        result.ahead = Number(match[1])
        result.behind = Number(match[2])
      }
    } else if (record.startsWith('2 ')) {
      result.dirty += 1
      i += 1 // skip the original-path field
    } else if (record.startsWith('1 ') || record.startsWith('u ') || record.startsWith('? ')) {
      result.dirty += 1
    }
  }

  if (head === '(detached)') {
    result.branch = oid && oid !== '(initial)' ? `(${oid.slice(0, 7)})` : undefined
  } else if (head) {
    result.branch = head
  }
  return result
}

/**
 * Resolve a per-repo summary: one `status --porcelain=v2 --branch` for
 * branch, upstream divergence and dirty count, plus the last commit. All
 * errors are caught and reported via `error` so a single unhealthy repo
 * never poisons the workspace.
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

  const git = options.git ?? createHeadlessGit(resolved)

  try {
    const [statusOutput, lastCommitOutput] = await Promise.all([
      git.raw(['status', '--porcelain=v2', '--branch', '-z']),
      git
        .raw([
          'log',
          '-1',
          `--format=%H${FIELD_SEPARATOR}%cI${FIELD_SEPARATOR}%s`,
        ])
        .catch(() => ''),
    ])

    const status = parseStatusV2(statusOutput)
    summary.branch = status.branch
    summary.ahead = status.ahead
    summary.behind = status.behind
    summary.dirty = status.dirty
    summary.lastCommit = parseLastCommit(lastCommitOutput)
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
  const resolvedRoots = await Promise.all(roots.map(canonicalizeAsync))
  const repoPaths = await discoverReposAsync(roots, options.knownRepos ?? [], options)
  const loader = options.loadSummary ?? ((repoPath: string) => getRepoSummary(repoPath))
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY)
  const repos = await mapWithConcurrency(repoPaths, concurrency, loader)
  return {
    roots: resolvedRoots,
    repos,
    scannedAt: new Date().toISOString(),
  }
}
