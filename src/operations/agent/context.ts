import { execFile, ExecFileException } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import * as path from 'node:path'
import { promisify } from 'node:util'
import { SimpleGit } from 'simple-git'

import type { LlmUsageSurface } from '../../lib/langchain/utils/observability'
import { getRepo } from '../../lib/simple-git/getRepo'
import { Logger } from '../../lib/utils/logger'
import { isPathWithinRoot } from '../../lib/utils/pathWithinRoot'
import { AgentOperationError } from './errors'
import { ChangeSource, MAX_AGENT_CONTEXT_BYTES, MAX_CONVENTIONS_BYTES, SourceMetadata } from './schemas'

// Re-export so existing importers (mcp/server.ts, context.test.ts) continue to
// resolve from this module without changes.
export { isPathWithinRoot } from '../../lib/utils/pathWithinRoot'

/**
 * Transport-agnostic progress callback. Operations report coarse stage
 * boundaries and (when streaming) chunk ticks through this plain function;
 * only `src/mcp/server.ts` knows how to turn it into an MCP notification, so
 * `src/operations/agent/` never imports the MCP SDK.
 */
export type AgentProgressReporter = (update: { message?: string; fraction?: number }) => void

export type AgentOperationContext = {
  repoRoot: string
  git: SimpleGit
  logger: Logger
  surface: LlmUsageSurface
  signal?: AbortSignal
  cleanFilterProbe?: Promise<CleanFilterProbeResult>
  onProgress?: AgentProgressReporter
}

type CleanFilterProbeResult =
  | { blocked: false }
  | { blocked: true, filter: string }

export type ResolvedChangeContext = {
  text: string
  meta: SourceMetadata
}

const execFileAsync = promisify(execFile)

function isMaxBufferError(error: unknown): boolean {
  return (error as ExecFileException)?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
}

async function runGitAtPath(
  cwd: string,
  args: string[],
  signal?: AbortSignal,
): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', [
      '--no-optional-locks',
      '-c', 'core.fsmonitor=false',
      '-c', 'diff.external=',
      ...args,
    ], {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_OPTIONAL_LOCKS: '0',
      },
      maxBuffer: MAX_AGENT_CONTEXT_BYTES + 64 * 1024,
      signal,
    })
    return stdout
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
      throw new AgentOperationError('CANCELLED', 'Operation was cancelled.', false)
    }
    if (isMaxBufferError(error)) {
      throw new AgentOperationError(
        'CONTEXT_TOO_LARGE',
        `Resolved change context exceeds the ${MAX_AGENT_CONTEXT_BYTES}-byte limit. Supply a consolidated summary instead.`,
      )
    }
    throw error
  }
}

function runAgentGit(context: AgentOperationContext, args: string[]): Promise<string> {
  return runGitAtPath(context.repoRoot, args, context.signal)
}

export function digestOf(text: string): string {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`
}

// isPathWithinRoot is now defined in lib/utils/pathWithinRoot and re-exported
// at the top of this file so all existing importers continue to work.

const CONVENTION_FILE_ALLOWLIST = ['AGENTS.md', 'CLAUDE.md', 'CONTRIBUTING.md']
const STEERING_DIRECTORY = path.join('.kiro', 'steering')

export type ProjectConventions = {
  text: string
  digest: string
  files: string[]
}

/**
 * A char-index slice can land inside a UTF-16 surrogate pair, leaving a
 * trailing lone high surrogate that JSON.stringify serializes as an
 * unpaired `\ud...` escape -- rejected by strict providers. Mirrors
 * `enforcePromptBudget`'s helper of the same name.
 */
function stripTrailingHighSurrogate(value: string): string {
  return /[\uD800-\uDBFF]$/.test(value) ? value.slice(0, -1) : value
}

function truncateToByteBudget(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text

  let low = 0
  let high = text.length
  let best = ''
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const candidate = stripTrailingHighSurrogate(text.slice(0, mid))
    if (Buffer.byteLength(candidate, 'utf8') <= maxBytes) {
      best = candidate
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return best
}

function listSteeringFiles(root: string): string[] {
  const steeringDir = path.join(root, STEERING_DIRECTORY)
  let entries: string[]
  try {
    entries = readdirSync(steeringDir)
  } catch {
    return []
  }
  return entries
    .filter((entry) => entry.toLowerCase().endsWith('.md'))
    .sort()
    .map((entry) => path.join(STEERING_DIRECTORY, entry))
}

/**
 * Reads a fixed allowlist of repository convention files (house style,
 * agent steering docs, contribution guidelines) into a single
 * hash-provenanced block. Bounded to `MAX_CONVENTIONS_BYTES` so this text
 * can't crowd out the diff in the downstream prompt budget. Callers gate
 * this behind `trustRepositoryConfig` -- see `getConventionsContext`.
 */
const CONVENTIONS_SECTION_SEPARATOR = '\n\n'
const CONVENTIONS_SECTION_SEPARATOR_BYTES = Buffer.byteLength(CONVENTIONS_SECTION_SEPARATOR, 'utf8')

export function resolveProjectConventions(root: string): ProjectConventions | null {
  const relativePaths = [...CONVENTION_FILE_ALLOWLIST, ...listSteeringFiles(root)]
  const parts: string[] = []
  const files: string[] = []
  let remainingBytes = MAX_CONVENTIONS_BYTES

  for (const relativePath of relativePaths) {
    // Every section after the first costs an extra separator when joined below,
    // so that cost must be reserved from the budget before truncating the section.
    const separatorBytes = parts.length > 0 ? CONVENTIONS_SECTION_SEPARATOR_BYTES : 0
    if (remainingBytes <= separatorBytes) break

    const candidate = path.join(root, relativePath)
    if (!isPathWithinRoot(candidate, root)) continue

    let stats
    try {
      stats = statSync(candidate)
    } catch {
      continue
    }
    if (!stats.isFile()) continue

    let content: string
    try {
      content = readFileSync(candidate, 'utf8')
    } catch {
      continue
    }

    const posixPath = relativePath.split(path.sep).join('/')
    const section = truncateToByteBudget(`## ${posixPath}\n\n${content.trim()}`, remainingBytes - separatorBytes)
    if (!section.trim()) continue

    parts.push(section)
    files.push(posixPath)
    remainingBytes -= separatorBytes + Buffer.byteLength(section, 'utf8')
  }

  if (parts.length === 0) return null

  const text = parts.join(CONVENTIONS_SECTION_SEPARATOR)
  return {
    text,
    digest: `sha256:${createHash('sha256').update(text).digest('hex')}`,
    files,
  }
}

