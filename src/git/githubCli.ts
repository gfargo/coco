import { execFile } from 'child_process'
import { promisify } from 'util'
import { SimpleGit } from 'simple-git'

const execFileAsync = promisify(execFile)

export type GhRunner = (args: string[]) => Promise<string>

export type GitHubRepository = {
  owner: string
  name: string
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

export async function getGitHubRepository(
  git: SimpleGit
): Promise<GitHubRepository | undefined> {
  const remotes = await git.getRemotes(true)
  const remote = remotes.find((entry) => entry.name === 'origin') || remotes[0]
  const url = remote?.refs.push || remote?.refs.fetch

  return url ? parseGitHubRemoteUrl(url) : undefined
}

/**
 * Probe `gh auth status` and return whether the GitHub CLI is
 * installed AND authenticated. Used by every data fetcher to short-
 * circuit before issuing real API calls — keeps the failure-mode
 * messaging consistent ("CLI missing or not authenticated") instead
 * of leaking through as a generic spawn error.
 */
export async function isGhAuthenticated(runner: GhRunner): Promise<boolean> {
  try {
    await runner(['auth', 'status', '--hostname', 'github.com'])
    return true
  } catch {
    return false
  }
}
