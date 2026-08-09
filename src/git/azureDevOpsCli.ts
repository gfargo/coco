import { SimpleGit } from 'simple-git'
import { GH_DEFAULT_TIMEOUT_MS, resolveDefaultRemote, type GhActionError, type GhStatus } from './githubCli'
import type { ForgeActionResult } from './pullRequestActions'
import { compactCliError, resolveForgeActionError } from './forgeErrors'

/**
 * Azure DevOps Repos project coordinates parsed from a remote URL. Azure's
 * resource hierarchy is org / project / repo — three segments, where every
 * other forge coco supports has two (owner/name). To keep the existing
 * `ProviderRepository` `owner`/`name` shape (and everything built on it —
 * `useForgeAdapter`, the command handlers) working unchanged, `owner` carries
 * BOTH the org and project (`"{org}/{project}"`) and `name` carries the bare
 * repo slug; `path` is the full `"{org}/{project}/{repo}"`. This mirrors how
 * GitLab subgroups already force a multi-segment `owner`.
 *
 * `host` is the remote's hostname — `dev.azure.com`, `ssh.dev.azure.com`, or
 * an `{org}.visualstudio.com` vanity host. API calls always target the HTTPS
 * REST host (never `ssh.dev.azure.com`) — see `makeAzureDevOpsRunner`.
 */
export type AzureDevOpsProject = {
  org: string
  project: string
  repo: string
  owner: string
  name: string
  path: string
  host: string
}

/** True for any host Azure DevOps Repos serves — cloud (`dev.azure.com` family) only; on-prem Server hosts reach this forge via `forgeHosts` overrides instead. */
export function isAzureDevOpsHost(host: string): boolean {
  const h = host.toLowerCase()
  return h === 'dev.azure.com' || h === 'ssh.dev.azure.com' || h.endsWith('.visualstudio.com')
}

function buildProject(org: string, project: string, repo: string, host: string): AzureDevOpsProject {
  return {
    org,
    project,
    repo,
    owner: `${org}/${project}`,
    name: repo,
    path: `${org}/${project}/${repo}`,
    host,
  }
}

/**
 * Azure DevOps has two URL topologies coco needs to parse (`parseRemoteUrl`
 * in `githubCli.ts` cannot — it yields `owner="{org}/{project}/_git"` for
 * the dev.azure.com form, folding the `_git` marker segment into the owner):
 *
 *   - `https://dev.azure.com/{org}/{project}/_git/{repo}` — org is a path
 *     segment. A legacy on-prem "collection" segment
 *     (`https://host/{collection}/{org}/{project}/_git/{repo}`) is handled
 *     best-effort by folding any segments before `_git` other than the
 *     leading org into the project name.
 *   - `git@ssh.dev.azure.com:v3/{org}/{project}/{repo}` — scp-style SSH,
 *     `v3/` prefix, no `_git` marker.
 *   - `https://{org}.visualstudio.com/{project}/_git/{repo}` — org lives in
 *     the subdomain instead of the path.
 */
export function parseAzureDevOpsRemoteUrl(url: string): AzureDevOpsProject | undefined {
  const trimmed = url.trim().replace(/\.git$/, '')

  if (!trimmed.includes('://')) {
    // scp-style: [user@]host:path
    const m = trimmed.match(/^(?:[^@/]+@)?([^/:]+):(.+)$/)
    if (!m) return undefined
    const host = m[1].toLowerCase()
    if (!isAzureDevOpsHost(host)) return undefined
    const rawPath = m[2].replace(/^\/+/, '')
    const segments = rawPath.split('/').filter(Boolean)
    const withoutV3 = segments[0] === 'v3' ? segments.slice(1) : segments
    if (withoutV3.length < 3) return undefined
    const [org, project, repo] = withoutV3.slice(-3)
    return buildProject(org, project, repo, host)
  }

  const m = trimmed.match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/i)
  if (!m) return undefined
  const host = m[1].toLowerCase()
  if (!isAzureDevOpsHost(host)) return undefined
  const segments = m[2].replace(/^\/+/, '').split('/').filter(Boolean)
  const gitIdx = segments.indexOf('_git')
  if (gitIdx < 0 || gitIdx + 1 >= segments.length) return undefined

  if (host !== 'dev.azure.com' && host.endsWith('.visualstudio.com')) {
    // Org lives in the subdomain; everything before `_git` is the project
    // (folding in any collection segment for on-prem-style path layouts).
    const org = host.split('.')[0]
    const project = segments.slice(0, gitIdx).join('/')
    if (!project) return undefined
    return buildProject(org, project, segments[gitIdx + 1], host)
  }

  // dev.azure.com/{org}/{project}/_git/{repo} — org is the first segment;
  // anything between org and `_git` (normally just the project, but a
  // collection segment on some on-prem-style layouts) becomes the project.
  if (gitIdx < 2) return undefined
  const org = segments[0]
  const project = segments.slice(1, gitIdx).join('/')
  return buildProject(org, project, segments[gitIdx + 1], host)
}

