import { SimpleGit } from 'simple-git'
import { BranchRef } from './branchData'
import {
  describeGhStatus,
  getGhStatus,
  parseGitHubRemoteUrl as parseGitHubRemoteUrlBase,
  parseRemoteUrl,
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
  defaultBitbucketRunner,
  describeBitbucketStatus,
  getBitbucketStatus,
  type BitbucketRunner,
} from './bitbucketCli'

export type GitProviderType = 'github' | 'gitlab' | 'bitbucket' | 'unsupported'

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
let forgeHostOverrides: Record<string, 'github' | 'gitlab' | 'bitbucket'> = {}

export function setForgeHostOverrides(
  overrides: Record<string, 'github' | 'gitlab' | 'bitbucket'> | undefined
): void {
  forgeHostOverrides = {}
  if (overrides) {
    for (const [host, provider] of Object.entries(overrides)) {
      forgeHostOverrides[host.toLowerCase()] = provider
    }
  }
}

export function detectProvider(host: string): GitProviderType {
  const h = host.toLowerCase()
  if (forgeHostOverrides[h]) return forgeHostOverrides[h]
  if (h === 'github.com') return 'github'
  if (h === 'gitlab.com') return 'gitlab'
  if (h === 'bitbucket.org' || h.includes('bitbucket')) return 'bitbucket'
  if (h.includes('gitlab')) return 'gitlab'
  if (h.includes('github')) return 'github'
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

  return {
    provider,
    remote: remoteName,
    host: parsed.host,
    owner: parsed.owner,
    name: parsed.name,
    webUrl: `https://${parsed.host}/${parsed.owner}/${parsed.name}`,
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
  const remotes = await git.getRemotes(true)
  const remote = remotes.find((entry) => entry.name === 'origin') || remotes[0]
  const url = remote?.refs.push || remote?.refs.fetch
  return url ? getProviderRepository(remote.name, url) : undefined
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
  // GitLab namespaces every sub-path under `/-/`; GitHub and Bitbucket do not.
  const seg = repository.provider === 'gitlab' ? '/-' : ''

  if (target.type === 'repo') {
    return base
  }

  if (target.type === 'branch') {
    return isBitbucket
      ? `${base}/branch/${encodeURIComponent(target.branch)}`
      : `${base}${seg}/tree/${encodeURIComponent(target.branch)}`
  }

  if (target.type === 'commit') {
    return isBitbucket
      ? `${base}/commits/${encodeURIComponent(target.commit)}`
      : `${base}${seg}/commit/${encodeURIComponent(target.commit)}`
  }

  if (target.type === 'pull-request') {
    if (repository.provider === 'gitlab') return `${base}/-/merge_requests/${target.number}`
    if (isBitbucket) return `${base}/pull-requests/${target.number}`
    return `${base}/pull/${target.number}`
  }

  if (isBitbucket) {
    return `${base}/branches/compare/${encodeURIComponent(target.head)}%0D${encodeURIComponent(target.base)}`
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
  encodedPath: string,
  sourceBranch: string,
  runner: GlabRunner
): Promise<ProviderPullRequestStatus | undefined> {
  try {
    const out = (
      await runner([
        'api',
        `projects/${encodedPath}/merge_requests?source_branch=${encodeURIComponent(sourceBranch)}&state=opened`,
      ])
    ).trim()
    if (!out) return undefined
    const mr = (JSON.parse(out) as Array<{
      iid: number
      title: string
      state: string
      draft?: boolean
      work_in_progress?: boolean
    }>)[0]
    if (!mr) return undefined
    return {
      number: mr.iid,
      title: mr.title,
      state: mr.state,
      isDraft: Boolean(mr.draft ?? mr.work_in_progress),
    }
  } catch {
    return undefined
  }
}

/** Bitbucket overview via REST API: auth probe, default branch, current-branch PR. */
async function getBitbucketProviderOverview(
  repository: ProviderRepository,
  currentBranch: string | undefined,
  localDefaultBranch: string | undefined,
  runner: BitbucketRunner
): Promise<ProviderOverview> {
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
      const q = encodeURIComponent(`source.branch.name = "${currentBranch}" AND state = "OPEN"`)
      const out = (await runner(`repositories/${path}/pullrequests?q=${q}&pagelen=1`)).trim()
      if (!out) return undefined
      const page = JSON.parse(out) as { values?: Array<{ id?: number; title?: string; state?: string; draft?: boolean }> }
      const pr = page?.values?.[0]
      if (!pr?.id) return undefined
      return {
        number: pr.id,
        title: pr.title || '',
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
    currentBranch && encoded
      ? getCurrentMergeRequest(encoded, currentBranch, runner)
      : Promise.resolve(undefined),
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
  bitbucketRunner: BitbucketRunner = defaultBitbucketRunner
): Promise<ProviderOverview> {
  const [remotes, currentBranchOutput, localDefaultBranch] = await Promise.all([
    git.getRemotes(true),
    git.raw(['branch', '--show-current']),
    // Read local default-branch signal up-front in parallel — used as
    // the fallback when gh is unavailable / unauthenticated / can't see
    // the repo. Coco aims to be platform-agnostic + work offline; the
    // GH-specific paths layer on top of this, they don't replace it.
    detectLocalDefaultBranch(git),
  ])
  const remote = remotes.find((entry) => entry.name === 'origin') || remotes[0]
  const remoteUrl = remote?.refs.push || remote?.refs.fetch
  const repository = remoteUrl
    ? getProviderRepository(remote.name, remoteUrl)
    : {
      provider: 'unsupported' as const,
      remote: 'origin',
      message: 'No Git remote detected.',
    }
  const currentBranch = currentBranchOutput.trim() || undefined

  if (repository.provider === 'gitlab') {
    return getGitLabProviderOverview(repository, currentBranch, localDefaultBranch, glabRunner)
  }

  if (repository.provider === 'bitbucket') {
    return getBitbucketProviderOverview(repository, currentBranch, localDefaultBranch, bitbucketRunner)
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

