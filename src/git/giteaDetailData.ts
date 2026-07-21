import type { GiteaRunner } from './giteaCli'
import { paginate } from './forgeLoad'
import { sanitizeIssueDetail, sanitizePullRequestDetail } from './forgeText'
import type { IssueComment, IssueDetail, IssueDetailResult } from './issueDetailData'
import type {
  PullRequestDetail,
  PullRequestDetailResult,
  PullRequestReview,
  PullRequestStatusCheck,
} from './pullRequestDetailData'
import { parsePullRequestDiffLines, type PullRequestDiffResult } from './pullRequestDiffData'

/**
 * On-demand Gitea/Forgejo pull-request / issue detail for the workstation
 * inspector. Emits the SAME detail shapes as the GitHub/GitLab/Bitbucket
 * detail loaders so the inspector renders unchanged.
 *
 * `projectPath` is `owner/repo` and `runner` is a host-bound `GiteaRunner`
 * (the forge adapter constructs it from the detected repository's host via
 * `makeGiteaRunner`). Gitea models comments on issues and pull requests
 * identically (`/issues/{n}/comments`, since a PR is an issue internally);
 * reviews and commit statuses have PR-specific endpoints.
 */

type GiteaComment = {
  id?: number
  body?: string
  created_at?: string
  user?: { login?: string }
}

type GiteaReview = {
  user?: { login?: string }
  state?: string
  body?: string
  submitted_at?: string
}

type GiteaCommitStatus = {
  context?: string
  status?: string
  target_url?: string
}

function mapComments(comments: GiteaComment[]): IssueComment[] {
  return comments
    .filter((c) => (c.body || '').trim())
    .map((c) => ({
      author: c.user?.login,
      body: c.body || '',
      createdAt: c.created_at || '',
    }))
}

async function safeJson<T>(runner: GiteaRunner, endpoint: string): Promise<T | undefined> {
  try {
    const out = (await runner(endpoint)).trim()
    return out ? (JSON.parse(out) as T) : undefined
  } catch {
    return undefined
  }
}

async function fetchAllComments(
  runner: GiteaRunner,
  projectPath: string,
  number: number
): Promise<IssueComment[]> {
  return paginate({
    fetchPage: async (page) =>
      (await runner(`repos/${projectPath}/issues/${number}/comments?limit=50&page=${page}`)).trim(),
    parsePage: (output) => {
      if (!output) return undefined
      const raw = JSON.parse(output)
      if (!Array.isArray(raw)) return undefined
      return { items: mapComments(raw as GiteaComment[]), hasMore: raw.length >= 50 }
    },
    want: Infinity,
    maxPages: 20,
    onError: 'stop',
  })
}

function parseReviews(reviews: unknown): PullRequestReview[] {
  if (!Array.isArray(reviews)) return []
  return (reviews as GiteaReview[])
    .map((r) => ({
      author: r.user?.login,
      state: r.state || '',
      body: r.body || '',
      submittedAt: r.submitted_at || '',
    }))
    .filter((r) => r.author) as PullRequestReview[]
}

function normalizeGiteaBuildStatus(state: string): string {
  switch (state.toLowerCase()) {
    case 'success':
      return 'success'
    case 'failure':
    case 'error':
      return 'failure'
    case 'pending':
      return 'in_progress'
    case 'warning':
      return 'neutral'
    default:
      return state.toLowerCase()
  }
}

async function fetchCommitStatuses(
  runner: GiteaRunner,
  projectPath: string,
  commit: string | undefined
): Promise<PullRequestStatusCheck[]> {
  if (!commit) return []
  try {
    const out = (await runner(`repos/${projectPath}/commits/${commit}/statuses`)).trim()
    if (!out) return []
    const data = JSON.parse(out)
    if (!Array.isArray(data)) return []
    return (data as GiteaCommitStatus[]).map((s) => ({
      name: s.context || 'build',
      status: s.status,
      conclusion: s.status ? normalizeGiteaBuildStatus(s.status) : undefined,
    }))
  } catch {
    return []
  }
}

export async function getGiteaPullRequestDetail(
  projectPath: string,
  pullRequestNumber: number,
  runner: GiteaRunner
): Promise<PullRequestDetailResult> {
  try {
    const pr = await safeJson<{ body?: string; head?: { sha?: string } }>(
      runner,
      `repos/${projectPath}/pulls/${pullRequestNumber}`
    )

    if (!pr) {
      return { ok: false, message: `Empty response from Gitea for pull request #${pullRequestNumber}` }
    }

    const [comments, reviewsRaw, statusChecks] = await Promise.all([
      fetchAllComments(runner, projectPath, pullRequestNumber),
      safeJson<unknown>(runner, `repos/${projectPath}/pulls/${pullRequestNumber}/reviews`),
      fetchCommitStatuses(runner, projectPath, pr.head?.sha),
    ])

    const detail: PullRequestDetail = {
      number: pullRequestNumber,
      body: pr.body || '',
      comments,
      reviews: parseReviews(reviewsRaw),
      statusCheckRollup: statusChecks,
    }
    return { ok: true, detail: sanitizePullRequestDetail(detail) }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export async function getGiteaIssueDetail(
  projectPath: string,
  issueNumber: number,
  runner: GiteaRunner
): Promise<IssueDetailResult> {
  try {
    const issue = await safeJson<{ body?: string }>(runner, `repos/${projectPath}/issues/${issueNumber}`)

    if (!issue) {
      return { ok: false, message: `Empty response from Gitea for issue #${issueNumber}` }
    }

    const comments = await fetchAllComments(runner, projectPath, issueNumber)

    const detail: IssueDetail = {
      number: issueNumber,
      body: issue.body || '',
      comments,
    }
    return { ok: true, detail: sanitizeIssueDetail(detail) }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Unified-patch fetch for a Gitea/Forgejo pull request by number — the Gitea
 * counterpart of `getPullRequestDiff` / `getMergeRequestDiff` (#1363). Unlike
 * Bitbucket, Gitea exposes a raw-diff endpoint directly, so this is a real
 * implementation rather than a graceful "unsupported" stub.
 */
export async function getGiteaPullRequestDiff(
  projectPath: string,
  pullRequestNumber: number,
  runner: GiteaRunner
): Promise<PullRequestDiffResult> {
  try {
    const output = await runner(`repos/${projectPath}/pulls/${pullRequestNumber}.diff`)
    return { ok: true, lines: parsePullRequestDiffLines(output) }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export const __test = {
  mapComments,
  parseReviews,
  normalizeGiteaBuildStatus,
}
