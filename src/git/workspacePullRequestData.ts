import * as fs from 'node:fs'
import * as path from 'node:path'

import {
  defaultGhRunner,
  isGhAuthenticated,
  parseGitHubRemoteUrl,
  type GhRunner,
  type GitHubRepository,
} from './githubCli'

/**
 * Open-PR counts for the workspace surface (#880). One `gh` invocation
 * per repo with a GitHub remote, cheap enough to fan out across a
 * dozen repos. Hidden entirely when `gh` is missing or unauthenticated
 * — the surface drops the PR column rather than rendering "N/A".
 *
 * Per-repo failures are swallowed and reported as `undefined` so a
 * single 4xx never poisons the whole panel.
 */

export type WorkspacePullRequestCounts = {
  authenticated: boolean
  /** Per-repo-path → open PR count. Missing keys = no count available. */
  counts: Record<string, number>
}

/**
 * Read the origin remote URL straight from the on-disk git config so
 * we don't have to spawn a SimpleGit instance per repo just to ask
 * for remotes. Falls back to undefined on any read failure.
 */
export function readOriginRemoteUrl(repoPath: string): string | undefined {
  const candidates = [
    path.join(repoPath, '.git', 'config'),
    // Worktrees and submodules use a .git pointer file. Best effort —
    // we'll just skip if the pointer resolution gets complicated.
  ]
  for (const candidate of candidates) {
    try {
      const text = fs.readFileSync(candidate, 'utf8')
      const url = extractOriginUrl(text)
      if (url) {
        return url
      }
    } catch {
      // Not the right candidate; try the next.
    }
  }
  return undefined
}

export function extractOriginUrl(configText: string): string | undefined {
  const lines = configText.split('\n')
  let inOrigin = false
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (line.startsWith('[remote ')) {
      inOrigin = /\[remote\s+"origin"\]/.test(line)
      continue
    }
    if (line.startsWith('[')) {
      inOrigin = false
      continue
    }
    if (!inOrigin) {
      continue
    }
    const match = line.match(/^url\s*=\s*(.+)$/)
    if (match) {
      return match[1].trim()
    }
  }
  return undefined
}

export function parseOpenPullRequestCount(json: string): number | undefined {
  try {
    const parsed = JSON.parse(json)
    if (Array.isArray(parsed)) {
      return parsed.length
    }
  } catch {
    return undefined
  }
  return undefined
}

async function fetchPullRequestCount(
  runner: GhRunner,
  repository: GitHubRepository
): Promise<number | undefined> {
  try {
    const out = await runner([
      'pr',
      'list',
      '-R',
      `${repository.owner}/${repository.name}`,
      '--state',
      'open',
      '--json',
      'number',
      '--limit',
      '100',
    ])
    return parseOpenPullRequestCount(out)
  } catch {
    return undefined
  }
}

export type GetWorkspacePullRequestCountsOptions = {
  /** Inject a `gh` runner for testing. */
  ghRunner?: GhRunner
  /** Pre-resolved remote URL per path — saves a fs read each. */
  remoteUrls?: ReadonlyMap<string, string>
  /** Maximum number of concurrent gh calls. Default 4. */
  concurrency?: number
}

async function mapWithConcurrency<T, U>(
  inputs: ReadonlyArray<T>,
  limit: number,
  fn: (input: T) => Promise<U>
): Promise<U[]> {
  const results: U[] = []
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, inputs.length) }, async () => {
    while (cursor < inputs.length) {
      const idx = cursor++
      results[idx] = await fn(inputs[idx])
    }
  })
  await Promise.all(workers)
  return results
}

export async function getWorkspacePullRequestCounts(
  repoPaths: ReadonlyArray<string>,
  options: GetWorkspacePullRequestCountsOptions = {}
): Promise<WorkspacePullRequestCounts> {
  const runner = options.ghRunner ?? defaultGhRunner
  const authenticated = await isGhAuthenticated(runner)
  if (!authenticated) {
    return { authenticated: false, counts: {} }
  }

  const counts: Record<string, number> = {}
  const concurrency = Math.max(1, options.concurrency ?? 4)

  await mapWithConcurrency(repoPaths, concurrency, async (repoPath) => {
    const url = options.remoteUrls?.get(repoPath) ?? readOriginRemoteUrl(repoPath)
    if (!url) {
      return
    }
    const repo = parseGitHubRemoteUrl(url)
    if (!repo) {
      return
    }
    const count = await fetchPullRequestCount(runner, repo)
    if (typeof count === 'number') {
      counts[repoPath] = count
    }
  })

  return { authenticated: true, counts }
}
