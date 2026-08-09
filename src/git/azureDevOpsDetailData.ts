import { resolveAzureDevOpsActionError, type AzureDevOpsRunner } from './azureDevOpsCli'
import { sanitizePullRequestDetail } from './forgeText'
import type { IssueComment, IssueDetailResult } from './issueDetailData'
import type {
  PullRequestChecksResult,
  PullRequestDetail,
  PullRequestDetailResult,
  PullRequestReview,
  PullRequestStatusCheck,
} from './pullRequestDetailData'
import type { PullRequestDiffResult } from './pullRequestDiffData'

/**
 * On-demand Azure DevOps pull-request detail for the workstation inspector.
 * Emits the SAME detail shapes as the GitHub/GitLab/Bitbucket/Gitea detail
 * loaders so the inspector renders unchanged.
 *
 * Two gaps, both graceful "unsupported" rather than a guessed mapping:
 *   - `getAzureDevOpsPullRequestDiff` — Azure DevOps exposes no unified-diff
 *     endpoint (only a structural changed-files list via the iterations
 *     API); producing a real patch would need a per-file content diff,
 *     which is out of scope here (mirrors Bitbucket Server's diff gap).
 *   - `getAzureDevOpsIssueDetail` — Work Items ≠ issues (see
 *     `azureDevOpsListData.ts`'s docblock); mirrors
 *     `getBitbucketServerIssueDetail`.
 */

type AzureDevOpsThreadComment = {
  content?: string
  publishedDate?: string
  commentType?: string
  author?: { displayName?: string; uniqueName?: string }
}

type AzureDevOpsThread = {
  comments?: AzureDevOpsThreadComment[]
  isDeleted?: boolean
}

type AzureDevOpsReviewerVote = {
  displayName?: string
  uniqueName?: string
  vote?: number
}

type AzureDevOpsStatus = {
  state?: string
  description?: string
  context?: { name?: string; genre?: string }
}

function mapThreadsToComments(threads: AzureDevOpsThread[]): IssueComment[] {
  const comments: IssueComment[] = []
  for (const thread of threads) {
    if (thread.isDeleted) continue
    for (const c of thread.comments || []) {
      if (!(c.content || '').trim()) continue
      // Azure marks system-authored entries (branch updates, status
      // changes) with commentType 'system' — those aren't user comments.
      if (String(c.commentType || '').toLowerCase() === 'system') continue
      comments.push({
        author: c.author?.uniqueName || c.author?.displayName,
        body: c.content || '',
        createdAt: c.publishedDate || '',
      })
    }
  }
  return comments
}

/**
 * Azure's PR `vote` is a live tally, not a review history — there is no
 * per-review body or timestamp the way GitHub/GitLab/Gitea expose. Each
 * reviewer with a non-zero vote maps to one synthetic review entry with an
 * empty body/timestamp so the shape still fits `PullRequestReview`.
 */
function voteToState(vote: number | undefined): string | undefined {
  if (vote === 10 || vote === 5) return 'APPROVED'
  if (vote === -5 || vote === -10) return 'CHANGES_REQUESTED'
  return undefined
}

function parseReviewers(reviewers: unknown): PullRequestReview[] {
  if (!Array.isArray(reviewers)) return []
  const result: PullRequestReview[] = []
  for (const r of reviewers as AzureDevOpsReviewerVote[]) {
    const author = r.uniqueName || r.displayName
    const state = voteToState(r.vote)
    if (!author || !state) continue
    result.push({ author, state, body: '', submittedAt: '' })
  }
  return result
}

function normalizeAzureDevOpsBuildStatus(state: string): string {
  switch (state.toLowerCase()) {
    case 'succeeded':
      return 'success'
    case 'failed':
    case 'error':
      return 'failure'
    case 'pending':
      return 'in_progress'
    case 'notapplicable':
      return 'neutral'
    default:
      return state.toLowerCase()
  }
}

