import { SimpleGit } from 'simple-git'
import { BranchRef } from './branchData'
import { GhRunner, defaultGhRunner } from './pullRequestData'
import {
  describeGhStatus,
  getGhStatus,
  parseGitHubRemoteUrl as parseGitHubRemoteUrlBase,
} from './githubCli'

export type GitProviderType = 'github' | 'unsupported'

export type ProviderRepository = {
  provider: GitProviderType
  remote: string
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

export function getProviderRepository(remoteName: string, remoteUrl: string): ProviderRepository {
  const github = parseGitHubRemoteUrl(remoteUrl)

  if (github) {
    return {
      provider: 'github',
      remote: remoteName,
      ...github,
    }
  }

  return {
    provider: 'unsupported',
    remote: remoteName,
    message: `Unsupported remote provider for ${remoteName}.`,
  }
}

export function buildProviderUrl(
  repository: ProviderRepository,
  target: ProviderUrlTarget
): string | undefined {
  if (repository.provider !== 'github' || !repository.webUrl) {
    return undefined
  }

  if (target.type === 'repo') {
    return repository.webUrl
  }

  if (target.type === 'branch') {
    return `${repository.webUrl}/tree/${encodeURIComponent(target.branch)}`
  }

  if (target.type === 'commit') {
    return `${repository.webUrl}/commit/${target.commit}`
  }

  if (target.type === 'pull-request') {
    return `${repository.webUrl}/pull/${target.number}`
  }

  return `${repository.webUrl}/compare/${encodeURIComponent(target.base)}...${encodeURIComponent(target.head)}`
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
    const output = await runner([
      'repo',
      'view',
      `${repository.owner}/${repository.name}`,
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

export async function getProviderOverview(
  git: SimpleGit,
  runner: GhRunner = defaultGhRunner
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

  const ghStatus = await getGhStatus(runner)
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

