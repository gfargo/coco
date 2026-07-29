import * as fs from 'node:fs'
import * as path from 'node:path'

import { mapWithConcurrency } from '../lib/utils/mapWithConcurrency'

import {
  defaultGhRunner,
  getGhStatus,
  type GhRunner,
} from './githubCli'
import { getProviderRepository, type ProviderRepository } from './providerData'

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

/**
 * Build the -R target for `gh pr list`. For github.com repos the bare
 * `owner/name` slug is used (existing stable form). For GitHub Enterprise
 * hosts the full webUrl is required because a bare slug resolves against
 * gh's default host (github.com), querying the wrong server (#1609).
 * This mirrors the same host-aware pattern already used by
 * `providerData.getDefaultBranch` (providerData.ts:264-270).
 */
function resolveGhRepoTarget(repo: ProviderRepository): string | undefined {
  if (!repo.owner || !repo.name) return undefined
  if (repo.host && repo.host !== 'github.com' && repo.webUrl) {
    return repo.webUrl
  }
  return `${repo.owner}/${repo.name}`
}

async function fetchPullRequestCount(
  runner: GhRunner,
  repository: ProviderRepository,
  timeoutMs: number
): Promise<number | undefined> {
  const repoTarget = resolveGhRepoTarget(repository)
  if (!repoTarget) return undefined

  const out = await runGhWithTimeout(
    runner,
    [
      'pr',
      'list',
      '-R',
      repoTarget,
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
  /**
   * Fired as each repo finishes — `count` is undefined when the repo
   * has no GitHub remote or the gh call failed/timed out. Lets the UI
   * surface per-row spinner state and drop the spinner the moment a
   * row's data lands, rather than waiting for the whole batch.
   */
  onRepoComplete?: (repoPath: string, count: number | undefined) => void
}

export async function getWorkspacePullRequestCounts(
  repoPaths: ReadonlyArray<string>,
  options: GetWorkspacePullRequestCountsOptions = {}
): Promise<WorkspacePullRequestCounts> {
  const runner = options.ghRunner ?? defaultGhRunner
  const concurrency = Math.max(1, options.concurrency ?? 4)
  const timeoutMs = options.timeoutMs ?? WORKSPACE_PR_COUNT_TIMEOUT_MS

  // Step 1: Resolve remote URLs and classify each repo by provider.
  // Only repos with a GitHub provider and both owner + name are fetchable.
  type RepoEntry = { repoPath: string; repo: ProviderRepository }
  const fetchable: RepoEntry[] = []

  for (const repoPath of repoPaths) {
    const url = options.remoteUrls?.get(repoPath) ?? readOriginRemoteUrl(repoPath)
    if (!url) continue
    const repo = getProviderRepository('origin', url)
    if (repo.provider === 'github' && repo.owner && repo.name && repo.host) {
      fetchable.push({ repoPath, repo })
    }
    // Non-GitHub repos will be handled below with onRepoComplete(undefined)
  }

  // Step 2: Probe auth once per unique GitHub host (memoized). When the
  // workspace has no GitHub-hosted repos, fall back to a github.com probe
  // so `authenticated` still reflects real gh status (pre-#1609 behavior)
  // rather than unconditionally reporting true.
  const uniqueHosts = [...new Set(fetchable.map((e) => e.repo.host!))]
  const hostsToProbe = uniqueHosts.length > 0 ? uniqueHosts : ['github.com']
  const hostAuthMap = new Map<string, boolean>()
  for (const host of hostsToProbe) {
    const status = await getGhStatus(runner, host)
    hostAuthMap.set(host, status.kind === 'ok')
  }

  // Overall authenticated = true if any relevant GitHub host authenticated.
  // Repos on unauthenticated hosts still get onRepoComplete(undefined).
  const anyAuthenticated = hostsToProbe.some((h) => hostAuthMap.get(h))

  if (!anyAuthenticated) {
    // Fire onRepoComplete for all repos (including non-GitHub ones)
    for (const repoPath of repoPaths) {
      options.onRepoComplete?.(repoPath, undefined)
    }
    return { authenticated: false, counts: {} }
  }

  // Step 3: Fan out gh pr list calls — only for repos whose host authenticated.
  const counts: Record<string, number> = {}

  // Track which repoPaths we handled in the fetchable loop
  const handledPaths = new Set<string>()

  await mapWithConcurrency(fetchable, concurrency, async ({ repoPath, repo }) => {
    handledPaths.add(repoPath)
    const hostAuthenticated = hostAuthMap.get(repo.host!) ?? false
    if (!hostAuthenticated) {
      options.onRepoComplete?.(repoPath, undefined)
      return
    }
    const count = await fetchPullRequestCount(runner, repo, timeoutMs)
    if (typeof count === 'number') {
      counts[repoPath] = count
    }
    options.onRepoComplete?.(repoPath, count)
  })

  // Fire onRepoComplete for repos that had no GitHub remote (not in fetchable)
  for (const repoPath of repoPaths) {
    if (!handledPaths.has(repoPath)) {
      options.onRepoComplete?.(repoPath, undefined)
    }
  }

  return { authenticated: true, counts }
}
