import { execFile } from 'child_process'
import { promisify } from 'util'
import { SimpleGit } from 'simple-git'
import type { ForgeActionResult } from './pullRequestActions'
import { compactCliError, resolveForgeActionError } from './forgeErrors'

const execFileAsync = promisify(execFile)

/**
 * Default wall-clock ceiling for a single `gh` invocation. Without this a
 * hung gh (e.g. one prompting for auth on a TTY-less session, or a stalled
 * network call) would block the TUI indefinitely.
 */
export const GH_DEFAULT_TIMEOUT_MS = 20_000

/**
 * Default stdout buffer ceiling. The Node `execFile` default is 1 MB, which
 * large `gh ... --json` payloads (big PR/issue lists) can overflow, crashing
 * the call with ERR_CHILD_PROCESS_STDIO_MAXBUFFER. 16 MB is comfortably above
 * realistic gh JSON output.
 */
export const GH_MAX_BUFFER_BYTES = 16 * 1024 * 1024

export type GhRunOptions = {
  /** Abort the gh process when the signal fires (Node 16.14+). */
  signal?: AbortSignal
  /** Per-call wall-clock timeout in ms. Defaults to `GH_DEFAULT_TIMEOUT_MS`. */
  timeout?: number
}

export type GhRunner = (args: string[], options?: GhRunOptions) => Promise<string>

export type GitHubRepository = {
  owner: string
  name: string
}

export type ParsedRemote = {
  /** Lowercased host, e.g. `github.com`, `gitlab.com`, `ghe.acme.com`. */
  host: string
  /** Namespace / owner. May contain slashes for GitLab subgroups. */
  owner: string
  /** Repository / project name (the last path segment). */
  name: string
}

/**
 * Host-agnostic remote-URL parser. Handles every form git emits — scp-style ssh
 * (`git@host:owner/name`), ssh / git protocol URLs, and https (with optional
 * `user@` and `:port`) — for ANY host, and preserves multi-segment owners so
 * GitLab subgroups (`group/subgroup/project`) round-trip. Strips a trailing
 * `.git`. Returns undefined when the URL doesn't resolve to host + owner + name.
 */
export function parseRemoteUrl(url: string): ParsedRemote | undefined {
  const trimmed = url.trim().replace(/\.git$/, '')
  let host: string | undefined
  let rawPath: string | undefined

  if (trimmed.includes('://')) {
    // scheme://[user@]host[:port]/path
    const m = trimmed.match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/i)
    if (m) {
      host = m[1]
      rawPath = m[2]
    }
  } else {
    // scp-style: [user@]host:path
    const m = trimmed.match(/^(?:[^@/]+@)?([^/:]+):(.+)$/)
    if (m) {
      host = m[1]
      rawPath = m[2]
    }
  }

  if (!host || !rawPath) {
    return undefined
  }

  const segments = rawPath.replace(/^\/+/, '').split('/').filter(Boolean)
  if (segments.length < 2) {
    return undefined
  }

  return {
    host: host.toLowerCase(),
    owner: segments.slice(0, -1).join('/'),
    name: segments[segments.length - 1],
  }
}

/**
 * GitHub.com remote parser, preserved for the GitHub code paths. Built on the
 * host-agnostic `parseRemoteUrl`; returns owner/name only for github.com
 * remotes. GitHub Enterprise and other forges are handled by the provider
 * layer, which reads the parsed host directly.
 */
export function parseGitHubRemoteUrl(url: string): GitHubRepository | undefined {
  const parsed = parseRemoteUrl(url)
  if (!parsed || parsed.host !== 'github.com') {
    return undefined
  }

  return {
    owner: parsed.owner,
    name: parsed.name,
  }
}

export async function defaultGhRunner(
  args: string[],
  options: GhRunOptions = {}
): Promise<string> {
  const result = await execFileAsync('gh', args, {
    timeout: options.timeout ?? GH_DEFAULT_TIMEOUT_MS,
    maxBuffer: GH_MAX_BUFFER_BYTES,
    ...(options.signal ? { signal: options.signal } : {}),
  })
  return result.stdout
}

