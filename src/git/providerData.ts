import { SimpleGit } from 'simple-git'
import { BranchRef } from './branchData'
import {
  describeGhStatus,
  getGhStatus,
  parseGitHubRemoteUrl as parseGitHubRemoteUrlBase,
  parseRemoteUrl,
  resolveDefaultRemote,
  type GhRunner,
  defaultGhRunner,
} from './githubCli'
import {
  defaultGlabRunner,
  describeGlabStatus,
  getGlabStatus,
  type GlabRunner,
} from './glabCli'
import {
  describeBitbucketStatus,
  getBitbucketStatus,
  makeBitbucketRunner,
  type BitbucketRunner,
} from './bitbucketCli'
import { findOpenBitbucketPullRequestForBranch } from './bitbucketListData'
import { findOpenMergeRequestForBranch } from './gitlabListData'
import { describeGiteaStatus, getGiteaStatus, makeGiteaRunner, type GiteaRunner } from './giteaCli'
import { findOpenGiteaPullRequestForBranch } from './giteaListData'
import {
  describeBitbucketServerStatus,
  getBitbucketServerStatus,
  makeBitbucketServerRunner,
  stripScmSegment,
  type BitbucketServerRunner,
} from './bitbucketServerCli'
import { findOpenBitbucketServerPullRequestForBranch } from './bitbucketServerListData'
import {
  describeAzureDevOpsStatus,
  getAzureDevOpsStatus,
  isAzureDevOpsHost,
  makeAzureDevOpsRunner,
  parseAzureDevOpsRemoteUrl,
  buildAzureDevOpsRepoWebUrl,
  splitAzureDevOpsPath,
  type AzureDevOpsRunner,
} from './azureDevOpsCli'
import { findOpenAzureDevOpsPullRequestForBranch } from './azureDevOpsListData'

export type GitProviderType =
  | 'github'
  | 'gitlab'
  | 'bitbucket'
  | 'bitbucket-server'
  | 'gitea'
  | 'azure-devops'
  | 'unsupported'

export type ProviderRepository = {
  provider: GitProviderType
  remote: string
  /** Lowercased remote host (`github.com`, `gitlab.com`, `ghe.acme.com`, ...). */
  host?: string
  owner?: string
  name?: string
  webUrl?: string
  defaultBranch?: string
  message?: string
}

export type ProviderPullRequestStatus = {
  number: number
  title: string
  state: string
  isDraft: boolean
  reviewDecision?: string
  statusCheckRollup?: Array<{
    name: string
    conclusion?: string
    status?: string
  }>
}

export type ProviderOverview = {
  repository: ProviderRepository
  currentBranch?: string
  currentPullRequest?: ProviderPullRequestStatus
  authenticated: boolean
  message?: string
}

export type ProviderUrlTarget =
  | { type: 'repo' }
  | { type: 'branch'; branch: string }
  | { type: 'commit'; commit: string }
  | { type: 'pull-request'; number: number }
  | { type: 'compare'; base: string; head: string }

export function parseGitHubRemoteUrl(
  url: string
): Pick<ProviderRepository, 'owner' | 'name' | 'webUrl'> | undefined {
  const base = parseGitHubRemoteUrlBase(url)

  if (!base) {
    return undefined
  }

  return {
    ...base,
    webUrl: `https://github.com/${base.owner}/${base.name}`,
  }
}

/**
 * Map a remote host to a forge. Known hosts win first; unknown self-hosted
 * hosts fall back to a hostname heuristic (`*gitlab*` -> gitlab, `*github*` ->
 * github, which also catches GitHub Enterprise hosts named like
 * `github.acme.com`). Anything else is `unsupported`.
 */
/**
 * Per-host forge overrides from config (`forgeHosts`), set once per run by the
 * command executor. Lets self-hosted installs on vanity hostnames (no `gitlab`
 * / `github` in the name) be detected explicitly.
 */
let forgeHostOverrides: Record<
  string,
  'github' | 'gitlab' | 'bitbucket' | 'bitbucket-server' | 'gitea' | 'azure-devops'
> = {}

