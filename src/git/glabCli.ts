import { execFile } from 'child_process'
import { promisify } from 'util'
import { SimpleGit } from 'simple-git'
import {
  GH_DEFAULT_TIMEOUT_MS,
  GH_MAX_BUFFER_BYTES,
  parseRemoteUrl,
  type GhActionError,
  type GhRunOptions,
  type GhRunner,
  type GhStatus,
} from './githubCli'
import type { ForgeActionResult } from './pullRequestActions'

const execFileAsync = promisify(execFile)

/**
 * GitLab project coordinates parsed from a remote. `path` is the full namespace
 * path glab addresses projects by (`group/subgroup/project`); `owner` is the
 * namespace and `name` the project's last path segment.
 */
export type GitLabProject = {
  owner: string
  name: string
  path: string
  /** Remote host (gitlab.com or a self-hosted instance) for host-scoped auth. */
  host: string
}

/**
 * glab shares gh's runner contract: `(args, options) => Promise<stdout>`.
 * Reusing the type keeps the injectable-runner pattern (and its test harness)
 * identical across forges, so a fake runner mocks either CLI the same way.
 */
export type GlabRunner = GhRunner

/**
 * Default `glab` invoker, mirroring `defaultGhRunner` with the same wall-clock
 * timeout and stdout buffer ceilings. glab infers the target GitLab host from
 * the repo's remote, so no host argument is needed for project-scoped calls.
 */
export async function defaultGlabRunner(
  args: string[],
  options: GhRunOptions = {}
): Promise<string> {
  const result = await execFileAsync('glab', args, {
    timeout: options.timeout ?? GH_DEFAULT_TIMEOUT_MS,
    maxBuffer: GH_MAX_BUFFER_BYTES,
    ...(options.signal ? { signal: options.signal } : {}),
  })
  return result.stdout
}

/** Parse the GitLab project from the repo's `origin` remote (else first), or undefined. */
export async function getGitLabProject(git: SimpleGit): Promise<GitLabProject | undefined> {
  const remotes = await git.getRemotes(true)
  const remote = remotes.find((entry) => entry.name === 'origin') || remotes[0]
  const url = remote?.refs.push || remote?.refs.fetch
  if (!url) return undefined

  const parsed = parseRemoteUrl(url)
  if (!parsed) return undefined

  return {
    owner: parsed.owner,
    name: parsed.name,
    path: parsed.owner ? `${parsed.owner}/${parsed.name}` : parsed.name,
    host: parsed.host,
  }
}

/**
 * Probe `glab auth status` and classify the result, mirroring `getGhStatus`.
 * glab infers the GitLab host (gitlab.com or self-hosted) from the repo remote;
 * pass `hostname` to scope the check to a specific instance.
 */
export async function getGlabStatus(runner: GlabRunner, hostname?: string): Promise<GhStatus> {
  try {
    await runner(['auth', 'status', ...(hostname ? ['--hostname', hostname] : [])])
    return { kind: 'ok' }
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stderr?: string; code?: string | number }
    // ENOENT = the `glab` binary is missing from PATH.
    if (err.code === 'ENOENT' || (err.message && err.message.includes('ENOENT'))) {
      return { kind: 'not-installed' }
    }
    // glab exits non-zero from `auth status` when no token is configured. The
    // message body varies by version ("not logged in" / "no token provided").
    const stderr = err.stderr || err.message || ''
    if (/not logged in|no token|authentication.*required|not authenticated/i.test(stderr)) {
      return { kind: 'not-authenticated', detail: stderr.trim().split('\n')[0] }
    }
    return { kind: 'unknown', detail: err.message || 'glab auth status failed' }
  }
}

/** Boolean convenience wrapper around `getGlabStatus`. */
export async function isGlabAuthenticated(runner: GlabRunner, hostname?: string): Promise<boolean> {
  return (await getGlabStatus(runner, hostname)).kind === 'ok'
}

/** Render a user-facing recovery hint for a non-`ok` glab status. */
export function describeGlabStatus(status: GhStatus): string {
  switch (status.kind) {
    case 'ok':
      return 'GitLab CLI is installed and authenticated.'
    case 'not-installed':
      return 'GitLab CLI (`glab`) is not installed. Install it from https://gitlab.com/gitlab-org/cli and run `glab auth login`.'
    case 'not-authenticated':
      return `GitLab CLI is installed but not authenticated. Run \`glab auth login\`.${status.detail ? ` Details: ${status.detail}` : ''}`
    case 'unknown':
      return `GitLab CLI returned an unexpected error: ${status.detail}. Try \`glab auth status\` directly to diagnose.`
  }
}

/** Compact a multi-line glab error into a head line plus bounded detail lines. */
export function compactGlabError(message: string): GhActionError {
  const lines = message
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    // execFile prefixes its message with the echoed argv ("Command failed:
    // glab mr create --description=<full MR body>"), which names no failure
    // reason and buries glab's stderr past the 8-line cap. Drop it.
    .filter((line) => !line.startsWith('Command failed:'))

  return {
    message: lines[0] || 'GitLab CLI command failed.',
    details: lines.slice(1, 8),
  }
}

/**
 * Turn a thrown glab error into a user-facing message, probing auth on the
 * error path so a mid-session de-auth yields the curated recovery hint instead
 * of raw glab stderr. Mirrors `resolveGhActionError`.
 *
 * Pass `hostname` (the repo's remote host) so the auth re-probe checks the
 * right instance — self-hosted GitLab installs aren't `gitlab.com`, and a
 * host-less probe would report on the wrong server.
 */
export async function resolveGlabActionError(
  error: unknown,
  runner: GlabRunner,
  hostname?: string
): Promise<GhActionError> {
  // Promisified execFile attaches process stderr to the error — that's
  // where glab explains itself (MR already exists, pipeline red, auth).
  // Prefer it over `message`, which leads with the echoed command line.
  const stderr = (error as { stderr?: unknown })?.stderr
  const raw =
    (typeof stderr === 'string' && stderr.trim() ? stderr : undefined) ||
    (error as Error)?.message ||
    'GitLab CLI command failed.'

  try {
    const status = await getGlabStatus(runner, hostname)
    if (status.kind !== 'ok') {
      return { message: describeGlabStatus(status) }
    }
  } catch {
    // If even the status probe throws, fall back to compacting the raw error.
  }

  return compactGlabError(raw)
}

/**
 * Shared try/run/resolve-error wrapper for every `glab` mutating action
 * (MR and issue actions alike), mirroring `runGhAction`. `hostname` scopes
 * the error-path auth re-probe to the right GitLab instance.
 */
export async function runGlabAction(
  runner: GlabRunner,
  args: string[],
  onSuccess: (output: string) => ForgeActionResult,
  hostname?: string
): Promise<ForgeActionResult> {
  try {
    return onSuccess(await runner(args))
  } catch (error) {
    const { message, details } = await resolveGlabActionError(error, runner, hostname)
    return { ok: false, message, ...(details && details.length ? { details } : {}) }
  }
}
