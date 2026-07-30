import { SimpleGit } from 'simple-git'
import {
  GH_DEFAULT_TIMEOUT_MS,
  parseRemoteUrl,
  resolveDefaultRemote,
  type GhActionError,
  type GhStatus,
} from './githubCli'
import type { ForgeActionResult } from './pullRequestActions'
import { compactCliError, resolveForgeActionError } from './forgeErrors'

/**
 * Bitbucket Server / Data Center project coordinates parsed from a remote
 * URL. `owner` is the project key; `name` is the repo slug; `path` is
 * `owner/name`; `host` is the remote's hostname — every Bitbucket Server
 * install serves its own REST API at `https://<host>/rest/api/1.0`, mirroring
 * Gitea/Forgejo's per-install API base rather than Bitbucket Cloud's fixed
 * `api.bitbucket.org`.
 *
 * Bitbucket Server's HTTP(S) clone URL carries an extra `/scm/` path segment
 * (`https://host/scm/PROJECT/repo.git`) that the generic `parseRemoteUrl`
 * heuristic has no reason to know about — it would otherwise fold `scm` into
 * the "owner" as if it were a namespace segment (the way GitLab subgroups
 * are). SSH remotes (`ssh://git@host:7999/PROJECT/repo.git`) don't have this
 * quirk. `stripScmSegment` normalizes both forms to the bare project key.
 */
export type BitbucketServerProject = {
  owner: string
  name: string
  path: string
  host: string
}

export function stripScmSegment(owner: string): string {
  const parts = owner.split('/')
  if (parts.length > 1 && parts[0].toLowerCase() === 'scm') {
    return parts.slice(1).join('/')
  }
  return owner
}

/**
 * Split a `projectKey/repoSlug` path back into its parts. Unlike GitLab
 * namespaces, Bitbucket Server project keys are always a single segment, so
 * this is a plain split rather than a "everything but the last segment"
 * parse.
 */
export function splitBitbucketServerPath(
  path: string
): { projectKey: string; repoSlug: string } | undefined {
  const idx = path.indexOf('/')
  if (idx <= 0 || idx === path.length - 1) return undefined
  return { projectKey: path.slice(0, idx), repoSlug: path.slice(idx + 1) }
}

export type BitbucketServerRunnerOptions = {
  method?: string
  body?: string
  signal?: AbortSignal
  timeout?: number
}

/**
 * HTTP runner for the Bitbucket Server / Data Center REST API 1.0. Takes an
 * endpoint path relative to the API base (e.g.
 * `projects/KEY/repos/slug/pull-requests`) — or an absolute URL, used for
 * the separate `rest/build-status/1.0` API this forge also exposes — and
 * optional request options; returns the response body as a string.
 * Injectable so tests can swap it for a fake without real HTTP.
 */
export type BitbucketServerRunner = (
  endpoint: string,
  options?: BitbucketServerRunnerOptions
) => Promise<string>

function buildAuthHeaders(): Record<string, string> {
  const token = process.env.BITBUCKET_SERVER_TOKEN
  if (token) return { Authorization: `Bearer ${token}` }

  const username = process.env.BITBUCKET_SERVER_USERNAME
  const password = process.env.BITBUCKET_SERVER_PASSWORD
  if (username && password) {
    const encoded = Buffer.from(`${username}:${password}`).toString('base64')
    return { Authorization: `Basic ${encoded}` }
  }

  return {}
}

/**
 * Build a REST runner bound to a specific Bitbucket Server/DC host. The API
 * base is per-install (`https://<host>/rest/api/1.0`), so a runner must be
 * constructed for the host of the detected repository, mirroring
 * `makeGiteaRunner` rather than Bitbucket Cloud's fixed-base
 * `defaultBitbucketRunner`.
 */
export function makeBitbucketServerRunner(host: string): BitbucketServerRunner {
  const base = `https://${host}/rest/api/1.0`

  return async function defaultBitbucketServerRunner(
    endpoint: string,
    options: BitbucketServerRunnerOptions = {}
  ): Promise<string> {
    const timeout = options.timeout ?? GH_DEFAULT_TIMEOUT_MS
    const signal = options.signal ?? AbortSignal.timeout(timeout)
    const url = endpoint.startsWith('http') ? endpoint : `${base}/${endpoint}`

    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...buildAuthHeaders(),
      },
      body: options.body,
      signal,
    })

    const text = await response.text()
    if (!response.ok) {
      throw Object.assign(
        new Error(`Bitbucket Server API error ${response.status}: ${text}`),
        { status: response.status }
      )
    }
    return text
  }
}