export function setForgeHostOverrides(
  overrides:
    | Record<string, 'github' | 'gitlab' | 'bitbucket' | 'bitbucket-server' | 'gitea' | 'azure-devops'>
    | undefined
): void {
  forgeHostOverrides = {}
  if (overrides) {
    for (const [host, provider] of Object.entries(overrides)) {
      forgeHostOverrides[host.toLowerCase()] = provider
    }
  }
}

/**
 * `bitbucket-server` is deliberately reachable ONLY via `forgeHostOverrides`
 * — there is no reliable hostname heuristic that distinguishes a Bitbucket
 * Server/DC install from Bitbucket Cloud (both are commonly hosted on a
 * `*bitbucket*`-named host), so any `*bitbucket*` host that isn't overridden
 * keeps resolving to Cloud, same as before.
 */
export function detectProvider(host: string): GitProviderType {
  const h = host.toLowerCase()
  if (forgeHostOverrides[h]) return forgeHostOverrides[h]
  if (h === 'github.com') return 'github'
  if (h === 'gitlab.com') return 'gitlab'
  // dev.azure.com / ssh.dev.azure.com / {org}.visualstudio.com — cloud Azure
  // DevOps only. A self-hosted Azure DevOps Server install has no reliable
  // hostname heuristic (it's whatever the org named it), so it's reachable
  // ONLY via `forgeHosts`, mirroring `bitbucket-server`.
  if (isAzureDevOpsHost(h)) return 'azure-devops'
  // Any `*bitbucket*` host is classified as `bitbucket` — including self-hosted
  // Bitbucket Server / Data Center, which coco doesn't implement. The runner
  // (`makeBitbucketRunner`) gates non-`bitbucket.org` hosts with an explicit
  // "not supported" refusal rather than silently hitting Bitbucket Cloud (#1899).
  if (h === 'bitbucket.org' || h.includes('bitbucket')) return 'bitbucket'
  if (h === 'codeberg.org') return 'gitea'
  if (h.includes('gitlab')) return 'gitlab'
  if (h.includes('github')) return 'github'
  if (h.includes('gitea') || h.includes('forgejo') || h.includes('codeberg')) return 'gitea'
  return 'unsupported'
}

export function getProviderRepository(remoteName: string, remoteUrl: string): ProviderRepository {
  const parsed = parseRemoteUrl(remoteUrl)

  if (!parsed) {
    return {
      provider: 'unsupported',
      remote: remoteName,
      message: `Unsupported remote provider for ${remoteName}.`,
    }
  }

  const provider = detectProvider(parsed.host)

  if (provider === 'unsupported') {
    return {
      provider: 'unsupported',
      remote: remoteName,
      host: parsed.host,
      owner: parsed.owner,
      name: parsed.name,
      message: `Unsupported remote host "${parsed.host}" for ${remoteName}.`,
    }
  }

  // Azure DevOps's resource hierarchy is org/project/repo — three segments
  // where the generic `parseRemoteUrl` heuristic (built for two-segment
  // owner/name forges) yields a garbled owner (`"{org}/{project}/_git"`).
  // `parseAzureDevOpsRemoteUrl` re-parses the raw URL to get clean
  // coordinates; `owner` carries `"{org}/{project}"` and `name` the bare
  // repo slug, so `path` (`owner/name`) round-trips to the full
  // `"{org}/{project}/{repo}"` triple everywhere downstream expects a
  // two-segment `owner/name` shape (see `azureDevOpsCli.ts`'s docblock).
  if (provider === 'azure-devops') {
    const azureProject = parseAzureDevOpsRemoteUrl(remoteUrl)
    if (!azureProject) {
      return {
        provider: 'unsupported',
        remote: remoteName,
        host: parsed.host,
        owner: parsed.owner,
        name: parsed.name,
        message: `Could not parse Azure DevOps remote host "${parsed.host}" for ${remoteName}.`,
      }
    }
    return {
      provider,
      remote: remoteName,
      host: azureProject.host,
      owner: azureProject.owner,
      name: azureProject.name,
      webUrl: buildAzureDevOpsRepoWebUrl(azureProject),
    }
  }

  // Bitbucket Server's HTTP(S) clone URL carries an extra `/scm/` path
  // segment (`https://host/scm/PROJECT/repo.git`) that the generic
  // owner-parsing heuristic has no reason to strip — see `stripScmSegment`.
  // Its web UI also lives under `/projects/<key>/repos/<slug>` rather than
  // GitHub/GitLab/Bitbucket Cloud's bare `/<owner>/<name>`.
  const owner = provider === 'bitbucket-server' ? stripScmSegment(parsed.owner) : parsed.owner
  const webUrl =
    provider === 'bitbucket-server'
      ? `https://${parsed.host}/projects/${owner}/repos/${parsed.name}`
      : `https://${parsed.host}/${owner}/${parsed.name}`

  return {
    provider,
    remote: remoteName,
    host: parsed.host,
    owner,
    name: parsed.name,
    webUrl,
  }
}

