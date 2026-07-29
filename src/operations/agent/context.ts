import { execFile, ExecFileException } from 'node:child_process'
import { createHash } from 'node:crypto'
import { realpathSync, statSync } from 'node:fs'
import * as path from 'node:path'
import { promisify } from 'node:util'
import { SimpleGit } from 'simple-git'

import type { LlmUsageSurface } from '../../lib/langchain/utils/observability'
import { getRepo } from '../../lib/simple-git/getRepo'
import { Logger } from '../../lib/utils/logger'
import { AgentOperationError } from './errors'
import { ChangeSource, MAX_AGENT_CONTEXT_BYTES, SourceMetadata } from './schemas'

export type AgentOperationContext = {
  repoRoot: string
  git: SimpleGit
  logger: Logger
  surface: LlmUsageSurface
  signal?: AbortSignal
  cleanFilterProbe?: Promise<CleanFilterProbeResult>
}

type CleanFilterProbeResult =
  | { blocked: false }
  | { blocked: true, filter: string }

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
}): Promise<AgentOperationContext> {
  const repoRoot = await resolveAgentRepoRoot(input.repoRoot, undefined, input.signal)
  const git = getRepo(repoRoot)
  return {
    repoRoot,
    git,
    surface: input.surface ?? 'agent-cli',
    signal: input.signal,
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
