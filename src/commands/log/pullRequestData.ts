import { execFile } from 'child_process'
import { promisify } from 'util'
import { SimpleGit } from 'simple-git'

const execFileAsync = promisify(execFile)

export type GhRunner = (args: string[]) => Promise<string>

export type GitHubRepository = {
  owner: string
  name: string
}

export type PullRequestInfo = {
  number: number
  title: string
  url: string
  state: string
  isDraft: boolean
  headRefName: string
  baseRefName: string
}

export type PullRequestOverview = {
  available: boolean
  authenticated: boolean
  repository?: GitHubRepository
  currentBranch?: string
  currentPullRequest?: PullRequestInfo
  message?: string
}

export function parseGitHubRemoteUrl(url: string): GitHubRepository | undefined {
  const trimmed = url.trim().replace(/\.git$/, '')
  const sshMatch = trimmed.match(/^git@github\.com:([^/]+)\/(.+)$/)
  const httpsMatch = trimmed.match(/^https:\/\/github\.com\/([^/]+)\/(.+)$/)
  const match = sshMatch || httpsMatch

  if (!match) {
    return undefined
  }

  return {
    owner: match[1],
    name: match[2],
  }
}

export async function defaultGhRunner(args: string[]): Promise<string> {
  const result = await execFileAsync('gh', args)

  return result.stdout
}

async function getGitHubRepository(git: SimpleGit): Promise<GitHubRepository | undefined> {
  const remotes = await git.getRemotes(true)
  const remote = remotes.find((entry) => entry.name === 'origin') || remotes[0]
  const url = remote?.refs.push || remote?.refs.fetch

  return url ? parseGitHubRemoteUrl(url) : undefined
}

function parsePullRequestInfo(output: string): PullRequestInfo | undefined {
  const trimmed = output.trim()

  if (!trimmed) {
    return undefined
  }

  return JSON.parse(trimmed) as PullRequestInfo
}

export async function getPullRequestOverview(
  git: SimpleGit,
  runner: GhRunner = defaultGhRunner
): Promise<PullRequestOverview> {
  const [repository, currentBranchOutput] = await Promise.all([
    getGitHubRepository(git),
    git.raw(['branch', '--show-current']),
  ])
  const currentBranch = currentBranchOutput.trim() || undefined

  if (!repository) {
    return {
      available: false,
      authenticated: false,
      currentBranch,
      message: 'No GitHub remote detected.',
    }
  }

  try {
    await runner(['auth', 'status', '--hostname', 'github.com'])
  } catch {
    return {
      available: true,
      authenticated: false,
      repository,
      currentBranch,
      message: 'GitHub CLI is missing or not authenticated.',
    }
  }

  try {
    const output = await runner([
      'pr',
      'view',
      '--json',
      'number,title,url,state,isDraft,headRefName,baseRefName',
    ])

    return {
      available: true,
      authenticated: true,
      repository,
      currentBranch,
      currentPullRequest: parsePullRequestInfo(output),
    }
  } catch {
    return {
      available: true,
      authenticated: true,
      repository,
      currentBranch,
      message: currentBranch ? `No pull request found for ${currentBranch}.` : 'No current branch.',
    }
  }
}