/**
 * Resolve the provider repository directly from a git instance (origin remote,
 * else the first remote). Pure remote parsing, no network — used by the list
 * command factory to detect the forge and render the header on the cache-hit
 * path. Returns undefined when no remote is configured.
 */
export async function getProviderRepositoryForGit(
  git: SimpleGit
): Promise<ProviderRepository | undefined> {
  const resolved = await resolveDefaultRemote(git)
  return resolved ? getProviderRepository(resolved.name, resolved.url) : undefined
}

export type GitHubRepositoryWithHost = {
  owner: string
  name: string
  /** Lowercased remote host — `github.com` or a GitHub Enterprise host. */
  host: string
}

/**
 * Host-aware replacement for `githubCli.ts`'s `getGitHubRepository`
 * (github.com-only by design — see that function's docblock). Uses the
 * same provider detection `getProviderOverview` relies on (the
 * `*github*` hostname heuristic plus `forgeHosts` overrides), so a
 * GitHub Enterprise remote resolves here the same way it already does
 * for auth probing, instead of being rejected outright (#1609).
 */
export async function getGitHubRepositoryForGit(
  git: SimpleGit
): Promise<GitHubRepositoryWithHost | undefined> {
  const repository = await getProviderRepositoryForGit(git)
  if (!repository || repository.provider !== 'github' || !repository.owner || !repository.name || !repository.host) {
    return undefined
  }
  return { owner: repository.owner, name: repository.name, host: repository.host }
}

export function buildProviderUrl(
  repository: ProviderRepository,
  target: ProviderUrlTarget
): string | undefined {
  if (repository.provider === 'unsupported' || !repository.webUrl) {
    return undefined
  }

  const base = repository.webUrl
  const isBitbucket = repository.provider === 'bitbucket'
  const isBitbucketServer = repository.provider === 'bitbucket-server'
  const isGitea = repository.provider === 'gitea'
  const isAzureDevOps = repository.provider === 'azure-devops'
  // GitLab namespaces every sub-path under `/-/`; GitHub and Bitbucket do not.
  const seg = repository.provider === 'gitlab' ? '/-' : ''

  if (target.type === 'repo') {
    // `webUrl` for Bitbucket Server is the bare `/projects/<key>/repos/<slug>`
    // resource (see `getProviderRepository`) — its browsable UI root nests
    // one level deeper, under `/browse`.
    return isBitbucketServer ? `${base}/browse` : base
  }

  if (target.type === 'branch') {
    if (isBitbucketServer) return `${base}/browse?at=${encodeURIComponent(`refs/heads/${target.branch}`)}`
    if (isBitbucket) return `${base}/branch/${encodeURIComponent(target.branch)}`
    // Gitea/Forgejo browse a branch under `/src/branch/`, not GitHub's `/tree/`.
    if (isGitea) return `${base}/src/branch/${encodeURIComponent(target.branch)}`
    // Azure DevOps addresses a branch via a `version=GB<branch>` query param
    // on the repo root, not a path segment.
    if (isAzureDevOps) return `${base}?version=GB${encodeURIComponent(target.branch)}`
    return `${base}${seg}/tree/${encodeURIComponent(target.branch)}`
  }

  if (target.type === 'commit') {
    if (isBitbucketServer) return `${base}/commits/${encodeURIComponent(target.commit)}`
    if (isAzureDevOps) return `${base}/commit/${encodeURIComponent(target.commit)}`
    return isBitbucket
      ? `${base}/commits/${encodeURIComponent(target.commit)}`
      : `${base}${seg}/commit/${encodeURIComponent(target.commit)}`
  }

  if (target.type === 'pull-request') {
    if (repository.provider === 'gitlab') return `${base}/-/merge_requests/${target.number}`
    if (isBitbucketServer) return `${base}/pull-requests/${target.number}/overview`
    if (isBitbucket) return `${base}/pull-requests/${target.number}`
    // Gitea/Forgejo use the plural `/pulls/{n}`, unlike GitHub's singular `/pull/{n}`.
    if (isGitea) return `${base}/pulls/${target.number}`
    // Azure DevOps uses the singular, unhyphenated `/pullrequest/{n}`.
    if (isAzureDevOps) return `${base}/pullrequest/${target.number}`
    return `${base}/pull/${target.number}`
  }

  if (isBitbucketServer) {
    const sourceBranch = encodeURIComponent(`refs/heads/${target.head}`)
    const targetBranch = encodeURIComponent(`refs/heads/${target.base}`)
    return `${base}/compare/commits?sourceBranch=${sourceBranch}&targetBranch=${targetBranch}`
  }

  if (isBitbucket) {
    return `${base}/branches/compare/${encodeURIComponent(target.head)}%0D${encodeURIComponent(target.base)}`
  }

  if (isAzureDevOps) {
    const baseVersion = encodeURIComponent(`GB${target.base}`)
    const targetVersion = encodeURIComponent(`GB${target.head}`)
    return `${base}/branchCompare?baseVersion=${baseVersion}&targetVersion=${targetVersion}`
  }

  return `${base}${seg}/compare/${encodeURIComponent(target.base)}...${encodeURIComponent(target.head)}`
}

