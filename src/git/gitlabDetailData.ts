import { defaultGlabRunner, type GlabRunner } from './glabCli'
import type { IssueComment, IssueDetail, IssueDetailResult } from './issueDetailData'
import type {
  PullRequestDetail,
  PullRequestDetailResult,
  PullRequestReview,
  PullRequestStatusCheck,
} from './pullRequestDetailData'

/**
 * On-demand GitLab MR / issue detail for the workstation inspector, the glab
 * counterparts to `pullRequestDetailData.ts` / `issueDetailData.ts`. They emit
 * the SAME detail shapes so the inspector renders unchanged.
 *
 * glab api is not repo-inferred for explicit endpoints, so these take the
 * encoded project path (the forge adapter binds it from the detected
 * repository). GitLab spreads detail across endpoints, so MR detail fans out to
 * the MR (description + pipeline), its notes (comments), and its approvals
 * (mapped to reviews); issue detail fans out to the issue and its notes.
 */

function enc(path: string): string {
  return encodeURIComponent(path)
}

type GlabNote = {
  body?: string
  created_at?: string
  system?: boolean
  author?: { username?: string }
}

function parseNotes(output: string): IssueComment[] {
  const trimmed = output.trim()
  if (!trimmed) return []
  const notes = JSON.parse(trimmed) as GlabNote[]
  return notes
    // System notes are activity events (label changes, etc.), not comments.
    .filter((note) => !note.system && (note.body || '').trim())
    .map((note) => ({
      author: note.author?.username,
      body: note.body || '',
      createdAt: note.created_at || '',
    }))
}

async function safeJson<T>(runner: GlabRunner, endpoint: string): Promise<T | undefined> {
  try {
    const out = (await runner(['api', endpoint])).trim()
    return out ? (JSON.parse(out) as T) : undefined
  } catch {
    return undefined
  }
}

function parseApprovalsAsReviews(approvals: unknown): PullRequestReview[] {
  const approvedBy = (approvals as { approved_by?: Array<{ user?: { username?: string } }> })?.approved_by
  if (!Array.isArray(approvedBy)) return []
  return approvedBy
    .map((entry) => ({
      author: entry.user?.username,
      state: 'APPROVED',
      body: '',
      submittedAt: '',
    }))
    .filter((review) => review.author)
}

function parsePipelineAsChecks(pipeline: unknown): PullRequestStatusCheck[] {
  const p = pipeline as { status?: string } | null | undefined
  if (!p || typeof p.status !== 'string') return []
  // GitLab pipeline status: success/failed/running/pending/canceled/skipped.
  return [{ name: 'pipeline', status: p.status, conclusion: p.status }]
}

export async function getMergeRequestDetail(
  projectPath: string,
  mergeRequestNumber: number,
  runner: GlabRunner = defaultGlabRunner
): Promise<PullRequestDetailResult> {
  try {
    const base = `projects/${enc(projectPath)}/merge_requests/${mergeRequestNumber}`
    const [mr, notesOut, approvals] = await Promise.all([
      safeJson<{ description?: string; head_pipeline?: unknown }>(runner, base),
      runner(['api', `${base}/notes`]).catch(() => ''),
      safeJson<unknown>(runner, `${base}/approvals`),
    ])

    if (!mr) {
      return { ok: false, message: `Empty response from glab for merge request !${mergeRequestNumber}` }
    }

    const detail: PullRequestDetail = {
      number: mergeRequestNumber,
      body: mr.description || '',
      comments: parseNotes(notesOut),
      reviews: parseApprovalsAsReviews(approvals),
      statusCheckRollup: parsePipelineAsChecks(mr.head_pipeline),
    }
    return { ok: true, detail }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export async function getGitLabIssueDetail(
  projectPath: string,
  issueNumber: number,
  runner: GlabRunner = defaultGlabRunner
): Promise<IssueDetailResult> {
  try {
    const base = `projects/${enc(projectPath)}/issues/${issueNumber}`
    const [issue, notesOut] = await Promise.all([
      safeJson<{ description?: string }>(runner, base),
      runner(['api', `${base}/notes`]).catch(() => ''),
    ])

    if (!issue) {
      return { ok: false, message: `Empty response from glab for issue #${issueNumber}` }
    }

    const detail: IssueDetail = {
      number: issueNumber,
      body: issue.description || '',
      comments: parseNotes(notesOut),
    }
    return { ok: true, detail }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export const __test = { parseNotes, parseApprovalsAsReviews, parsePipelineAsChecks }