/** Parse the Azure DevOps org/project/repo from the repo's origin remote (else first). */
export async function getAzureDevOpsProject(git: SimpleGit): Promise<AzureDevOpsProject | undefined> {
  const resolved = await resolveDefaultRemote(git)
  if (!resolved) return undefined
  return parseAzureDevOpsRemoteUrl(resolved.url)
}

export type AzureDevOpsRunnerOptions = {
  method?: string
  body?: string
  signal?: AbortSignal
  timeout?: number
}

/**
 * HTTP runner for the Azure DevOps REST API. Takes an endpoint path relative
 * to the org/project `_apis` base (e.g. `git/repositories/{repo}/pullrequests`)
 * — or an absolute URL, used for calls against a different API host such as
 * `vssps.dev.azure.com` for identity resolution — and optional request
 * options; returns the response body as a string. Injectable so tests can
 * swap it for a fake without real HTTP.
 */
export type AzureDevOpsRunner = (
  endpoint: string,
  options?: AzureDevOpsRunnerOptions
) => Promise<string>

const AZURE_DEVOPS_API_VERSION = '7.1'

function withApiVersion(url: string): string {
  if (/[?&]api-version=/.test(url)) return url
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}api-version=${AZURE_DEVOPS_API_VERSION}`
}

/**
 * Azure DevOps authenticates with a Personal Access Token over HTTP Basic —
 * NOT the `token <t>` scheme GitHub/GitLab/Gitea use. The username half of
 * the Basic pair is conventionally empty; only the PAT matters.
 */
function buildAuthHeaders(): Record<string, string> {
  const token = process.env.AZURE_DEVOPS_TOKEN
  if (!token) return {}
  return { Authorization: `Basic ${Buffer.from(`:${token}`).toString('base64')}` }
}

/**
 * Build a REST runner bound to a specific org/project. The API base is
 * `https://{host}/{org}/{project}/_apis` for dev.azure.com, or
 * `https://{host}/{project}/_apis` for an `{org}.visualstudio.com` host
 * (org already lives in the subdomain there). `ssh.dev.azure.com` — a valid
 * git remote host but not a REST API host — is normalized to
 * `dev.azure.com` so an SSH-cloned repo's runner still resolves.
 */
export function makeAzureDevOpsRunner(host: string, org: string, project: string): AzureDevOpsRunner {
  const apiHost = host.toLowerCase() === 'ssh.dev.azure.com' ? 'dev.azure.com' : host
  const isVisualStudio = apiHost.toLowerCase().endsWith('.visualstudio.com')
  const base = isVisualStudio
    ? `https://${apiHost}/${encodeURIComponent(project)}/_apis`
    : `https://${apiHost}/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis`

  return async function defaultAzureDevOpsRunner(
    endpoint: string,
    options: AzureDevOpsRunnerOptions = {}
  ): Promise<string> {
    const timeout = options.timeout ?? GH_DEFAULT_TIMEOUT_MS
    const signal = options.signal ?? AbortSignal.timeout(timeout)
    const url = withApiVersion(endpoint.startsWith('http') ? endpoint : `${base}/${endpoint}`)

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
        new Error(`Azure DevOps API error ${response.status}: ${text}`),
        { status: response.status }
      )
    }
    return text
  }
}

/**
 * Probe Azure DevOps auth by checking for a PAT in the environment and (if
 * present) listing the project's repositories — a low-cost, always-present
 * endpoint requiring only Code (Read) scope, the minimum this forge needs.
 * Missing or invalid tokens return `not-authenticated`; network failures
 * return `unknown`.
 */
export async function getAzureDevOpsStatus(runner: AzureDevOpsRunner): Promise<GhStatus> {
  if (!process.env.AZURE_DEVOPS_TOKEN) {
    return { kind: 'not-authenticated', detail: 'Set AZURE_DEVOPS_TOKEN.' }
  }

  try {
    await runner('git/repositories')
    return { kind: 'ok' }
  } catch (error) {
    const err = error as Error & { status?: number }
    if (err.status === 401 || err.status === 403) {
      return { kind: 'not-authenticated', detail: 'AZURE_DEVOPS_TOKEN is invalid.' }
    }
    return { kind: 'unknown', detail: err.message || 'Azure DevOps API probe failed.' }
  }
}

export async function isAzureDevOpsAuthenticated(runner: AzureDevOpsRunner): Promise<boolean> {
  return (await getAzureDevOpsStatus(runner)).kind === 'ok'
}

export function describeAzureDevOpsStatus(status: GhStatus): string {
  switch (status.kind) {
    case 'ok':
      return 'Azure DevOps is authenticated.'
    case 'not-installed':
      return 'Azure DevOps API client is unavailable.'
    case 'not-authenticated':
      return `Not authenticated to Azure DevOps. Set AZURE_DEVOPS_TOKEN.${status.detail ? ` Details: ${status.detail}` : ''}`
    case 'unknown':
      return `Azure DevOps API returned an unexpected error: ${status.detail}`
  }
}