function parseRepositoryJson(output: string): { defaultBranchRef?: { name?: string } } | undefined {
  const trimmed = output.trim()

  return trimmed ? JSON.parse(trimmed) : undefined
}

function parsePullRequestJson(output: string): ProviderPullRequestStatus | undefined {
  const trimmed = output.trim()

  return trimmed ? JSON.parse(trimmed) as ProviderPullRequestStatus : undefined
}

async function getDefaultBranch(
  repository: ProviderRepository,
  runner: GhRunner
): Promise<string | undefined> {
  if (repository.provider !== 'github' || !repository.owner || !repository.name) {
    return undefined
  }

  try {
    // A bare `owner/name` slug resolves against gh's default host
    // (github.com) regardless of which host the remote actually lives
    // on — silently querying the wrong server (or an unrelated
    // github.com repo of the same name) for a GitHub Enterprise remote
    // (#1609). The full URL form carries the host explicitly.
    const target =
      repository.host && repository.host !== 'github.com' && repository.webUrl
        ? repository.webUrl
        : `${repository.owner}/${repository.name}`

    const output = await runner([
      'repo',
      'view',
      target,
      '--json',
      'defaultBranchRef',
    ])

    return parseRepositoryJson(output)?.defaultBranchRef?.name
  } catch {
    return undefined
  }
}

/**
 * Local-only fallback for the default branch — used when no GitHub
 * remote is configured, when `gh` isn't authenticated, or when
 * `gh repo view` fails (e.g. private repo we can't access, offline).
 *
 * Detection order, picking the first that resolves:
 *   1. `origin/HEAD` — the symbolic ref set by `git clone` pointing at
 *      whatever the remote's default branch was at clone time. This is
 *      the most authoritative local signal.
 *   2. Conventional branch names checked against local refs in order:
 *      `main`, `master`, `develop`, `trunk`.
 *
 * Returns `undefined` when nothing matches — caller surfaces that as
 * "no default branch detected" without claiming any particular cause.
 *
 * Pure local-ref reads (no network) — safe to call on every overview
 * load regardless of provider state.
 */
