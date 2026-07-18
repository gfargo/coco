import { SimpleGit } from 'simple-git'
import {
  GH_DEFAULT_TIMEOUT_MS,
  parseRemoteUrl,
  type GhActionError,
  type GhStatus,
} from './githubCli'

/**
 * Bitbucket workspace / repo coordinates parsed from a remote URL. `owner` is
 * the workspace slug; `name` is the repo slug; `path` is `workspace/slug`.
 */
export type BitbucketProject = {
  owner: string
  name: string
  path: string
  host: string
}

export type BitbucketRunnerOptions = {
  method?: string
  body?: string
  signal?: AbortSignal
  timeout?: number
}

/**
 * HTTP runner for the Bitbucket REST API v2. Takes an endpoint path relative
 * to the API base (e.g. `repositories/workspace/slug/pullrequests`) and
 * optional request options; returns the response body as a string. Injectable
 * so tests can swap it for a fake without real HTTP.
 */
export type BitbucketRunner = (
  endpoint: string,
  options?: BitbucketRunnerOptions
) => Promise<string>

export const BITBUCKET_API_BASE = 'https://api.bitbucket.org/2.0'

/**
 * Escape a user-controlled value for safe interpolation inside a BBQL
 * double-quoted string literal (backslash first, then quote — order matters
 * so an existing backslash isn't re-escaped by the quote pass).
 */
export function bbqlQuote(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function buildAuthHeaders(): Record<string, string> {
  const token = process.env.BITBUCKET_ACCESS_TOKEN
  if (token) return { Authorization: `Bearer ${token}` }

  const username = process.env.BITBUCKET_USERNAME
  const password = process.env.BITBUCKET_APP_PASSWORD
  if (username && password) {
    const encoded = Buffer.from(`${username}:${password}`).toString('base64')
    return { Authorization: `Basic ${encoded}` }
  }

  return {}
}

/**
 * Default Bitbucket REST runner. Reads credentials from environment variables
 * (`BITBUCKET_ACCESS_TOKEN` or `BITBUCKET_USERNAME` + `BITBUCKET_APP_PASSWORD`)
 * and calls the Bitbucket REST API v2.
 */
export async function defaultBitbucketRunner(
  endpoint: string,
  options: BitbucketRunnerOptions = {}
): Promise<string> {
  const timeout = options.timeout ?? GH_DEFAULT_TIMEOUT_MS
  const signal = options.signal ?? AbortSignal.timeout(timeout)
  const url = endpoint.startsWith('http') ? endpoint : `${BITBUCKET_API_BASE}/${endpoint}`

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
      new Error(`Bitbucket API error ${response.status}: ${text}`),
      { status: response.status }
    )
  }
  return text
}

/** Parse the Bitbucket workspace/slug from the repo's origin remote (else first). */
export async function getBitbucketProject(git: SimpleGit): Promise<BitbucketProject | undefined> {
  const remotes = await git.getRemotes(true)
  const remote = remotes.find((r) => r.name === 'origin') || remotes[0]
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
 * Probe Bitbucket auth by checking credentials in the environment and (if
 * present) calling GET /user. Credentials come from env vars; there is no
 * installed CLI binary. Missing or invalid credentials return
 * `not-authenticated`; network failures return `unknown`.
 */
export async function getBitbucketStatus(runner: BitbucketRunner): Promise<GhStatus> {
  const hasCredentials =
    Boolean(process.env.BITBUCKET_ACCESS_TOKEN) ||
    (Boolean(process.env.BITBUCKET_USERNAME) && Boolean(process.env.BITBUCKET_APP_PASSWORD))

  if (!hasCredentials) {
    return {
      kind: 'not-authenticated',
      detail: 'Set BITBUCKET_ACCESS_TOKEN or BITBUCKET_USERNAME + BITBUCKET_APP_PASSWORD.',
    }
  }

  try {
    await runner('user')
    return { kind: 'ok' }
  } catch (error) {
    const err = error as Error & { status?: number }
    if (err.status === 401 || err.status === 403) {
      return { kind: 'not-authenticated', detail: 'Bitbucket credentials are invalid.' }
    }
    return { kind: 'unknown', detail: err.message || 'Bitbucket API probe failed.' }
  }
}

export async function isBitbucketAuthenticated(runner: BitbucketRunner): Promise<boolean> {
  return (await getBitbucketStatus(runner)).kind === 'ok'
}

export function describeBitbucketStatus(status: GhStatus): string {
  switch (status.kind) {
    case 'ok':
      return 'Bitbucket is authenticated.'
    case 'not-installed':
      return 'Bitbucket API client is unavailable.'
    case 'not-authenticated':
      return `Not authenticated to Bitbucket. Set BITBUCKET_ACCESS_TOKEN or BITBUCKET_USERNAME + BITBUCKET_APP_PASSWORD.${status.detail ? ` Details: ${status.detail}` : ''}`
    case 'unknown':
      return `Bitbucket API returned an unexpected error: ${status.detail}`
  }
}

export function compactBitbucketError(message: string): GhActionError {
  const lines = message
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  return {
    message: lines[0] || 'Bitbucket API call failed.',
    details: lines.slice(1, 8),
  }
}

/**
 * Turn a thrown Bitbucket error into a user-facing message, re-probing auth
 * on the error path so a mid-session credential expiry yields the recovery hint
 * instead of raw HTTP error output. Mirrors `resolveGlabActionError`.
 */
export async function resolveBitbucketActionError(
  error: unknown,
  runner: BitbucketRunner
): Promise<GhActionError> {
  const raw = (error as Error)?.message || 'Bitbucket API call failed.'

  try {
    const status = await getBitbucketStatus(runner)
    if (status.kind !== 'ok') {
      return { message: describeBitbucketStatus(status) }
    }
  } catch {
    // Auth probe itself failed; fall back to the raw error.
  }

  return compactBitbucketError(raw)
}