/**
 * Resolve the repo's default remote — `origin`, else the first configured
 * remote — and its URL (preferring the push URL, falling back to fetch).
 * The single source of truth for remote-selection policy; every
 * remote-to-project resolver in this file (and in `glabCli.ts`,
 * `bitbucketCli.ts`, `providerData.ts`, `repoIdentifier.ts`) builds on this.
 */
export async function resolveDefaultRemote(
  git: SimpleGit
): Promise<{ name: string; url: string } | undefined> {
  const remotes = await git.getRemotes(true)
  const remote = remotes.find((entry) => entry.name === 'origin') || remotes[0]
  const url = remote?.refs.push || remote?.refs.fetch
  return remote && url ? { name: remote.name, url } : undefined
}

/**
 * Resolve the `{owner,name,path,host}` shape shared by GitLab and Bitbucket
 * project resolution — their bodies are otherwise byte-identical.
 */
export async function resolveForgeProject(
  git: SimpleGit
): Promise<{ owner: string; name: string; path: string; host: string } | undefined> {
  const resolved = await resolveDefaultRemote(git)
  if (!resolved) return undefined
  const parsed = parseRemoteUrl(resolved.url)
  if (!parsed) return undefined
  return {
    owner: parsed.owner,
    name: parsed.name,
    path: parsed.owner ? `${parsed.owner}/${parsed.name}` : parsed.name,
    host: parsed.host,
  }
}

export async function getGitHubRepository(
  git: SimpleGit
): Promise<GitHubRepository | undefined> {
  const resolved = await resolveDefaultRemote(git)
  return resolved ? parseGitHubRemoteUrl(resolved.url) : undefined
}

/**
 * Discriminated union describing the gh CLI's availability state.
 * Lets callers route per-failure-mode messaging instead of collapsing
 * everything to "CLI missing or not authenticated":
 *
 *   - `ok`               : gh installed + authenticated to github.com
 *   - `not-installed`    : `gh` binary missing from PATH (ENOENT)
 *   - `not-authenticated`: `gh auth status` returned non-zero, but the
 *                          binary exists. User needs `gh auth login`.
 *   - `unknown`          : gh failed for some other reason (timeout,
 *                          permissions, malformed args). Treated as
 *                          unavailable but logged so the user can
 *                          inspect.
 */
export type GhStatus =
  | { kind: 'ok' }
  | { kind: 'not-installed' }
  | { kind: 'not-authenticated'; detail?: string }
  | { kind: 'unknown'; detail: string }

/**
 * Probe `gh auth status` and return a structured status describing
 * exactly which of the failure modes is in play. Used by every data
 * fetcher to short-circuit before issuing real API calls — and now
 * lets the caller surface a tailored recovery hint per failure mode
 * instead of one catch-all message.
 *
 * Distinguishing the modes:
 *   - ENOENT (`gh: command not found`) → `not-installed`
 *   - `gh auth status` exits non-zero with stderr matching the
 *     "not logged into" / "authentication required" pattern →
 *     `not-authenticated`
 *   - Anything else (permission denied on the binary, timeout, etc.)
 *     → `unknown` with the underlying error message attached for
 *     diagnostic display.
 */
export async function getGhStatus(runner: GhRunner, hostname = 'github.com'): Promise<GhStatus> {
  try {
    await runner(['auth', 'status', '--hostname', hostname])
    return { kind: 'ok' }
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stderr?: string; code?: string | number }
    // ENOENT = the binary itself is missing. exec/spawn surfaces this
    // as either `code === 'ENOENT'` (Node's spawn error code) or a
    // message containing "ENOENT". Either form is unambiguous.
    if (err.code === 'ENOENT' || (err.message && err.message.includes('ENOENT'))) {
      return { kind: 'not-installed' }
    }
    // gh exits non-zero from `auth status` when the user isn't logged
    // in. The message body contains "not logged into" or "logged in
    // failed" depending on the gh version. Both patterns are stable
    // enough to gate on without scope-locking to a specific gh
    // release.
    const stderr = err.stderr || err.message || ''
    if (/not logged into|authentication.*required|you are not/i.test(stderr)) {
      return { kind: 'not-authenticated', detail: stderr.trim().split('\n')[0] }
    }
    // Anything else — permission denied, timeout, etc. Surface the
    // raw message so the user can read it; treat as unavailable.
    return { kind: 'unknown', detail: err.message || 'gh auth status failed' }
  }
}