export async function detectLocalDefaultBranch(git: SimpleGit): Promise<string | undefined> {
  // origin/HEAD — set by `git clone` to track the remote's HEAD. The
  // symbolic-ref output is the full ref (refs/remotes/origin/main); we
  // strip the prefix to get just the branch name. `--short` would do it
  // too but isn't supported on older git, and the prefix is fixed-length.
  try {
    const ref = (await git.raw(['symbolic-ref', 'refs/remotes/origin/HEAD'])).trim()
    const match = ref.match(/^refs\/remotes\/origin\/(.+)$/)
    if (match) {
      return match[1]
    }
  } catch {
    // symbolic-ref returns non-zero when origin/HEAD doesn't exist —
    // expected on fresh repos and `git init`-only working trees. Fall
    // through to the conventional-name check.
  }

  // Conventional names — most repos follow one of these. `rev-parse
  // --verify --quiet <ref>` returns 0 + hash on hit, non-zero on miss.
  for (const candidate of ['main', 'master', 'develop', 'trunk']) {
    try {
      await git.raw(['rev-parse', '--verify', '--quiet', `refs/heads/${candidate}`])
      return candidate
    } catch {
      // Not present — try the next one.
    }
  }

  return undefined
}

async function getCurrentPullRequest(
  runner: GhRunner
): Promise<ProviderPullRequestStatus | undefined> {
  try {
    return parsePullRequestJson(await runner([
      'pr',
      'view',
      '--json',
      'number,title,state,isDraft,reviewDecision,statusCheckRollup',
    ]))
  } catch {
    return undefined
  }
}

async function getGitLabDefaultBranch(
  encodedPath: string | undefined,
  runner: GlabRunner
): Promise<string | undefined> {
  if (!encodedPath) return undefined
  try {
    const out = (await runner(['api', `projects/${encodedPath}`])).trim()
    if (!out) return undefined
    return (JSON.parse(out) as { default_branch?: string }).default_branch
  } catch {
    return undefined
  }
}

async function getCurrentMergeRequest(
  projectPath: string,
  sourceBranch: string,
  runner: GlabRunner
): Promise<ProviderPullRequestStatus | undefined> {
  try {
    const mr = await findOpenMergeRequestForBranch(projectPath, sourceBranch, runner)
    if (!mr) return undefined
    return {
      number: Number(mr.iid),
      title: String(mr.title || ''),
      state: String(mr.state || ''),
      isDraft: Boolean(mr.draft ?? mr.work_in_progress),
    }
  } catch {
    return undefined
  }
}

/**
 * Bitbucket overview via REST API: auth probe, default branch, current-branch
 * PR. `runnerFactory` builds the host-bound runner — only `bitbucket.org`
 * reaches Bitbucket Cloud; any other host is refused (mirrors
 * `getGiteaProviderOverview`, see `makeBitbucketRunner`).
 */
async function getBitbucketProviderOverview(
  repository: ProviderRepository,
  currentBranch: string | undefined,
  localDefaultBranch: string | undefined,
  runnerFactory: (host: string) => BitbucketRunner
): Promise<ProviderOverview> {
  const runner = runnerFactory(repository.host ?? '')
  const status = await getBitbucketStatus(runner)
  if (status.kind !== 'ok') {
    return {
      repository: { ...repository, defaultBranch: localDefaultBranch },
      currentBranch,
      authenticated: false,
      message: describeBitbucketStatus(status),
    }
  }

  const path =
    repository.owner && repository.name ? `${repository.owner}/${repository.name}` : undefined

  async function getDefaultBranchBitbucket(): Promise<string | undefined> {
    if (!path) return undefined
    try {
      const out = (await runner(`repositories/${path}`)).trim()
      return out ? (JSON.parse(out) as { mainbranch?: { name?: string } }).mainbranch?.name : undefined
    } catch {
      return undefined
    }
  }

  async function getCurrentPRBitbucket(): Promise<ProviderPullRequestStatus | undefined> {
    if (!path || !currentBranch) return undefined
    try {
      const pr = await findOpenBitbucketPullRequestForBranch(path, currentBranch, runner)
      if (!pr?.id) return undefined
      return {
        number: Number(pr.id),
        title: String(pr.title || ''),
        state: String(pr.state || '').toUpperCase(),
        isDraft: Boolean(pr.draft),
      }
    } catch {
      return undefined
    }
  }

  const [defaultBranch, currentPullRequest] = await Promise.all([
    getDefaultBranchBitbucket(),
    getCurrentPRBitbucket(),
  ])

  return {
    repository: { ...repository, defaultBranch: defaultBranch || localDefaultBranch },
    currentBranch,
    currentPullRequest,
    authenticated: true,
  }
}

