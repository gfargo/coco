import { splitBitbucketServerPath, type BitbucketServerRunner } from './bitbucketServerCli'
import { paginate } from './forgeLoad'
import { sanitizePullRequestDetail } from './forgeText'
import type { IssueDetailResult } from './issueDetailData'
import type {
  PullRequestDetail,
  PullRequestDetailResult,
  PullRequestReview,
  PullRequestStatusCheck,
} from './pullRequestDetailData'

/**
 * On-demand Bitbucket Server / Data Center pull-request detail for the
 * workstation inspector. Emits the SAME detail shape as the other forge
 * detail loaders so the inspector renders unchanged.
 *
 * `projectPath` is `projectKey/repoSlug`; `runner` is a host-bound
 * `BitbucketServerRunner` (the forge adapter constructs it from the
 * detected repository's host via `makeBitbucketServerRunner`). Bitbucket
 * Server spreads detail across endpoints: the PR body and reviewer/approval
 * state live on the PR resource itself; comments come from the paginated
 * `/activities` feed (mixed in with merge/approval events, so only
 * `COMMENTED` entries are kept); commit build status lives on a wholly
 * separate API root (`rest/build-status/1.0`, not `rest/api/1.0`) that the
 * runner reaches via an absolute URL.
 *
 * Bitbucket Server has no issue tracker — `getBitbucketServerIssueDetail`
 * always returns a graceful `{ ok: false }`.
 */

type BitbucketServerComment = {
  text?: string
  createdDate?: number
  author?: { name?: string; slug?: string; displayName?: string }
}

type BitbucketServerActivity = {
  action?: string
  comment?: BitbucketServerComment
}

type BitbucketServerReviewer = {
  user?: { name?: string; slug?: string; displayName?: string }
  status?: string
  approved?: boolean
}

type BitbucketServerBuildStatus = {
  key?: string
  name?: string
  state?: string
  url?: string
}

function epochToIso(value: unknown): string {
  return typeof value === 'number' ? new Date(value).toISOString() : ''
}

function commentAuthorOf(comment: BitbucketServerComment): string | undefined {
  return comment.author?.slug || comment.author?.name
}

function mapActivitiesToComments(activities: BitbucketServerActivity[]) {
  return activities
    .filter((a) => a.action === 'COMMENTED' && (a.comment?.text || '').trim())
    .map((a) => ({
      author: commentAuthorOf(a.comment as BitbucketServerComment),
      body: a.comment?.text || '',
      createdAt: epochToIso(a.comment?.createdDate),
    }))
}

async function safeJson<T>(runner: BitbucketServerRunner, endpoint: string): Promise<T | undefined> {
  try {
    const out = (await runner(endpoint)).trim()
    return out ? (JSON.parse(out) as T) : undefined
  } catch {
    return undefined
  }
}

async function fetchAllComments(
  runner: BitbucketServerRunner,
  base: string
) {
  return paginate({
    fetchPage: async (page) =>
      (await runner(`${base}/activities?limit=50&start=${(page - 1) * 50}`)).trim(),
    parsePage: (output) => {
      if (!output) return undefined
      const raw = JSON.parse(output) as { values?: BitbucketServerActivity[]; isLastPage?: boolean }
      if (!Array.isArray(raw?.values)) return undefined
      return { items: mapActivitiesToComments(raw.values), hasMore: raw.isLastPage === false }
    },
    want: Infinity,
    maxPages: 20,
    onError: 'stop',
  })
}

function parseReviewers(reviewers: unknown): PullRequestReview[] {
  if (!Array.isArray(reviewers)) return []
  return (reviewers as BitbucketServerReviewer[])
    .map((r) => ({
      author: r.user?.slug || r.user?.name,
      state: r.status || (r.approved ? 'APPROVED' : 'UNAPPROVED'),
      body: '',
      submittedAt: '',
    }))
    .filter((r) => r.author) as PullRequestReview[]
}

function normalizeBitbucketServerBuildStatus(state: string): string {
  switch (state.toUpperCase()) {
    case 'SUCCESSFUL':
      return 'success'
    case 'FAILED':
      return 'failure'
    case 'INPROGRESS':
      return 'in_progress'
    default:
      return state.toLowerCase()
  }
}

async function fetchCommitStatuses(
  runner: BitbucketServerRunner,
  host: string,
  commit: string | undefined
): Promise<PullRequestStatusCheck[]> {
  if (!commit) return []
  try {
    const out = (await runner(`https://${host}/rest/build-status/1.0/commits/${commit}`)).trim()
    if (!out) return []
    const data = JSON.parse(out) as { values?: BitbucketServerBuildStatus[] }
    if (!Array.isArray(data?.values)) return []
    return data.values.map((s) => ({
      name: s.name || s.key || 'build',
      status: s.state,
      conclusion: s.state ? normalizeBitbucketServerBuildStatus(s.state) : undefined,
    }))
  } catch {
    return []
  }
}

export async function getBitbucketServerPullRequestDetail(
  projectPath: string,
  pullRequestNumber: number,
  runner: BitbucketServerRunner,
  host: string
): Promise<PullRequestDetailResult> {
  try {
    const parts = splitBitbucketServerPath(projectPath)
    if (!parts) {
      return { ok: false, message: 'No Bitbucket Server project resolved' }
    }

    const base = `projects/${parts.projectKey}/repos/${parts.repoSlug}/pull-requests/${pullRequestNumber}`
    const pr = await safeJson<{
      description?: string
      reviewers?: unknown
      fromRef?: { latestCommit?: string }
    }>(runner, base)

    if (!pr) {
      return { ok: false, message: `Empty response from Bitbucket Server for pull request #${pullRequestNumber}` }
    }

    const [commentsResult, statusChecks] = await Promise.all([
      fetchAllComments(runner, base),
      fetchCommitStatuses(runner, host, pr.fromRef?.latestCommit),
    ])

    const detail: PullRequestDetail = {
      number: pullRequestNumber,
      body: pr.description || '',
      comments: commentsResult.items,
      reviews: parseReviewers(pr.reviewers),
      statusCheckRollup: statusChecks,
      ...(commentsResult.truncated ? { commentsTruncated: true } : {}),
    }
    return { ok: true, detail: sanitizePullRequestDetail(detail) }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

/** Bitbucket Server has no issue tracker (that's a Jira integration). */
export function getBitbucketServerIssueDetail(): Promise<IssueDetailResult> {
  return Promise.resolve({
    ok: false,
    message: 'Issues are not supported on Bitbucket Server (no built-in issue tracker).',
  })
}

export const __test = {
  mapActivitiesToComments,
  parseReviewers,
  normalizeBitbucketServerBuildStatus,
}