/**
 * Backwards-compatible boolean wrapper around `getGhStatus`. Kept so
 * existing callers (data loaders, sidebar fetchers) don't all have to
 * migrate at once. New call sites should use `getGhStatus` directly
 * to access the discriminated failure modes.
 */
export async function isGhAuthenticated(runner: GhRunner): Promise<boolean> {
  const status = await getGhStatus(runner)
  return status.kind === 'ok'
}

/**
 * Render a user-facing recovery hint for a non-`ok` gh status. Used by
 * `commands/issues` / `commands/prs` / pull-request workflow surfaces
 * so every "gh is unavailable" message tells the user the exact next
 * step. Keeps the wording in sync across surfaces — if a user runs
 * `coco prs` and `coco issues` back to back, the same broken state
 * surfaces the same fix.
 */
export function describeGhStatus(status: GhStatus): string {
  switch (status.kind) {
    case 'ok':
      return 'GitHub CLI is installed and authenticated.'
    case 'not-installed':
      return 'GitHub CLI (`gh`) is not installed. Install it from https://cli.github.com/ and run `gh auth login`.'
    case 'not-authenticated':
      return `GitHub CLI is installed but not authenticated. Run \`gh auth login\` (scopes: \`repo\`, \`read:org\`).${status.detail ? ` Details: ${status.detail}` : ''}`
    case 'unknown':
      return `GitHub CLI returned an unexpected error: ${status.detail}. Try \`gh auth status\` directly to diagnose.`
  }
}

/** Structured, user-facing form of a failed gh action. */
export type GhActionError = {
  message: string
  details?: string[]
}

/**
 * Compact a multi-line gh error/stderr into a head line plus a bounded set of
 * detail lines. Thin wrapper over the shared `compactCliError` so gh, glab,
 * and Bitbucket can't drift from each other.
 */
export function compactGhError(message: string): GhActionError {
  return compactCliError(message, { fallback: 'GitHub CLI command failed.' })
}

/**
 * Turn a thrown gh error into a user-facing message. Mutating gh actions (PR /
 * issue create/merge/comment/...) don't pre-check auth, so a session that
 * de-authed mid-flight would otherwise dump raw gh stderr. We probe
 * `getGhStatus` on the error path: if gh is no longer `ok`, return the curated
 * recovery hint; otherwise compact the underlying error. The probe is one extra
 * gh call and only happens when an action has already failed. Thin wrapper
 * over the shared `resolveForgeActionError` scaffold.
 */
export async function resolveGhActionError(
  error: unknown,
  runner: GhRunner
): Promise<GhActionError> {
  return resolveForgeActionError(error, {
    probe: () => getGhStatus(runner),
    describe: describeGhStatus,
    fallback: 'GitHub CLI command failed.',
  })
}

/**
 * Shared try/run/resolve-error wrapper for every `gh` mutating action
 * (PR and issue actions alike). Runs `args` through `runner`, maps a
 * successful result through `onSuccess`, and on failure routes the thrown
 * error through `resolveGhActionError` so every call site gets the same
 * curated-message-vs-compacted-stderr behavior.
 */
export async function runGhAction(
  runner: GhRunner,
  args: string[],
  onSuccess: (output: string) => ForgeActionResult
): Promise<ForgeActionResult> {
  try {
    return onSuccess(await runner(args))
  } catch (error) {
    const { message, details } = await resolveGhActionError(error, runner)
    return {
      ok: false,
      message,
      ...(details && details.length ? { details } : {}),
    }
  }
}