/**
 * Compact a multi-line Azure DevOps error into a head line plus bounded
 * detail lines. Thin wrapper over the shared `compactCliError`, mirroring
 * `compactGiteaError` / `compactBitbucketServerError`.
 */
export function compactAzureDevOpsError(message: string): GhActionError {
  return compactCliError(message, { fallback: 'Azure DevOps API call failed.' })
}

/**
 * Turn a thrown Azure DevOps error into a user-facing message, re-probing
 * auth on the error path so a mid-session token revocation yields the
 * recovery hint instead of raw HTTP error output. Mirrors
 * `resolveGiteaActionError` via the shared `resolveForgeActionError` scaffold.
 */
export async function resolveAzureDevOpsActionError(
  error: unknown,
  runner: AzureDevOpsRunner
): Promise<GhActionError> {
  return resolveForgeActionError(error, {
    probe: () => getAzureDevOpsStatus(runner),
    describe: describeAzureDevOpsStatus,
    fallback: 'Azure DevOps API call failed.',
  })
}

/**
 * Shared try/run/resolve-error wrapper for every Azure DevOps REST mutating
 * action, mirroring `runGiteaAction` / `runBitbucketServerAction`.
 */
export async function runAzureDevOpsAction(
  runner: AzureDevOpsRunner,
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
    const { message, details } = await resolveAzureDevOpsActionError(error, runner)
    return { ok: false, message, ...(details && details.length ? { details } : {}) }
  }
}

/**
 * Split the facade's flattened `"{org}/{project}/{repo}"` path (built from
 * `ProviderRepository.owner`/`.name` — see `getProviderRepository`'s Azure
 * branch) back into a full `AzureDevOpsProject`. `org` is the first segment,
 * `repo` the last; anything in between is the project (normally one
 * segment, but folded multi-segment on a legacy on-prem "collection"
 * layout — see `parseAzureDevOpsRemoteUrl`). `host` comes from the
 * `ProviderRepository` this path was built from — passed separately since
 * it isn't encoded in the path itself.
 */
export function splitAzureDevOpsPath(path: string, host: string): AzureDevOpsProject | undefined {
  const segments = path.split('/').filter(Boolean)
  if (segments.length < 3) return undefined
  const org = segments[0]
  const repo = segments[segments.length - 1]
  const project = segments.slice(1, -1).join('/')
  if (!org || !project || !repo) return undefined
  return buildProject(org, project, repo, host)
}

export type AzureDevOpsIdentity = {
  id?: string
  /** Email-like unique name — the closest Azure analogue to a login, used for author/assignee filter matching. */
  uniqueName?: string
}

/**
 * Resolve the authenticated PAT holder's identity — id (a GUID) and unique
 * name (email-like). Azure DevOps's PR review-vote endpoint
 * (`PUT .../reviewers/{reviewerId}`) addresses reviewers by identity id, not
 * username, so voting "as yourself" (approve / request-changes) requires
 * resolving your own id first; `'@me'` author/assignee filters need the
 * unique name instead. Hits `vssps.dev.azure.com` — a distinct API host from
 * the org/project-scoped `_apis` base every other call in this forge uses —
 * via the runner's absolute-URL passthrough.
 */
export async function resolveAzureDevOpsSelfIdentity(
  org: string,
  runner: AzureDevOpsRunner
): Promise<AzureDevOpsIdentity | undefined> {
  try {
    const out = (
      await runner(`https://vssps.dev.azure.com/${encodeURIComponent(org)}/_apis/profile/profiles/me`)
    ).trim()
    if (!out) return undefined
    const data = JSON.parse(out) as { id?: string; emailAddress?: string }
    return { id: data.id, uniqueName: data.emailAddress }
  } catch {
    return undefined
  }
}

/**
 * Build the web (browsable) URL for an Azure DevOps repository. Azure PR/API
 * responses carry only the REST `url` (the `_apis` resource), never a web
 * URL — every web link this forge produces is built from these coordinates.
 * `ssh.dev.azure.com` (a valid git-remote host, not a web host) is
 * normalized to `dev.azure.com`, mirroring `makeAzureDevOpsRunner`.
 */
export function buildAzureDevOpsRepoWebUrl(project: AzureDevOpsProject): string {
  const displayHost = project.host.toLowerCase() === 'ssh.dev.azure.com' ? 'dev.azure.com' : project.host
  const isVisualStudio = displayHost.toLowerCase().endsWith('.visualstudio.com')
  return isVisualStudio
    ? `https://${displayHost}/${encodeURIComponent(project.project)}/_git/${encodeURIComponent(project.repo)}`
    : `https://${displayHost}/${encodeURIComponent(project.org)}/${encodeURIComponent(project.project)}/_git/${encodeURIComponent(project.repo)}`
}
