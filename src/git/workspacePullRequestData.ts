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
 * Default per-call timeout for the workspace PR-count fetcher.
 * Sized to land well under the 30s a user would tolerate for the
 * whole overview to settle, while still leaving headroom for
 * legitimately slow networks. A hung gh past this is treated as
 * "no count available" — the surface drops the badge rather than
 * spinning forever.
 */
export const WORKSPACE_PR_COUNT_TIMEOUT_MS = 5000

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

/**
 * Race a single gh call against a timeout. If the timeout wins, abort
 * the underlying process (so we don't leak a long-running gh) and
 * resolve to `undefined` so the caller can drop the badge. Wraps the
 * runner so a hung gh on any one repo can't stall the whole overview.
 */
export async function runGhWithTimeout(
  runner: GhRunner,
  args: string[],
  timeoutMs: number
): Promise<string | undefined> {
  const controller = new AbortController()
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      controller.abort()
      resolve(undefined)
    }, timeoutMs)
  })
  try {
    const result = await Promise.race([
      runner(args, { signal: controller.signal }).then((stdout) => stdout),
      timeout,
    ])
    return result
  } catch {
    return undefined
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
  }
}

async function fetchPullRequestCount(
  runner: GhRunner,
  repository: GitHubRepository,
  timeoutMs: number
): Promise<number | undefined> {
  const out = await runGhWithTimeout(
    runner,
    [
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
    ],
    timeoutMs
  )
  if (out === undefined) {
    return undefined
  }
  return parseOpenPullRequestCount(out)
}

export type GetWorkspacePullRequestCountsOptions = {
  /** Inject a `gh` runner for testing. */
  ghRunner?: GhRunner
  /** Pre-resolved remote URL per path — saves a fs read each. */
  remoteUrls?: ReadonlyMap<string, string>
  /** Maximum number of concurrent gh calls. Default 4. */
  concurrency?: number
  /** Per-call timeout in ms. Default `WORKSPACE_PR_COUNT_TIMEOUT_MS`. */
  timeoutMs?: number
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
  const timeoutMs = options.timeoutMs ?? WORKSPACE_PR_COUNT_TIMEOUT_MS

  await mapWithConcurrency(repoPaths, concurrency, async (repoPath) => {
    const url = options.remoteUrls?.get(repoPath) ?? readOriginRemoteUrl(repoPath)
    if (!url) {
      return
    }
    const repo = parseGitHubRemoteUrl(url)
    if (!repo) {
      return
    }
    const count = await fetchPullRequestCount(runner, repo, timeoutMs)
    if (typeof count === 'number') {
      counts[repoPath] = count
    }
  })

  return { authenticated: true, counts }
}
