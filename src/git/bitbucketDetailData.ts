import { defaultBitbucketRunner, type BitbucketRunner } from './bitbucketCli'
import { paginate } from './forgeLoad'
import { sanitizeIssueDetail, sanitizePullRequestDetail } from './forgeText'
import type { IssueComment, IssueDetail, IssueDetailResult } from './issueDetailData'
import type {
  PullRequestDetail,
  PullRequestDetailResult,
  PullRequestReview,
  PullRequestStatusCheck,
} from './pullRequestDetailData'

/**
 * On-demand Bitbucket pull-request / issue detail for the workstation
 * inspector. Emits the SAME detail shapes as the GitHub and GitLab detail
 * loaders so the inspector renders unchanged.
 *
 * `projectPath` is `workspace/repo_slug` (bound by the forge adapter from the
 * detected repository). Bitbucket spreads detail across endpoints: the PR body
 * lives on the PR itself; comments come from the `/comments` sub-resource;
 * participant approvals substitute for reviews; commit statuses stand in for
 * CI checks.
 */

type BitbucketComment = {
  id?: number
  content?: { raw?: string }
  created_on?: string
  author?: { nickname?: string }
  deleted?: boolean
}

type BitbucketParticipant = {
  user?: { nickname?: string }
  approved?: boolean
  role?: string
}

type BitbucketStatus = {
  key?: string
  name?: string
  state?: string
  url?: string
}

function mapComments(comments: BitbucketComment[]): IssueComment[] {
  return comments
    .filter((c) => !c.deleted && (c.content?.raw || '').trim())
    .map((c) => ({
      author: c.author?.nickname,
      body: c.content?.raw || '',
      createdAt: c.created_on || '',
    }))
}

async function safeJson<T>(runner: BitbucketRunner, endpoint: string): Promise<T | undefined> {
  try {
    const out = (await runner(endpoint)).trim()
    return out ? (JSON.parse(out) as T) : undefined
  } catch {
    return undefined
  }
}

async function fetchAllComments(
  runner: BitbucketRunner,
  base: string
): Promise<IssueComment[]> {
  return paginate({
    fetchPage: async (page) => (await runner(`${base}/comments?pagelen=50&page=${page}`)).trim(),
    parsePage: (output) => {
      if (!output) return undefined
      const raw = JSON.parse(output)
      const page_data = raw as { values?: BitbucketComment[] }
      if (!Array.isArray(page_data?.values)) return undefined
      return { items: mapComments(page_data.values), hasMore: page_data.values.length >= 50 }
    },
    want: Infinity,
    maxPages: 20,
    onError: 'stop',
  })
}

function parseParticipantsAsReviews(participants: unknown): PullRequestReview[] {
  if (!Array.isArray(participants)) return []
  return (participants as BitbucketParticipant[])
    .filter((p) => p.role === 'REVIEWER' && p.user?.nickname)
    .map((p) => ({
      author: p.user?.nickname,
      state: p.approved ? 'APPROVED' : 'COMMENTED',
      body: '',
      submittedAt: '',
    }))
    .filter((r) => r.author) as PullRequestReview[]
}

function normalizeBitbucketBuildStatus(state: string): string {
  switch (state.toUpperCase()) {
    case 'SUCCESSFUL':
      return 'success'
    case 'FAILED':
      return 'failure'
    case 'INPROGRESS':
      return 'in_progress'
    case 'STOPPED':
      return 'cancelled'
    default:
      return state.toLowerCase()
  }
}

async function fetchCommitStatuses(
  runner: BitbucketRunner,
  path: string,
  commit: string | undefined
): Promise<PullRequestStatusCheck[]> {
  if (!commit) return []
  try {
    const out = (await runner(`repositories/${path}/commit/${commit}/statuses`)).trim()
    if (!out) return []
    const data = JSON.parse(out) as { values?: BitbucketStatus[] }
    if (!Array.isArray(data?.values)) return []
    return data.values.map((s) => ({
      name: s.name || s.key || 'build',
      status: s.state,
      conclusion: s.state ? normalizeBitbucketBuildStatus(s.state) : undefined,
    }))
  } catch {
    return []
  }
}

export async function getBitbucketPullRequestDetail(
  projectPath: string,
  pullRequestNumber: number,
  runner: BitbucketRunner = defaultBitbucketRunner
): Promise<PullRequestDetailResult> {
  try {
    const base = `repositories/${projectPath}/pullrequests/${pullRequestNumber}`
    const pr = await safeJson<{
      description?: string
      participants?: unknown
      source?: { commit?: { hash?: string } }
    }>(runner, base)

    if (!pr) {
      return { ok: false, message: `Empty response from Bitbucket for pull request #${pullRequestNumber}` }
    }

    const [comments, statusChecks] = await Promise.all([
      fetchAllComments(runner, base),
      fetchCommitStatuses(runner, projectPath, pr.source?.commit?.hash),
    ])

    const detail: PullRequestDetail = {
      number: pullRequestNumber,
      body: pr.description || '',
      comments,
      reviews: parseParticipantsAsReviews(pr.participants),
      statusCheckRollup: statusChecks,
    }
    return { ok: true, detail: sanitizePullRequestDetail(detail) }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export async function getBitbucketIssueDetail(
  projectPath: string,
  issueNumber: number,
  runner: BitbucketRunner = defaultBitbucketRunner
): Promise<IssueDetailResult> {
  try {
    const base = `repositories/${projectPath}/issues/${issueNumber}`
    const issue = await safeJson<{
      content?: { raw?: string }
    }>(runner, base)

    if (!issue) {
      return { ok: false, message: `Empty response from Bitbucket for issue #${issueNumber}` }
    }

    const comments = await fetchAllComments(runner, base)

    const detail: IssueDetail = {
      number: issueNumber,
      body: issue.content?.raw || '',
      comments,
    }
    return { ok: true, detail: sanitizeIssueDetail(detail) }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export const __test = {
  mapComments,
  parseParticipantsAsReviews,
  normalizeBitbucketBuildStatus,
}