/**
 * Gitea/Forgejo overview via REST API: auth probe, default branch,
 * current-branch PR. `runnerFactory` builds the host-bound runner (every
 * Gitea/Forgejo install serves its own API base — see `makeGiteaRunner`).
 */
async function getGiteaProviderOverview(
  repository: ProviderRepository,
  currentBranch: string | undefined,
  localDefaultBranch: string | undefined,
  runnerFactory: (host: string) => GiteaRunner
): Promise<ProviderOverview> {
  const runner = runnerFactory(repository.host ?? '')
  const status = await getGiteaStatus(runner)
  if (status.kind !== 'ok') {
    return {
      repository: { ...repository, defaultBranch: localDefaultBranch },
      currentBranch,
      authenticated: false,
      message: describeGiteaStatus(status),
    }
  }

  const path =
    repository.owner && repository.name ? `${repository.owner}/${repository.name}` : undefined

  async function getDefaultBranchGitea(): Promise<string | undefined> {
    if (!path) return undefined
    try {
      const out = (await runner(`repos/${path}`)).trim()
      return out ? (JSON.parse(out) as { default_branch?: string }).default_branch : undefined
    } catch {
      return undefined
    }
  }

  async function getCurrentPRGitea(): Promise<ProviderPullRequestStatus | undefined> {
    if (!path || !currentBranch) return undefined
    try {
      const pr = await findOpenGiteaPullRequestForBranch(path, currentBranch, runner)
      if (pr?.number == null) return undefined
      return {
        number: Number(pr.number),
        title: String(pr.title || ''),
        state: pr.merged ? 'MERGED' : String(pr.state || '').toUpperCase(),
        isDraft: Boolean(pr.draft),
      }
    } catch {
      return undefined
    }
  }

  const [defaultBranch, currentPullRequest] = await Promise.all([
    getDefaultBranchGitea(),
    getCurrentPRGitea(),
  ])

  return {
    repository: { ...repository, defaultBranch: defaultBranch || localDefaultBranch },
    currentBranch,
    currentPullRequest,
    authenticated: true,
  }
}

/**
 * Bitbucket Server / Data Center overview via REST API 1.0: auth probe,
 * default branch, current-branch PR. `runnerFactory` builds the host-bound
 * runner (every install serves its own API base — see
 * `makeBitbucketServerRunner`), mirroring the Gitea/Forgejo overview.
 */
async function getBitbucketServerProviderOverview(
  repository: ProviderRepository,
  currentBranch: string | undefined,
  localDefaultBranch: string | undefined,
  runnerFactory: (host: string) => BitbucketServerRunner
): Promise<ProviderOverview> {
  const runner = runnerFactory(repository.host ?? '')
  const status = await getBitbucketServerStatus(runner)
  if (status.kind !== 'ok') {
    return {
      repository: { ...repository, defaultBranch: localDefaultBranch },
      currentBranch,
      authenticated: false,
      message: describeBitbucketServerStatus(status),
    }
  }

  const path =
    repository.owner && repository.name ? `${repository.owner}/${repository.name}` : undefined

  async function getDefaultBranchBitbucketServer(): Promise<string | undefined> {
    if (!path) return undefined
    try {
      const out = (await runner(`projects/${repository.owner}/repos/${repository.name}/default-branch`)).trim()
      return out ? (JSON.parse(out) as { displayId?: string }).displayId : undefined
    } catch {
      return undefined
    }
  }

  async function getCurrentPRBitbucketServer(): Promise<ProviderPullRequestStatus | undefined> {
    if (!path || !currentBranch) return undefined
    try {
      const pr = await findOpenBitbucketServerPullRequestForBranch(path, currentBranch, runner)
      if (pr?.id == null) return undefined
      const state = String(pr.state || '').toUpperCase()
      return {
        number: Number(pr.id),
        title: String(pr.title || ''),
        state: state === 'DECLINED' ? 'CLOSED' : state,
        isDraft: Boolean(pr.draft),
      }
    } catch {
      return undefined
    }
  }

  const [defaultBranch, currentPullRequest] = await Promise.all([
    getDefaultBranchBitbucketServer(),
    getCurrentPRBitbucketServer(),
  ])

  return {
    repository: { ...repository, defaultBranch: defaultBranch || localDefaultBranch },
    currentBranch,
    currentPullRequest,
    authenticated: true,
  }
}

