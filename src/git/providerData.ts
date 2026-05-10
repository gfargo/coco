import { SimpleGit } from 'simple-git'
import { BranchRef } from './branchData'
import { GhRunner, defaultGhRunner } from './pullRequestData'

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

export function parseGitHubRemoteUrl(url: string): Pick<ProviderRepository, 'owner' | 'name' | 'webUrl'> | undefined {
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
    webUrl: `https://github.com/${match[1]}/${match[2]}`,
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
  const [remotes, currentBranchOutput] = await Promise.all([
    git.getRemotes(true),
    git.raw(['branch', '--show-current']),
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
      repository,
      currentBranch,
      authenticated: false,
      message: repository.message || 'Unsupported remote provider.',
    }
  }

  try {
    await runner(['auth', 'status', '--hostname', 'github.com'])
  } catch {
    return {
      repository,
      currentBranch,
      authenticated: false,
      message: 'GitHub CLI is missing or not authenticated.',
    }
  }

  const [defaultBranch, currentPullRequest] = await Promise.all([
    getDefaultBranch(repository, runner),
    getCurrentPullRequest(runner),
  ])

  return {
    repository: {
      ...repository,
      defaultBranch,
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

