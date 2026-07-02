import { execFile } from 'child_process'
import { promisify } from 'util'
import { SimpleGit } from 'simple-git'

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

export async function getGitHubRepository(
  git: SimpleGit
): Promise<GitHubRepository | undefined> {
  const remotes = await git.getRemotes(true)
  const remote = remotes.find((entry) => entry.name === 'origin') || remotes[0]
  const url = remote?.refs.push || remote?.refs.fetch

  return url ? parseGitHubRemoteUrl(url) : undefined
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
 * detail lines, mirroring `operationActions.compactOutputLines`. Keeps a raw
 * stderr dump from flooding a notification.
 */
export function compactGhError(message: string): GhActionError {
  const lines = message
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    // execFile prefixes its message with the entire echoed command line
    // ("Command failed: gh pr create --title=... --body=<pages of text>").
    // That line names no failure reason — and with a generated PR body in
    // the argv it dwarfs the status line — so drop it and lead with gh's
    // actual stderr complaint.
    .filter((line) => !line.startsWith('Command failed:'))

  return {
    message: lines[0] || 'GitHub CLI command failed.',
    details: lines.slice(1, 8),
  }
}

/**
 * Turn a thrown gh error into a user-facing message. Mutating gh actions (PR /
 * issue create/merge/comment/...) don't pre-check auth, so a session that
 * de-authed mid-flight would otherwise dump raw gh stderr. We probe
 * `getGhStatus` on the error path: if gh is no longer `ok`, return the curated
 * recovery hint; otherwise compact the underlying error. The probe is one extra
 * gh call and only happens when an action has already failed.
 */
export async function resolveGhActionError(
  error: unknown,
  runner: GhRunner
): Promise<GhActionError> {
  // Promisified execFile attaches the process stderr to the error —
  // that's where gh explains itself ("a pull request for branch X
  // already exists", auth guidance, …). Prefer it over `message`,
  // which leads with the echoed command line.
  const stderr = (error as { stderr?: unknown })?.stderr
  const raw =
    (typeof stderr === 'string' && stderr.trim() ? stderr : undefined) ||
    (error as Error)?.message ||
    'GitHub CLI command failed.'

  try {
    const status = await getGhStatus(runner)
    if (status.kind !== 'ok') {
      return { message: describeGhStatus(status) }
    }
  } catch {
    // If even the status probe throws, fall back to compacting the raw error.
  }

  return compactGhError(raw)
}