export type ConventionsProvenance = {
  digest: string
  files: string[]
}

export type ConventionsContext = {
  text: string
  provenance: ConventionsProvenance | null
}

/**
 * Builds the `conventions_context` prompt variable (#1956). Repository
 * convention files are repository-controlled text entering the prompt, so
 * this only reads them when the caller has explicitly trusted repository
 * configuration -- MCP tools reject `trustRepositoryConfig`, so they never
 * reach this path. `provenance` is null (and `text` is `''`) when untrusted
 * or nothing was found, mirroring how `language_context` and
 * `branch_name_context` degrade to an empty string.
 */
export function getConventionsContext(root: string, trustRepositoryConfig: boolean | undefined): ConventionsContext {
  if (!trustRepositoryConfig) return { text: '', provenance: null }

  const conventions = resolveProjectConventions(root)
  if (!conventions) return { text: '', provenance: null }

  return {
    text: `Follow these project conventions where they apply:\n\n${conventions.text}`,
    provenance: { digest: conventions.digest, files: conventions.files },
  }
}

export function resolveAgentDirectoryRoot(directory: string): string {
  const requested = path.resolve(directory)
  let resolved: string
  try {
    resolved = realpathSync(requested)
    if (!statSync(resolved).isDirectory()) {
      throw new Error('not a directory')
    }
  } catch {
    throw new AgentOperationError('INVALID_REPOSITORY', `Repository path is not a directory: ${requested}`)
  }
  return resolved
}

export async function resolveAgentRepoRoot(
  repo?: string,
  allowedRoot?: string,
  signal?: AbortSignal,
): Promise<string> {
  const requested = resolveAgentDirectoryRoot(repo || allowedRoot || process.cwd())
  const boundary = allowedRoot ? resolveAgentDirectoryRoot(allowedRoot) : undefined

  if (boundary && !isPathWithinRoot(requested, boundary)) {
    throw new AgentOperationError(
      'REPOSITORY_OUTSIDE_ROOT',
      `Repository '${requested}' is outside the allowed root '${boundary}'.`,
    )
  }

  let repoRoot: string
  try {
    const topLevel = await runGitAtPath(requested, ['rev-parse', '--show-toplevel'], signal)
    repoRoot = resolveAgentDirectoryRoot(topLevel.trim())
  } catch (error) {
    if (error instanceof AgentOperationError && error.code === 'CANCELLED') throw error
    throw new AgentOperationError('INVALID_REPOSITORY', `Not a git repository: ${requested}`)
  }

  if (boundary && !isPathWithinRoot(repoRoot, boundary)) {
    throw new AgentOperationError(
      'REPOSITORY_OUTSIDE_ROOT',
      `Repository '${repoRoot}' is outside the allowed root '${boundary}'.`,
    )
  }

  return repoRoot
}

