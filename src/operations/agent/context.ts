import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import * as path from 'node:path'
import { promisify } from 'node:util'
import { SimpleGit } from 'simple-git'

import type { LlmUsageSurface } from '../../lib/langchain/utils/observability'
import { getRepo } from '../../lib/simple-git/getRepo'
import { Logger } from '../../lib/utils/logger'
import { AgentOperationError } from './errors'
import { ChangeSource, MAX_AGENT_CONTEXT_BYTES, MAX_CONVENTIONS_BYTES, SourceMetadata } from './schemas'

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
  onProgress?: AgentProgressReporter
}

export type ResolvedChangeContext = {
  text: string
  meta: SourceMetadata
}

const execFileAsync = promisify(execFile)

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
    throw error
  }
}

function runAgentGit(context: AgentOperationContext, args: string[]): Promise<string> {
  return runGitAtPath(context.repoRoot, args, context.signal)
}

export function isPathWithinRoot(candidate: string, root: string): boolean {
  let resolvedCandidate: string
  let resolvedRoot: string
  try {
    resolvedCandidate = realpathSync(candidate)
    resolvedRoot = realpathSync(root)
  } catch {
    return false
  }

  const relative = path.relative(resolvedRoot, resolvedCandidate)
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    return true
  }

  // Windows can spell the same directory with either a long path or an 8.3
  // alias. If the lexical check disagrees, compare filesystem identities while
  // walking the already-realpathed candidate's ancestors. This preserves the
  // symlink boundary while accepting equivalent Windows path spellings.
  if (process.platform !== 'win32') return false

  try {
    const rootStats = statSync(resolvedRoot)
    if (rootStats.ino === 0) return false

    let current = resolvedCandidate
    while (true) {
      const currentStats = statSync(current)
      if (currentStats.dev === rootStats.dev && currentStats.ino === rootStats.ino) {
        return true
      }
      const parent = path.dirname(current)
      if (parent === current) return false
      current = parent
    }
  } catch {
    return false
  }
}

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
        throw new AgentOperationError(
          'UNSAFE_SOURCE',
          'Worktree inspection can invoke repository-defined clean filters. Supply a patch/summary or explicitly trust repository configuration in the one-shot agent CLI.',
        )
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
      digest: `sha256:${createHash('sha256').update(text).digest('hex')}`,
      repositoryHead,
      verification: source.kind === 'repository'
        ? 'repository-derived'
        : providedHead && repositoryHead && providedHead === repositoryHead
        ? 'head-matched'
        : 'provided-unverified',
    },
  }
}
