import type { SimpleGit } from 'simple-git'
import { fetchRemotes, pullCurrentBranch } from './branchActions'
import { createHeadlessGit } from '../lib/simple-git/headlessGit'
import { getRepoSummary, type WorkspaceRepoSummary } from './workspaceData'

/**
 * Fetch or fast-forward-pull many repos from the workspace dashboard (#2211).
 *
 * Runs with bounded concurrency so a hundred repos do not become a hundred
 * simultaneous network operations, uses the headless git (no credential
 * prompt can steal the terminal), and re-reads each repo's summary as soon as
 * it finishes so the row updates while the rest are still running.
 */

export type WorkspaceSyncMode = 'fetch' | 'pull'

export type WorkspaceSyncOutcome = {
  path: string
  name: string
  status: 'ok' | 'skipped' | 'failed'
  /** First line of git's error, or why the repo was skipped. */
  message?: string
}

export type WorkspaceSyncDeps = {
  makeGit?: (path: string) => SimpleGit
  summarize?: (path: string) => Promise<WorkspaceRepoSummary>
}

export const WORKSPACE_SYNC_CONCURRENCY = 4

/**
 * Why a fast-forward pull must not run on this repo, from its last summary.
 * Only repos known to be behind are pulled, so a stale `behind: 0` means
 * "fetch first".
 */
export function pullSkipReason(repo: WorkspaceRepoSummary): string | undefined {
  if (repo.error) return 'unreadable repo'
  if (repo.dirty > 0) return 'uncommitted changes'
  if (repo.detached) return 'detached HEAD'
  if (repo.upstream === null) return 'no upstream'
  if (repo.ahead > 0 && repo.behind > 0) return 'diverged'
  if (repo.behind === 0) return 'not behind (fetch first)'
  return undefined
}

function firstLine(message: string): string {
  return message.split('\n').find((line) => line.trim())?.trim() ?? message
}

async function syncOne(
  repo: WorkspaceRepoSummary,
  mode: WorkspaceSyncMode,
  makeGit: (path: string) => SimpleGit
): Promise<WorkspaceSyncOutcome> {
  const base = { path: repo.path, name: repo.name }
  if (mode === 'pull') {
    const reason = pullSkipReason(repo)
    if (reason) return { ...base, status: 'skipped', message: reason }
  } else if (repo.error) {
    return { ...base, status: 'skipped', message: 'unreadable repo' }
  }
  const git = makeGit(repo.path)
  const result = mode === 'fetch' ? await fetchRemotes(git) : await pullCurrentBranch(git)
  return result.ok
    ? { ...base, status: 'ok' }
    : { ...base, status: 'failed', message: firstLine(result.message) }
}

/**
 * Run `mode` over `repos`, at most `concurrency` at a time. `onRepoDone`
 * fires per repo with its outcome and, once it has changed anything, a fresh
 * summary. Never throws: a repo's failure is an outcome.
 */
export async function syncWorkspaceRepos(
  repos: ReadonlyArray<WorkspaceRepoSummary>,
  mode: WorkspaceSyncMode,
  options: {
    concurrency?: number
    onRepoDone?: (outcome: WorkspaceSyncOutcome, summary?: WorkspaceRepoSummary) => void
    isCancelled?: () => boolean
  } = {},
  deps: WorkspaceSyncDeps = {}
): Promise<WorkspaceSyncOutcome[]> {
  const makeGit = deps.makeGit ?? createHeadlessGit
  const summarize = deps.summarize ?? ((path: string) => getRepoSummary(path))
  const limit = Math.max(1, options.concurrency ?? WORKSPACE_SYNC_CONCURRENCY)
  const outcomes: WorkspaceSyncOutcome[] = new Array(repos.length)
  let next = 0

  const worker = async () => {
    while (next < repos.length && !options.isCancelled?.()) {
      const index = next++
      const repo = repos[index]
      let outcome: WorkspaceSyncOutcome
      try {
        outcome = await syncOne(repo, mode, makeGit)
      } catch (error) {
        outcome = {
          path: repo.path,
          name: repo.name,
          status: 'failed',
          message: firstLine(error instanceof Error ? error.message : String(error)),
        }
      }
      outcomes[index] = outcome
      const summary = outcome.status === 'ok' ? await summarize(repo.path).catch(() => undefined) : undefined
      options.onRepoDone?.(outcome, summary)
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, repos.length) }, worker))
  return outcomes.filter(Boolean)
}

/** `Fetched 11 repos, 1 failed: api (auth failed)` style summary for the status line. */
export function summarizeWorkspaceSync(
  mode: WorkspaceSyncMode,
  outcomes: ReadonlyArray<WorkspaceSyncOutcome>
): string {
  const verb = mode === 'fetch' ? 'Fetched' : 'Pulled'
  const ok = outcomes.filter((entry) => entry.status === 'ok').length
  const skipped = outcomes.filter((entry) => entry.status === 'skipped')
  const failed = outcomes.filter((entry) => entry.status === 'failed')
  const parts = [`${verb} ${ok} ${ok === 1 ? 'repo' : 'repos'}`]
  if (skipped.length > 0) parts.push(`${skipped.length} skipped`)
  if (failed.length > 0) {
    const shown = failed.slice(0, 2).map((entry) => `${entry.name} (${entry.message ?? 'failed'})`).join(', ')
    parts.push(`${failed.length} failed: ${shown}${failed.length > 2 ? ', …' : ''}`)
  }
  return `${parts.join(', ')}.`
}
