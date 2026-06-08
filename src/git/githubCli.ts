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

/**
 * Canonical GitHub remote-URL parser. Handles all four remote forms gh/git
 * emit: scp-style ssh (`git@github.com:o/r`), ssh protocol
 * (`ssh://git@github.com/o/r`), https, and the legacy `git://` protocol.
 * `providerData` builds on this and adds the derived `webUrl`.
 */
export function parseGitHubRemoteUrl(url: string): GitHubRepository | undefined {
  const trimmed = url.trim().replace(/\.git$/, '')
  const sshMatch = trimmed.match(/^git@github\.com:([^/]+)\/(.+)$/)
  const sshProtocolMatch = trimmed.match(/^ssh:\/\/git@github\.com\/([^/]+)\/(.+)$/)
  const httpsMatch = trimmed.match(/^https:\/\/github\.com\/([^/]+)\/(.+)$/)
  const gitMatch = trimmed.match(/^git:\/\/github\.com\/([^/]+)\/(.+)$/)
  const match = sshMatch || sshProtocolMatch || httpsMatch || gitMatch

  if (!match) {
    return undefined
  }

  return {
    owner: match[1],
    name: match[2],
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
export async function getGhStatus(runner: GhRunner): Promise<GhStatus> {
  try {
    await runner(['auth', 'status', '--hostname', 'github.com'])
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
  const raw = (error as Error)?.message || 'GitHub CLI command failed.'

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