export async function createAgentOperationContext(input: {
  repoRoot: string
  signal?: AbortSignal
  surface?: LlmUsageSurface
  onProgress?: AgentProgressReporter
}): Promise<AgentOperationContext> {
  const repoRoot = await resolveAgentRepoRoot(input.repoRoot, undefined, input.signal)
  const git = getRepo(repoRoot)
  return {
    repoRoot,
    git,
    surface: input.surface ?? 'agent-cli',
    signal: input.signal,
    onProgress: input.onProgress,
    logger: new Logger({ silent: true }),
  }
}

async function resolveCommitRevision(
  context: AgentOperationContext,
  revision: string,
): Promise<string> {
  if (revision.startsWith('-') || revision.includes('\0')) {
    throw new AgentOperationError('INVALID_REVISION', `Unsafe git revision: ${JSON.stringify(revision)}`)
  }

  try {
    const resolved = await runAgentGit(context, [
      'rev-parse',
      '--verify',
      '--end-of-options',
      `${revision}^{commit}`,
    ])
    return resolved.trim()
  } catch (error) {
    if (error instanceof AgentOperationError && error.code === 'CANCELLED') throw error
    throw new AgentOperationError('INVALID_REVISION', `Git revision could not be resolved: ${revision}`)
  }
}

const CLEAN_FILTER_CONFIG_PATTERN = String.raw`^filter\..*\.clean$`
const CLEAN_FILTER_CONFIG_KEY_PATTERN = /^filter\.(.+)\.clean$/
const CHECK_ATTR_BATCH_SIZE = 200

// Determines whether the repository defines a `clean` filter AND assigns it to a tracked
// path. Only that combination can cause `git diff` against the worktree to execute
// arbitrary repository-defined commands; a filter that is merely configured but never
// assigned to a path is inert.
async function probeCleanFilters(context: AgentOperationContext): Promise<CleanFilterProbeResult> {
  let configOutput: string
  try {
    configOutput = await runAgentGit(context, ['config', '--get-regexp', CLEAN_FILTER_CONFIG_PATTERN])
  } catch (error) {
    if (error instanceof AgentOperationError && error.code === 'CANCELLED') throw error
    // `git config --get-regexp` exits with status 1 specifically when nothing matches;
    // that is the only exit code execFile surfaces as an error that we can treat as
    // "no filters configured". Any other failure (corrupted config, git binary issues,
    // unexpected git version behavior) means we could not verify safety, so fail closed
    // instead of silently allowing the worktree diff to proceed.
    const exitCode = (error as ExecFileException)?.code
    if (exitCode === 1) return { blocked: false }
    throw new AgentOperationError(
      'UNSAFE_SOURCE',
      `Could not verify the repository is free of clean filters (${error instanceof Error ? error.message : String(error)}). Supply a patch/summary or explicitly trust repository configuration in the one-shot agent CLI.`,
    )
  }

  const configuredFilters = new Map<string, string>()
  for (const line of configOutput.split('\n')) {
    const spaceIndex = line.indexOf(' ')
    if (spaceIndex === -1) continue
    const key = line.slice(0, spaceIndex)
    const match = CLEAN_FILTER_CONFIG_KEY_PATTERN.exec(key)
    if (match) configuredFilters.set(match[1], key)
  }
  if (configuredFilters.size === 0) return { blocked: false }

  const trackedFilesOutput = await runAgentGit(context, ['ls-files', '-z'])
  const trackedFiles = trackedFilesOutput.split('\0').filter(Boolean)
  if (trackedFiles.length === 0) return { blocked: false }

  for (let offset = 0; offset < trackedFiles.length; offset += CHECK_ATTR_BATCH_SIZE) {
    const batch = trackedFiles.slice(offset, offset + CHECK_ATTR_BATCH_SIZE)
    const output = await runAgentGit(context, ['check-attr', '-z', 'filter', '--', ...batch])
    const fields = output.split('\0')
    for (let i = 0; i + 2 < fields.length; i += 3) {
      const assignedFilter = fields[i + 2]
      const configKey = configuredFilters.get(assignedFilter)
      if (configKey) return { blocked: true, filter: configKey }
    }
  }

  return { blocked: false }
}