async function safeJson<T>(runner: AzureDevOpsRunner, endpoint: string): Promise<T | undefined> {
  try {
    const out = (await runner(endpoint)).trim()
    return out ? (JSON.parse(out) as T) : undefined
  } catch {
    return undefined
  }
}

async function requireJson<T>(runner: AzureDevOpsRunner, endpoint: string): Promise<T | undefined> {
  const out = (await runner(endpoint)).trim()
  return out ? (JSON.parse(out) as T) : undefined
}

async function fetchThreadComments(
  runner: AzureDevOpsRunner,
  repo: string,
  pullRequestNumber: number
): Promise<IssueComment[]> {
  const out = await safeJson<{ value?: AzureDevOpsThread[] }>(
    runner,
    `git/repositories/${encodeURIComponent(repo)}/pullRequests/${pullRequestNumber}/threads`
  )
  return mapThreadsToComments(out?.value || [])
}

async function fetchStatuses(
  runner: AzureDevOpsRunner,
  repo: string,
  pullRequestNumber: number
): Promise<PullRequestStatusCheck[]> {
  const out = await safeJson<{ value?: AzureDevOpsStatus[] }>(
    runner,
    `git/repositories/${encodeURIComponent(repo)}/pullrequests/${pullRequestNumber}/statuses`
  )
  return (out?.value || []).map((s) => ({
    name: s.context?.name || s.description || 'build',
    status: s.state,
    conclusion: s.state ? normalizeAzureDevOpsBuildStatus(s.state) : undefined,
  }))
}

export async function getAzureDevOpsPullRequestDetail(
  repo: string,
  pullRequestNumber: number,
  runner: AzureDevOpsRunner
): Promise<PullRequestDetailResult> {
  try {
    const pr = await requireJson<{ description?: string; reviewers?: AzureDevOpsReviewerVote[] }>(
      runner,
      `git/repositories/${encodeURIComponent(repo)}/pullrequests/${pullRequestNumber}`
    )

    if (!pr) {
      return { ok: false, message: `Empty response from Azure DevOps for pull request #${pullRequestNumber}` }
    }

    const [comments, statusChecks] = await Promise.all([
      fetchThreadComments(runner, repo, pullRequestNumber),
      fetchStatuses(runner, repo, pullRequestNumber),
    ])

    const detail: PullRequestDetail = {
      number: pullRequestNumber,
      body: pr.description || '',
      comments,
      reviews: parseReviewers(pr.reviewers),
      statusCheckRollup: statusChecks,
    }
    return { ok: true, detail: sanitizePullRequestDetail(detail) }
  } catch (error) {
    const { message } = await resolveAzureDevOpsActionError(error, runner)
    return { ok: false, message }
  }
}

export async function getAzureDevOpsPullRequestChecks(
  repo: string,
  pullRequestNumber: number,
  runner: AzureDevOpsRunner
): Promise<PullRequestChecksResult> {
  try {
    return { ok: true, checks: await fetchStatuses(runner, repo, pullRequestNumber) }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Azure DevOps exposes no unified-diff API — the closest primitive is the PR
 * iterations/changes endpoint, which returns a structural list of changed
 * paths and change types, not patch text. Rather than approximate a diff
 * from that, this is a graceful "unsupported", mirroring
 * `bitbucketServerActions.getPullRequestDiffByNumber` in `forgeActions.ts`.
 */
export function getAzureDevOpsPullRequestDiff(): Promise<PullRequestDiffResult> {
  return Promise.resolve({
    ok: false,
    message: 'Pull request diffs are not supported for Azure DevOps yet.',
  })
}

export function getAzureDevOpsIssueDetail(): Promise<IssueDetailResult> {
  return Promise.resolve({
    ok: false,
    message: 'Azure DevOps tracks Work Items, not issues — coco does not map them yet.',
  })
}

export const __test = {
  mapThreadsToComments,
  parseReviewers,
  normalizeAzureDevOpsBuildStatus,
  voteToState,
}