/** Parse the Bitbucket Server project key/repo slug from the repo's origin remote (else first). */
export async function getBitbucketServerProject(
  git: SimpleGit
): Promise<BitbucketServerProject | undefined> {
  const resolved = await resolveDefaultRemote(git)
  if (!resolved) return undefined
  const parsed = parseRemoteUrl(resolved.url)
  if (!parsed) return undefined
  const owner = stripScmSegment(parsed.owner)
  return {
    owner,
    name: parsed.name,
    path: `${owner}/${parsed.name}`,
    host: parsed.host,
  }
}

/**
 * Probe Bitbucket Server / DC auth by checking credentials in the
 * environment and (if present) calling an authenticated-only endpoint.
 * `profile/recent/repos` requires a logged-in user and has no side effects,
 * making it a safe auth probe — unlike `application-properties`, which is
 * served anonymously and would report `ok` even for an invalid token.
 * Missing or invalid credentials return `not-authenticated`; network
 * failures return `unknown`.
 */
export async function getBitbucketServerStatus(runner: BitbucketServerRunner): Promise<GhStatus> {
  const hasCredentials =
    Boolean(process.env.BITBUCKET_SERVER_TOKEN) ||
    (Boolean(process.env.BITBUCKET_SERVER_USERNAME) && Boolean(process.env.BITBUCKET_SERVER_PASSWORD))

  if (!hasCredentials) {
    return {
      kind: 'not-authenticated',
      detail: 'Set BITBUCKET_SERVER_TOKEN or BITBUCKET_SERVER_USERNAME + BITBUCKET_SERVER_PASSWORD.',
    }
  }

  try {
    await runner('profile/recent/repos?limit=1')
    return { kind: 'ok' }
  } catch (error) {
    const err = error as Error & { status?: number }
    if (err.status === 401 || err.status === 403) {
      return { kind: 'not-authenticated', detail: 'Bitbucket Server credentials are invalid.' }
    }
    return { kind: 'unknown', detail: err.message || 'Bitbucket Server API probe failed.' }
  }
}

export async function isBitbucketServerAuthenticated(runner: BitbucketServerRunner): Promise<boolean> {
  return (await getBitbucketServerStatus(runner)).kind === 'ok'
}

export function describeBitbucketServerStatus(status: GhStatus): string {
  switch (status.kind) {
    case 'ok':
      return 'Bitbucket Server is authenticated.'
    case 'not-installed':
      return 'Bitbucket Server API client is unavailable.'
    case 'not-authenticated':
      return `Not authenticated to Bitbucket Server. Set BITBUCKET_SERVER_TOKEN or BITBUCKET_SERVER_USERNAME + BITBUCKET_SERVER_PASSWORD.${status.detail ? ` Details: ${status.detail}` : ''}`
    case 'unknown':
      return `Bitbucket Server API returned an unexpected error: ${status.detail}`
  }
}

/**
 * Compact a multi-line Bitbucket Server error into a head line plus bounded
 * detail lines. Thin wrapper over the shared `compactCliError`, mirroring
 * `compactBitbucketError` / `compactGiteaError`.
 */
export function compactBitbucketServerError(message: string): GhActionError {
  return compactCliError(message, { fallback: 'Bitbucket Server API call failed.' })
}

/**
 * Turn a thrown Bitbucket Server error into a user-facing message,
 * re-probing auth on the error path so a mid-session credential expiry
 * yields the recovery hint instead of raw HTTP error output. Mirrors
 * `resolveBitbucketActionError` via the shared `resolveForgeActionError`
 * scaffold.
 */
export async function resolveBitbucketServerActionError(
  error: unknown,
  runner: BitbucketServerRunner
): Promise<GhActionError> {
  return resolveForgeActionError(error, {
    probe: () => getBitbucketServerStatus(runner),
    describe: describeBitbucketServerStatus,
    fallback: 'Bitbucket Server API call failed.',
  })
}

/**
 * Shared try/run/resolve-error wrapper for every Bitbucket Server REST
 * mutating action, mirroring `runBitbucketAction` / `runGiteaAction`.
 */
export async function runBitbucketServerAction(
  runner: BitbucketServerRunner,
  endpoint: string,
  method: string,
  body: Record<string, unknown> | undefined,
  onSuccess: (output: string) => ForgeActionResult
): Promise<ForgeActionResult> {
  try {
    const out = await runner(endpoint, {
      method,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    return onSuccess(out)
  } catch (error) {
    const { message, details } = await resolveBitbucketServerActionError(error, runner)
    return { ok: false, message, ...(details && details.length ? { details } : {}) }
  }
}