async function repositoryText(
  source: Extract<ChangeSource, { kind: 'repository' }>,
  context: AgentOperationContext,
  trustRepositoryConfig: boolean,
) {
  const safeDiffOptions = ['--no-ext-diff', '--no-textconv']
  switch (source.scope.type) {
    case 'staged':
      return runAgentGit(context, ['diff', '--cached', ...safeDiffOptions, '--'])
    case 'worktree': {
      if (!trustRepositoryConfig) {
        context.cleanFilterProbe ??= probeCleanFilters(context)
        const probe = await context.cleanFilterProbe
        if (probe.blocked) {
          throw new AgentOperationError(
            'UNSAFE_SOURCE',
            `Repository defines clean filter '${probe.filter}' which git would execute during worktree inspection. Supply a patch/summary or explicitly trust repository configuration in the one-shot agent CLI.`,
          )
        }
      }
      const [staged, unstaged, untrackedFiles] = await Promise.all([
        runAgentGit(context, ['diff', '--cached', ...safeDiffOptions, '--']),
        runAgentGit(context, ['diff', ...safeDiffOptions, '--']),
        runAgentGit(context, ['ls-files', '--others', '--exclude-standard']),
      ])
      const untracked = untrackedFiles.trim()
        ? `Untracked files:\n${untrackedFiles.trim().split('\n').map((file) => `- ${file}`).join('\n')}`
        : ''
      return [staged && `Staged changes:\n${staged}`, unstaged && `Unstaged changes:\n${unstaged}`, untracked]
        .filter(Boolean)
        .join('\n\n')
    }
    case 'branch': {
      const base = await resolveCommitRevision(context, source.scope.base)
      const head = await resolveCommitRevision(context, source.scope.head || 'HEAD')
      return runAgentGit(context, ['diff', ...safeDiffOptions, `${base}..${head}`, '--'])
    }
    case 'range': {
      const from = await resolveCommitRevision(context, source.scope.from)
      const to = await resolveCommitRevision(context, source.scope.to)
      return runAgentGit(context, ['diff', ...safeDiffOptions, `${from}..${to}`, '--'])
    }
  }
}

function providedText(source: Exclude<ChangeSource, { kind: 'repository' }>): string {
  if (source.kind === 'patch') return source.patch
  if (source.kind === 'summary') {
    const files = source.files?.length
      ? `\n\nFiles:\n${source.files.map((file) => `- ${file.status ? `${file.status}: ` : ''}${file.path}`).join('\n')}`
      : ''
    return `${source.summary}${files}`
  }

  const parts: string[] = []
  let formattedBytes = 0
  for (const file of source.files) {
    const heading = `${file.status}: ${file.oldPath ? `${file.oldPath} -> ` : ''}${file.path}`
    const part = `${heading}\n${file.summary || file.patch || ''}`
    const separator = parts.length > 0 ? '\n\n---\n\n' : ''
    formattedBytes += Buffer.byteLength(separator, 'utf8') + Buffer.byteLength(part, 'utf8')
    if (formattedBytes > MAX_AGENT_CONTEXT_BYTES) {
      throw new AgentOperationError(
        'CONTEXT_TOO_LARGE',
        `Resolved change context exceeds the ${MAX_AGENT_CONTEXT_BYTES}-byte limit. Supply a consolidated summary instead.`,
      )
    }
    parts.push(part)
  }
  return parts.join('\n\n---\n\n')
}

export async function resolveChangeSource(
  source: ChangeSource,
  context: AgentOperationContext,
  options: { trustRepositoryConfig?: boolean } = {},
): Promise<ResolvedChangeContext> {
  if (context.signal?.aborted) {
    throw new AgentOperationError('CANCELLED', 'Operation was cancelled.', false)
  }

  const providedHead = source.kind === 'patch'
    ? source.headRevision
    : source.kind === 'files' || source.kind === 'summary'
    ? source.provenance?.headRevision
    : undefined
  const shouldReadRepositoryHead = source.kind === 'repository' || Boolean(providedHead)
  const repositoryHead = shouldReadRepositoryHead
    ? await runAgentGit(context, ['rev-parse', 'HEAD']).then((value) => value.trim()).catch(() => undefined)
    : undefined
  const text = source.kind === 'repository'
    ? await repositoryText(source, context, options.trustRepositoryConfig === true)
    : providedText(source)

  if (!text.trim()) {
    throw new AgentOperationError('NO_CHANGES', 'No changes were found for the requested source.')
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_AGENT_CONTEXT_BYTES) {
    throw new AgentOperationError(
      'CONTEXT_TOO_LARGE',
      `Resolved change context exceeds the ${MAX_AGENT_CONTEXT_BYTES}-byte limit. Supply a consolidated summary instead.`,
    )
  }

  return {
    text,
    meta: {
      kind: source.kind,
      digest: digestOf(text),
      repositoryHead,
      verification: source.kind === 'repository'
        ? 'repository-derived'
        : providedHead && repositoryHead && providedHead === repositoryHead
        ? 'head-matched'
        : 'provided-unverified',
    },
  }
}

const MAX_RECENT_LOG_COUNT = 20

export function getRepoStatus(context: AgentOperationContext): Promise<string> {
  return runAgentGit(context, ['status', '--porcelain=v1', '-b'])
}

export function getStagedDiff(context: AgentOperationContext): Promise<string> {
  return runAgentGit(context, ['diff', '--cached', '--no-ext-diff', '--no-textconv', '--'])
}

