import { SimpleGit } from 'simple-git'
import {
  defaultGhRunner,
  describeGhStatus,
  getGhStatus,
  parseGitHubRemoteUrl as parseGitHubRemoteUrlShared,
  type GhRunner,
  type GitHubRepository,
} from './githubCli'
import { getGitHubRepositoryForGit } from './providerData'

// Re-export for backwards compatibility — callers that imported from
// pullRequestData before the shared module existed keep working.
export {
  defaultGhRunner,
  type GhRunner,
  type GitHubRepository,
}
export const parseGitHubRemoteUrl = parseGitHubRemoteUrlShared

export type PullRequestStatusCheck = {
  /** Display name from `gh pr view --json statusCheckRollup`. */
  name: string
  /**
   * `IN_PROGRESS` / `COMPLETED` / `QUEUED` / etc. for check runs;
   * `PENDING` / `SUCCESS` / `FAILURE` / `ERROR` for status contexts.
   * The renderer normalizes both into a single status glyph.
   */
  status?: string
  /**
   * `SUCCESS` / `FAILURE` / `NEUTRAL` / `CANCELLED` / `SKIPPED` /
   * `TIMED_OUT` / `ACTION_REQUIRED` for completed check runs;
   * `undefined` while still in progress.
   */
  conclusion?: string
}

export type PullRequestReviewInfo = {
  /** GitHub login of the reviewer. */
  author: string
  /** `APPROVED` / `CHANGES_REQUESTED` / `COMMENTED` / `DISMISSED` / `PENDING`. */
  state: string
}

export type PullRequestInfo = {
  number: number
  title: string
  url: string
  state: string
  isDraft: boolean
  headRefName: string
  baseRefName: string
  /** PR body — rendered as a collapsed preview in the panel header. */
  body?: string
  /** GitHub login of the PR author. */
  author?: string
  /** Aggregated GraphQL review decision (cheaper than computing it
   *  from the per-review array). */
  reviewDecision?: string
  /** `MERGEABLE` / `CONFLICTING` / `UNKNOWN` from gh. */
  mergeable?: string
  /** `CLEAN` / `DIRTY` / `BLOCKED` / `BEHIND` / `UNSTABLE` / etc. —
   *  drives the merge action's affordance and any pre-merge warnings. */
  mergeStateStatus?: string
  /** Flat per-check status; rendered as a small table in the panel. */
  statusCheckRollup?: PullRequestStatusCheck[]
  /** Per-reviewer entries; rendered as a summary line. */
  reviews?: PullRequestReviewInfo[]
}

export type PullRequestOverview = {
  available: boolean
  authenticated: boolean
  repository?: GitHubRepository
  currentBranch?: string
  currentPullRequest?: PullRequestInfo
  message?: string
}

function parsePullRequestInfo(output: string): PullRequestInfo | undefined {
  const trimmed = output.trim()

  if (!trimmed) {
    return undefined
  }

  const raw = JSON.parse(trimmed) as Record<string, unknown>
  const author = raw.author && typeof raw.author === 'object' && 'login' in raw.author
    ? String((raw.author as { login: unknown }).login)
    : undefined

  return {
    number: raw.number as number,
    title: raw.title as string,
    url: raw.url as string,
    state: raw.state as string,
    isDraft: raw.isDraft as boolean,
    headRefName: raw.headRefName as string,
    baseRefName: raw.baseRefName as string,
    body: typeof raw.body === 'string' ? raw.body : undefined,
    author,
    reviewDecision: typeof raw.reviewDecision === 'string' ? raw.reviewDecision : undefined,
    mergeable: typeof raw.mergeable === 'string' ? raw.mergeable : undefined,
    mergeStateStatus: typeof raw.mergeStateStatus === 'string' ? raw.mergeStateStatus : undefined,
    statusCheckRollup: Array.isArray(raw.statusCheckRollup)
      ? (raw.statusCheckRollup as Array<Record<string, unknown>>).map((entry) => ({
        name: String(entry.name || entry.context || 'check'),
        status: typeof entry.status === 'string' ? entry.status : undefined,
        conclusion: typeof entry.conclusion === 'string' ? entry.conclusion : undefined,
      }))
      : undefined,
    reviews: Array.isArray(raw.reviews)
      ? (raw.reviews as Array<Record<string, unknown>>).map((entry) => {
        const author = entry.author && typeof entry.author === 'object' && 'login' in entry.author
          ? String((entry.author as { login: unknown }).login)
          : ''
        return {
          author,
          state: typeof entry.state === 'string' ? entry.state : '',
        }
      }).filter((review) => review.author)
      : undefined,
  }
}

/**
 * `gh pr view --json` field list. Centralized so the data fetcher and
 * any future re-fetch (e.g., refresh after a merge action) request the
 * same shape — the parser depends on every field being present, even
 * if optional, so they're safe to deserialize.
 */
export const PULL_REQUEST_VIEW_JSON_FIELDS = [
  'number',
  'title',
  'url',
  'state',
  'isDraft',
  'headRefName',
  'baseRefName',
  'body',
  'author',
  'reviewDecision',
  'mergeable',
  'mergeStateStatus',
  'statusCheckRollup',
  'reviews',
].join(',')

export async function getPullRequestOverview(
  git: SimpleGit,
  runner: GhRunner = defaultGhRunner
): Promise<PullRequestOverview> {
  // Host-aware resolution (#1609) — see issuesListData.ts's getIssueList
  // for the same fix and rationale.
  const [repository, currentBranchOutput] = await Promise.all([
    getGitHubRepositoryForGit(git),
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

  const ghStatus = await getGhStatus(runner, repository.host)
  if (ghStatus.kind !== 'ok') {
    return {
      available: true,
      authenticated: false,
      repository,
      currentBranch,
      message: describeGhStatus(ghStatus),
    }
  }

  try {
    const output = await runner([
      'pr',
      'view',
      '--json',
      PULL_REQUEST_VIEW_JSON_FIELDS,
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