/**
 * Azure DevOps overview via REST API: auth probe, default branch,
 * current-branch PR. `runnerFactory` builds the org/project-bound runner
 * (see `makeAzureDevOpsRunner`), mirroring the Gitea/Bitbucket Server
 * overviews. `repository.owner`/`.name` are re-split back into
 * org/project/repo (see `splitAzureDevOpsPath`) since Azure's three-segment
 * hierarchy is flattened into the two-segment `owner`/`name` shape by
 * `getProviderRepository`.
 */
async function getAzureDevOpsProviderOverview(
  repository: ProviderRepository,
  currentBranch: string | undefined,
  localDefaultBranch: string | undefined,
  runnerFactory: (host: string, org: string, project: string) => AzureDevOpsRunner
): Promise<ProviderOverview> {
  const path =
    repository.owner && repository.name ? `${repository.owner}/${repository.name}` : undefined
  const project = path ? splitAzureDevOpsPath(path, repository.host || 'dev.azure.com') : undefined

  if (!project) {
    return {
      repository: { ...repository, defaultBranch: localDefaultBranch },
      currentBranch,
      authenticated: false,
      message: 'Could not resolve the Azure DevOps org/project/repo from this remote.',
    }
  }

  const runner = runnerFactory(project.host, project.org, project.project)
  const status = await getAzureDevOpsStatus(runner)
  if (status.kind !== 'ok') {
    return {
      repository: { ...repository, defaultBranch: localDefaultBranch },
      currentBranch,
      authenticated: false,
      message: describeAzureDevOpsStatus(status),
    }
  }

  const azureProject = project

  async function getDefaultBranchAzureDevOps(): Promise<string | undefined> {
    try {
      const out = (await runner(`git/repositories/${encodeURIComponent(azureProject.repo)}`)).trim()
      const ref = out ? (JSON.parse(out) as { defaultBranch?: string }).defaultBranch : undefined
      return ref ? ref.replace(/^refs\/heads\//, '') : undefined
    } catch {
      return undefined
    }
  }

  async function getCurrentPRAzureDevOps(): Promise<ProviderPullRequestStatus | undefined> {
    if (!currentBranch) return undefined
    try {
      const pr = await findOpenAzureDevOpsPullRequestForBranch(azureProject, currentBranch, runner)
      if (pr?.pullRequestId == null) return undefined
      const status = String(pr.status || '').toLowerCase()
      return {
        number: Number(pr.pullRequestId),
        title: String(pr.title || ''),
        state: status === 'completed' ? 'MERGED' : status === 'abandoned' ? 'CLOSED' : 'OPEN',
        isDraft: Boolean(pr.isDraft),
      }
    } catch {
      return undefined
    }
  }

  const [defaultBranch, currentPullRequest] = await Promise.all([
    getDefaultBranchAzureDevOps(),
    getCurrentPRAzureDevOps(),
  ])

  return {
    repository: { ...repository, defaultBranch: defaultBranch || localDefaultBranch },
    currentBranch,
    currentPullRequest,
    authenticated: true,
  }
}

/** GitLab overview via glab: auth probe, default branch, current-branch MR. */
async function getGitLabProviderOverview(
  repository: ProviderRepository,
  currentBranch: string | undefined,
  localDefaultBranch: string | undefined,
  runner: GlabRunner
): Promise<ProviderOverview> {
  const status = await getGlabStatus(runner, repository.host)
  if (status.kind !== 'ok') {
    return {
      repository: { ...repository, defaultBranch: localDefaultBranch },
      currentBranch,
      authenticated: false,
      message: describeGlabStatus(status),
    }
  }

  const path =
    repository.owner && repository.name ? `${repository.owner}/${repository.name}` : undefined
  const encoded = path ? encodeURIComponent(path) : undefined

  const [defaultBranch, currentPullRequest] = await Promise.all([
    getGitLabDefaultBranch(encoded, runner),
    currentBranch && path ? getCurrentMergeRequest(path, currentBranch, runner) : Promise.resolve(undefined),
  ])

  return {
    repository: { ...repository, defaultBranch: defaultBranch || localDefaultBranch },
    currentBranch,
    currentPullRequest,
    authenticated: true,
  }
}

export async function getProviderOverview(
  git: SimpleGit,
  runner: GhRunner = defaultGhRunner,
  glabRunner: GlabRunner = defaultGlabRunner,
  bitbucketRunnerFactory: (host: string) => BitbucketRunner = makeBitbucketRunner,
  giteaRunnerFactory: (host: string) => GiteaRunner = makeGiteaRunner,
  bitbucketServerRunnerFactory: (host: string) => BitbucketServerRunner = makeBitbucketServerRunner,
  azureDevOpsRunnerFactory: (host: string, org: string, project: string) => AzureDevOpsRunner = makeAzureDevOpsRunner
): Promise<ProviderOverview> {
  const [resolvedRepository, currentBranchOutput, localDefaultBranch] = await Promise.all([
    getProviderRepositoryForGit(git),
    git.raw(['branch', '--show-current']),
    // Read local default-branch signal up-front in parallel — used as
    // the fallback when gh is unavailable / unauthenticated / can't see
    // the repo. Coco aims to be platform-agnostic + work offline; the
    // GH-specific paths layer on top of this, they don't replace it.
    detectLocalDefaultBranch(git),
  ])
  const repository = resolvedRepository ?? {
    provider: 'unsupported' as const,
    remote: 'origin',
    message: 'No Git remote detected.',
  }
  const currentBranch = currentBranchOutput.trim() || undefined

  if (repository.provider === 'gitlab') {
    return getGitLabProviderOverview(repository, currentBranch, localDefaultBranch, glabRunner)
  }

  if (repository.provider === 'bitbucket') {
    return getBitbucketProviderOverview(repository, currentBranch, localDefaultBranch, bitbucketRunnerFactory)
  }

  if (repository.provider === 'gitea') {
    return getGiteaProviderOverview(repository, currentBranch, localDefaultBranch, giteaRunnerFactory)
  }

  if (repository.provider === 'bitbucket-server') {
    return getBitbucketServerProviderOverview(
      repository,
      currentBranch,
      localDefaultBranch,
      bitbucketServerRunnerFactory
    )
  }

  if (repository.provider === 'azure-devops') {
    return getAzureDevOpsProviderOverview(repository, currentBranch, localDefaultBranch, azureDevOpsRunnerFactory)
  }

  if (repository.provider !== 'github') {
    return {
      repository: {
        ...repository,
        defaultBranch: localDefaultBranch,
      },
      currentBranch,
      authenticated: false,
      message: repository.message || 'Unsupported remote provider.',
    }
  }

  // Probe the repo's own host so GitHub Enterprise remotes are checked against
  // their server, not hardcoded github.com.
  const ghStatus = await getGhStatus(runner, repository.host ?? 'github.com')
  if (ghStatus.kind !== 'ok') {
    return {
      repository: {
        ...repository,
        defaultBranch: localDefaultBranch,
      },
      currentBranch,
      authenticated: false,
      message: describeGhStatus(ghStatus),
    }
  }

  const [providerDefaultBranch, currentPullRequest] = await Promise.all([
    getDefaultBranch(repository, runner),
    getCurrentPullRequest(runner),
  ])

  return {
    repository: {
      ...repository,
      // gh's answer wins when it has one — it knows the remote's
      // current state, including custom default-branch settings the
      // local refs can't reflect. Fall back to local detection when gh
      // returns undefined (offline, private repo, transient failure).
      defaultBranch: providerDefaultBranch || localDefaultBranch,
    },
    currentBranch,
    currentPullRequest,
    authenticated: true,
  }
}

export function providerBranchName(branch: BranchRef | undefined): string | undefined {
  if (!branch) {
    return undefined
  }

  if (branch.type === 'remote') {
    return branch.shortName.split('/').slice(1).join('/') || branch.shortName
  }

  return branch.shortName
}