export async function getBranchContext(context: AgentOperationContext): Promise<string> {
  const branch = (await runAgentGit(context, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
  const lines = [`Branch: ${branch}`]

  let upstream: string | undefined
  try {
    upstream = (await runAgentGit(
      context,
      ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
    )).trim()
  } catch (error) {
    if (error instanceof AgentOperationError && error.code === 'CANCELLED') throw error
    lines.push('Upstream: none configured')
  }

  if (upstream) {
    lines.push(`Upstream: ${upstream}`)
    try {
      const counts = (await runAgentGit(
        context,
        ['rev-list', '--left-right', '--count', `${upstream}...HEAD`],
      )).trim()
      const [behind, ahead] = counts.split(/\s+/)
      lines.push(`Ahead: ${ahead}`, `Behind: ${behind}`)
    } catch (error) {
      if (error instanceof AgentOperationError && error.code === 'CANCELLED') throw error
      lines.push('Ahead/Behind: unavailable (git error)')
    }
  }

  return lines.join('\n')
}

export function getRecentLog(context: AgentOperationContext, count = MAX_RECENT_LOG_COUNT): Promise<string> {
  const bounded = Math.max(1, Math.min(count, MAX_RECENT_LOG_COUNT))
  return runAgentGit(context, ['log', '--oneline', '-n', String(bounded)])
}

// ─── Hardened repo-context readers ───────────────────────────────────────────
// These functions run all git commands through runAgentGit (which enforces
// --no-optional-locks, -c diff.external=, -c core.fsmonitor=false) and
// delegate parsing to the pure functions in src/git/.

import { parsePorcelainStatus } from '../../git/statusData'
import { parseConflictedFiles } from '../../git/operationData'
import { parseDivergence } from '../../git/branchData'
import {
  COMMITLINT_CONFIG_FILES,
} from '../../lib/config/commitlint'
import {
  existsSync,
  readFileSync as fsReadFileSync,
  statSync as fsStatSync,
} from 'node:fs'
import { join as pathJoin, resolve as pathResolve } from 'node:path'

import type {
  RepoContextBranch,
  RepoContextCapabilities,
  RepoContextConflicts,
  RepoContextFileEntry,
  RepoContextHistory,
  RepoContextHistoryEntry,
  RepoContextStatus,
} from './schemas'

/** Default caps for section lists */
const STATUS_CAP = 200
const HISTORY_CAP = 50
const CONFLICT_FILES_CAP = 50

/**
 * Parse NUL-separated numstat output into a map of path → { additions, deletions }.
 * Format: `<additions>\t<deletions>\t<path>\0` (or `<adds>\t<dels>\t\0<dest>\0<src>\0` for renames).
 */
function parseNumstat(output: string): Map<string, { additions: number; deletions: number }> {
  const result = new Map<string, { additions: number; deletions: number }>()
  const tokens = output.split('\0').filter(Boolean)

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    // Rename entry: `<adds>\t<dels>\t` followed by empty string, then dest, then src
    if (token.match(/^\d+\t\d+\t$/) || token.match(/^-\t-\t$/)) {
      // rename: next two tokens are dest path and src path
      const dest = tokens[i + 1]
      // skip the source path
      i += 2
      const [adds, dels] = token.split('\t')
      if (dest) {
        result.set(dest, {
          additions: adds === '-' ? 0 : parseInt(adds, 10),
          deletions: dels === '-' ? 0 : parseInt(dels, 10),
        })
      }
    } else {
      // Normal entry: `<adds>\t<dels>\t<path>`
      const tabIdx = token.indexOf('\t')
      const tabIdx2 = token.indexOf('\t', tabIdx + 1)
      if (tabIdx === -1 || tabIdx2 === -1) continue
      const adds = token.slice(0, tabIdx)
      const dels = token.slice(tabIdx + 1, tabIdx2)
      const filePath = token.slice(tabIdx2 + 1)
      if (filePath) {
        result.set(filePath, {
          additions: adds === '-' ? 0 : parseInt(adds, 10),
          deletions: dels === '-' ? 0 : parseInt(dels, 10),
        })
      }
    }
  }

  return result
}

/**
 * Read branch context via hardened git and return the structured branch section.
 * Degrades gracefully on detached HEAD, no upstream, missing origin/HEAD, etc.
 */
export async function readRepoBranchContext(context: AgentOperationContext): Promise<RepoContextBranch> {
  // Get current branch / detect detached
  let current: string
  let detached: boolean

  try {
    const abbrev = (await runAgentGit(context, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
    if (abbrev === 'HEAD') {
      // Detached — use short SHA for display
      const sha = (await runAgentGit(context, ['rev-parse', '--short', 'HEAD'])).trim()
      current = sha || 'HEAD'
      detached = true
    } else {
      current = abbrev
      detached = false
    }
  } catch (error) {
    if (error instanceof AgentOperationError && error.code === 'CANCELLED') throw error
    // Empty repo / no commits
    return { current: 'HEAD', detached: true }
  }

  // Upstream
  let upstream: string | undefined
  let ahead: number | undefined
  let behind: number | undefined

  if (!detached) {
    try {
      upstream = (await runAgentGit(
        context,
        ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
      )).trim()
    } catch (error) {
      if (error instanceof AgentOperationError && error.code === 'CANCELLED') throw error
      upstream = undefined
    }

    if (upstream) {
      try {
        const counts = (await runAgentGit(
          context,
          ['rev-list', '--left-right', '--count', `${upstream}...HEAD`],
        )).trim()
        const divergence = parseDivergence(counts)
        ahead = divergence.ahead
        behind = divergence.behind
      } catch (error) {
        if (error instanceof AgentOperationError && error.code === 'CANCELLED') throw error
        // Divergence unavailable — leave undefined
      }
    }
  }

  // Default branch (pure local refs, no network)
  let defaultBranch: string | undefined
  try {
    const ref = (await runAgentGit(context, ['symbolic-ref', 'refs/remotes/origin/HEAD'])).trim()
    const match = ref.match(/^refs\/remotes\/origin\/(.+)$/)
    if (match) defaultBranch = match[1]
  } catch (error) {
    if (error instanceof AgentOperationError && error.code === 'CANCELLED') throw error
    // origin/HEAD not set — try conventional names
    for (const candidate of ['main', 'master', 'develop', 'trunk']) {
      try {
        await runAgentGit(context, ['rev-parse', '--verify', '--quiet', `refs/heads/${candidate}`])
        defaultBranch = candidate
        break
      } catch (err) {
        if (err instanceof AgentOperationError && err.code === 'CANCELLED') throw err
      }
    }
  }

  return {
    current,
    upstream,
    ahead,
    behind,
    detached,
    ...(defaultBranch !== undefined ? { defaultBranch } : {}),
  }
}

/**
 * Read working-tree status via hardened git and return the structured status section.
 * Files are capped at STATUS_CAP per category; numstat provides add/del counts.
 */
export async function readRepoStatusContext(context: AgentOperationContext): Promise<RepoContextStatus> {
  const [statusOutput, stagedNumstatOutput, unstagedNumstatOutput] = await Promise.all([
    runAgentGit(context, ['status', '--porcelain=v1', '-z']).catch((err) => {
      if (err instanceof AgentOperationError && err.code === 'CANCELLED') throw err
      return ''
    }),
    runAgentGit(context, ['diff', '--cached', '--numstat', '-z', '--']).catch((err) => {
      if (err instanceof AgentOperationError && err.code === 'CANCELLED') throw err
      return ''
    }),
    runAgentGit(context, ['diff', '--numstat', '-z', '--']).catch((err) => {
      if (err instanceof AgentOperationError && err.code === 'CANCELLED') throw err
      return ''
    }),
  ])

  const files = parsePorcelainStatus(statusOutput)
  const conflictedFiles = parseConflictedFiles(statusOutput)
  const conflictedPaths = new Set(conflictedFiles.map((f) => f.path))

  const stagedNumstat = parseNumstat(stagedNumstatOutput)
  const unstagedNumstat = parseNumstat(unstagedNumstatOutput)

  const staged: RepoContextFileEntry[] = []
  const unstaged: RepoContextFileEntry[] = []
  const untracked: RepoContextFileEntry[] = []
  const conflicted: RepoContextFileEntry[] = []

  for (const file of files) {
    if (conflictedPaths.has(file.path)) {
      if (conflicted.length < STATUS_CAP) {
        conflicted.push({
          path: file.path,
          indexStatus: file.indexStatus,
          worktreeStatus: file.worktreeStatus,
        })
      }
      continue
    }

    if (file.state === 'staged') {
      if (staged.length < STATUS_CAP) {
        const ns = stagedNumstat.get(file.path)
        staged.push({
          path: file.path,
          indexStatus: file.indexStatus,
          worktreeStatus: file.worktreeStatus,
          ...(ns !== undefined ? { additions: ns.additions, deletions: ns.deletions } : {}),
        })
      }
    } else if (file.state === 'unstaged') {
      if (unstaged.length < STATUS_CAP) {
        const ns = unstagedNumstat.get(file.path)
        unstaged.push({
          path: file.path,
          indexStatus: file.indexStatus,
          worktreeStatus: file.worktreeStatus,
          ...(ns !== undefined ? { additions: ns.additions, deletions: ns.deletions } : {}),
        })
      }
    } else if (file.state === 'untracked') {
      if (untracked.length < STATUS_CAP) {
        untracked.push({
          path: file.path,
          indexStatus: file.indexStatus,
          worktreeStatus: file.worktreeStatus,
        })
      }
    }
  }

  const totalStaged = files.filter((f) => f.state === 'staged' && !conflictedPaths.has(f.path)).length
  const totalUnstaged = files.filter((f) => f.state === 'unstaged' && !conflictedPaths.has(f.path)).length
  const totalUntracked = files.filter((f) => f.state === 'untracked' && !conflictedPaths.has(f.path)).length
  const totalConflicted = conflictedFiles.length
  const totalCount = files.length
  const truncated = (
    totalStaged > STATUS_CAP ||
    totalUnstaged > STATUS_CAP ||
    totalUntracked > STATUS_CAP ||
    totalConflicted > STATUS_CAP
  )

  return {
    staged,
    unstaged,
    untracked,
    conflicted,
    counts: {
      staged: totalStaged,
      unstaged: totalUnstaged,
      untracked: totalUntracked,
      conflicted: totalConflicted,
    },
    truncated,
    totalCount,
  }
}

/** Parse the history pretty-format output with %x1f field separator. */
function parseHistoryEntries(output: string): RepoContextHistoryEntry[] {
  const FIELD_SEP = '\x1f'
  const entries: RepoContextHistoryEntry[] = []

  for (const line of output.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const parts = trimmed.split(FIELD_SEP)
    if (parts.length < 5) continue
    const [sha, subject, author, relativeDate, refsStr] = parts
    const refs = refsStr ? refsStr.split(', ').filter(Boolean) : []
    entries.push({
      sha: sha || '',
      subject: subject || '',
      author: author || '',
      relativeDate: relativeDate || '',
      refs,
    })
  }

  return entries
}

/**
 * Read recent commit history via hardened git and return the structured history section.
 * The `limit` parameter is capped at HISTORY_CAP.
 */
export async function readRepoHistoryContext(
  context: AgentOperationContext,
  limit = MAX_RECENT_LOG_COUNT,
): Promise<RepoContextHistory> {
  const bounded = Math.max(1, Math.min(limit, HISTORY_CAP))

  let output: string
  try {
    // Use -n (bounded + 1) to detect if there are more commits than requested.
    // Format: sha %x1f subject %x1f author name %x1f relative date %x1f refs
    output = await runAgentGit(context, [
      'log',
      '--no-color',
      `--pretty=format:%H${'\x1f'}%s${'\x1f'}%an${'\x1f'}%ar${'\x1f'}%D`,
      '-n', String(bounded + 1),
    ])
  } catch (error) {
    if (error instanceof AgentOperationError && error.code === 'CANCELLED') throw error
    // Empty repo / no commits — return empty history
    return { entries: [], totalCount: 0, truncated: false }
  }

  const all = parseHistoryEntries(output)
  const truncated = all.length > bounded
  const entries = truncated ? all.slice(0, bounded) : all

  // totalCount is a lower bound — we only fetched bounded+1 rows
  const totalCount = truncated ? bounded : entries.length

  return { entries, totalCount, truncated }
}

/**
 * Read conflict state via hardened git and return the structured conflicts section.
 */
export async function readRepoConflictsContext(context: AgentOperationContext): Promise<RepoContextConflicts> {
  const statusOutput = await runAgentGit(context, ['status', '--porcelain=v1', '-z']).catch((err) => {
    if (err instanceof AgentOperationError && err.code === 'CANCELLED') throw err
    return ''
  })

  const conflictedFiles = parseConflictedFiles(statusOutput)
  const totalCount = conflictedFiles.length
  const files: RepoContextFileEntry[] = conflictedFiles.slice(0, CONFLICT_FILES_CAP).map((f) => ({
    path: f.path,
    indexStatus: f.indexStatus,
    worktreeStatus: f.worktreeStatus,
  }))

  // Detect in-progress operation by checking .git state files
  let operation: RepoContextConflicts['operation'] = 'none'
  const operationPaths: Array<{ op: Exclude<RepoContextConflicts['operation'], 'none'>; gitPath: string }> = [
    { op: 'merge', gitPath: 'MERGE_HEAD' },
    { op: 'rebase', gitPath: 'rebase-merge' },
    { op: 'rebase', gitPath: 'rebase-apply' },
    { op: 'cherry-pick', gitPath: 'CHERRY_PICK_HEAD' },
    { op: 'revert', gitPath: 'REVERT_HEAD' },
  ]

  for (const entry of operationPaths) {
    try {
      const resolved = (await runAgentGit(context, ['rev-parse', '--git-path', entry.gitPath])).trim()
      if (resolved) {
        // --git-path may return an absolute path in linked worktrees; path.resolve
        // handles both relative (joins against repoRoot) and absolute (returns as-is)
        const absPath = pathResolve(context.repoRoot, resolved)
        if (existsSync(absPath)) {
          operation = entry.op
          break
        }
      }
    } catch (error) {
      if (error instanceof AgentOperationError && error.code === 'CANCELLED') throw error
    }
  }

  // Count conflict regions in conflicted files (bounded, 1 MiB per file)
  const MAX_REGION_FILE_SIZE = 1024 * 1024
  const CONFLICT_OURS = /^<{7}( |$)/
  let regionCount = 0
  let regionsTruncated = false
  const REGION_COUNT_CAP = 200

  try {
    const gitRoot = (await runAgentGit(context, ['rev-parse', '--show-toplevel'])).trim()
    for (const file of conflictedFiles) {
      if (regionsTruncated) break
      const filePath = pathJoin(gitRoot, file.path)
      try {
        const sz = fsStatSync(filePath).size
        if (sz > MAX_REGION_FILE_SIZE) continue
        const content = fsReadFileSync(filePath, 'utf8')
        for (const line of content.split('\n')) {
          const trimmed = line.trim()
          // Count only the opening marker so each conflict region increments once.
          // Counting all three markers (<<<<<<, =======, >>>>>>>) would triple-count
          // every region and make REGION_COUNT_CAP cap at ~66 real conflicts, not 200.
          if (CONFLICT_OURS.test(trimmed)) {
            regionCount++
          }
          if (regionCount >= REGION_COUNT_CAP) {
            regionsTruncated = true
            break
          }
        }
      } catch {
        // File unreadable — skip
      }
    }
  } catch (error) {
    if (error instanceof AgentOperationError && error.code === 'CANCELLED') throw error
  }

  return {
    inProgress: operation !== 'none',
    operation,
    files,
    regionCounts: { totalCount: regionCount, truncated: regionsTruncated },
    totalCount,
    truncated: totalCount > CONFLICT_FILES_CAP,
  }
}

/**
 * Detect commitlint config in the repo root (no cwd dependency).
 */
function hasCommitlintConfigAtRoot(root: string): boolean {
  for (const file of COMMITLINT_CONFIG_FILES) {
    if (existsSync(pathJoin(root, file))) return true
  }
  const pkgPath = pathJoin(root, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fsReadFileSync(pkgPath, 'utf8'))
      if (pkg.commitlint) return true
    } catch {
      // ignore parse errors
    }
  }
  return false
}

/**
 * Read repository capabilities via hardened git.
 */
export async function readRepoCapabilitiesContext(context: AgentOperationContext): Promise<RepoContextCapabilities> {
  // Forge detection: resolve default remote, parse host, detect provider
  let forge: string | undefined
  try {
    // Attempt to get the remote URL for 'origin'
    const remoteUrl = (await runAgentGit(context, ['remote', 'get-url', 'origin'])).trim()
    if (remoteUrl) {
      // Inline host extraction to avoid importing from git/ (would be git/ → operations/ — acceptable layering)
      // but we inline to stay safe with no circular deps.
      let host: string | undefined
      // Try SSH scp-style: git@host:...
      const scpMatch = remoteUrl.match(/^git@([^:]+):/)
      if (scpMatch) {
        host = scpMatch[1]
      } else {
        // Try URL form
        try {
          const url = new URL(remoteUrl)
          host = url.hostname
        } catch {
          // ignore
        }
      }
      if (host) {
        const h = host.toLowerCase()
        if (h === 'github.com' || h.includes('github')) forge = 'github'
        else if (h === 'gitlab.com' || h.includes('gitlab')) forge = 'gitlab'
        else if (h === 'bitbucket.org' || h.includes('bitbucket')) forge = 'bitbucket'
        else if (h === 'codeberg.org' || h.includes('gitea') || h.includes('forgejo')) forge = 'gitea'
        else forge = 'unsupported'
      }
    }
  } catch (error) {
    if (error instanceof AgentOperationError && error.code === 'CANCELLED') throw error
    // No origin remote — forge unknown
  }

  // Shallow clone detection
  let isShallow = false
  try {
    const result = (await runAgentGit(context, ['rev-parse', '--is-shallow-repository'])).trim()
    isShallow = result === 'true'
  } catch (error) {
    if (error instanceof AgentOperationError && error.code === 'CANCELLED') throw error
    // Older git may not support --is-shallow-repository; leave false
  }

  // Worktree detection: compare --git-dir and --git-common-dir
  let isWorktree = false
  try {
    const [gitDir, gitCommonDir] = await Promise.all([
      runAgentGit(context, ['rev-parse', '--git-dir']).then((v) => v.trim()),
      runAgentGit(context, ['rev-parse', '--git-common-dir']).then((v) => v.trim()),
    ])
    // In a linked worktree, --git-dir returns a path inside .git/worktrees/
    // while --git-common-dir returns the main repo's .git directory.
    isWorktree = gitDir !== gitCommonDir && !gitDir.endsWith('/.git') && gitDir !== '.git'
  } catch (error) {
    if (error instanceof AgentOperationError && error.code === 'CANCELLED') throw error
  }

  const hasCommitlintCfg = hasCommitlintConfigAtRoot(context.repoRoot)

  return {
    ...(forge !== undefined ? { forge } : {}),
    hasCommitlintConfig: hasCommitlintCfg,
    isWorktree,
    isShallow,
  }
}
