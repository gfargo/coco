import { SimpleGit } from 'simple-git'
import {
  GH_DEFAULT_TIMEOUT_MS,
  resolveForgeProject,
  type GhActionError,
  type GhStatus,
} from './githubCli'
import type { ForgeActionResult } from './pullRequestActions'
import { compactCliError, resolveForgeActionError } from './forgeErrors'

/**
 * Gitea / Forgejo (incl. Codeberg) project coordinates parsed from a remote
 * URL. `owner` is the org/user namespace; `name` is the repo slug; `path` is
 * `owner/name`; `host` is the remote's hostname — unlike Bitbucket's fixed
 * `api.bitbucket.org`, every Gitea/Forgejo install serves its own API at
 * `https://<host>/api/v1`, so callers need the host to address the right server.
 */
export type GiteaProject = {
  owner: string
  name: string
  path: string
  host: string
}

export type GiteaRunnerOptions = {
  method?: string
  body?: string
  signal?: AbortSignal
  timeout?: number
}

/**
 * HTTP runner for the Gitea/Forgejo REST API v1. Takes an endpoint path
 * relative to the API base (e.g. `repos/owner/repo/pulls`) and optional
 * request options; returns the response body as a string. Injectable so
 * tests can swap it for a fake without real HTTP.
 */
export type GiteaRunner = (
  endpoint: string,
  options?: GiteaRunnerOptions
) => Promise<string>

function buildAuthHeaders(): Record<string, string> {
  const token = process.env.GITEA_TOKEN
  return token ? { Authorization: `token ${token}` } : {}
}

/**
 * Build a REST runner bound to a specific Gitea/Forgejo host. The API base is
 * per-install (`https://<host>/api/v1`), so a runner must be constructed for
 * the host of the detected repository rather than pointing at one shared
 * constant the way `defaultBitbucketRunner` can.
 */
export function makeGiteaRunner(host: string): GiteaRunner {
  const base = `https://${host}/api/v1`

  return async function defaultGiteaRunner(
    endpoint: string,
    options: GiteaRunnerOptions = {}
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
        new Error(`Gitea API error ${response.status}: ${text}`),
        { status: response.status }
      )
    }
    return text
  }
}

/** Parse the Gitea/Forgejo owner/repo from the repo's origin remote (else first). */
export async function getGiteaProject(git: SimpleGit): Promise<GiteaProject | undefined> {
  return resolveForgeProject(git)
}

/**
 * Probe Gitea/Forgejo auth by checking for a token in the environment and (if
 * present) calling GET /user. Missing or invalid tokens return
 * `not-authenticated`; network failures return `unknown`.
 */
export async function getGiteaStatus(runner: GiteaRunner): Promise<GhStatus> {
  if (!process.env.GITEA_TOKEN) {
    return { kind: 'not-authenticated', detail: 'Set GITEA_TOKEN.' }
  }

  try {
    await runner('user')
    return { kind: 'ok' }
  } catch (error) {
    const err = error as Error & { status?: number }
    if (err.status === 401 || err.status === 403) {
      return { kind: 'not-authenticated', detail: 'GITEA_TOKEN is invalid.' }
    }
    return { kind: 'unknown', detail: err.message || 'Gitea API probe failed.' }
  }
}

export async function isGiteaAuthenticated(runner: GiteaRunner): Promise<boolean> {
  return (await getGiteaStatus(runner)).kind === 'ok'
}

export function describeGiteaStatus(status: GhStatus): string {
  switch (status.kind) {
    case 'ok':
      return 'Gitea is authenticated.'
    case 'not-installed':
      return 'Gitea API client is unavailable.'
    case 'not-authenticated':
      return `Not authenticated to Gitea. Set GITEA_TOKEN.${status.detail ? ` Details: ${status.detail}` : ''}`
    case 'unknown':
      return `Gitea API returned an unexpected error: ${status.detail}`
  }
}

/**
 * Compact a multi-line Gitea error into a head line plus bounded detail
 * lines. Thin wrapper over the shared `compactCliError`, mirroring
 * `compactBitbucketError`. Gitea errors come from `fetch`, not `execFile`, so
 * they carry no `Command failed:`-prefixed argv echo.
 */
export function compactGiteaError(message: string): GhActionError {
  return compactCliError(message, { fallback: 'Gitea API call failed.' })
}

/**
 * Turn a thrown Gitea error into a user-facing message, re-probing auth on
 * the error path so a mid-session token revocation yields the recovery hint
 * instead of raw HTTP error output. Mirrors `resolveBitbucketActionError` via
 * the shared `resolveForgeActionError` scaffold.
 */
export async function resolveGiteaActionError(
  error: unknown,
  runner: GiteaRunner
): Promise<GhActionError> {
  return resolveForgeActionError(error, {
    probe: () => getGiteaStatus(runner),
    describe: describeGiteaStatus,
    fallback: 'Gitea API call failed.',
  })
}

/**
 * Shared try/run/resolve-error wrapper for every Gitea REST mutating action
 * (PR and issue actions alike), mirroring `runBitbucketAction`.
 */
export async function runGiteaAction(
  runner: GiteaRunner,
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
    const { message, details } = await resolveGiteaActionError(error, runner)
    return { ok: false, message, ...(details && details.length ? { details } : {}) }
  }
}
