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

/** Map raw GitLab notes to comments, dropping system (activity) notes. */
function mapNotes(notes: GlabNote[]): IssueComment[] {
  return notes
    // System notes are activity events (label changes, etc.), not comments.
    .filter((note) => !note.system && (note.body || '').trim())
    .map((note) => ({
      author: note.author?.username,
      body: note.body || '',
      createdAt: note.created_at || '',
    }))
}

function parseNotes(output: string): IssueComment[] {
  const trimmed = output.trim()
  if (!trimmed) return []
  const raw = JSON.parse(trimmed)
  // GitLab returns `{ "message": ... }` on errors; treat any non-array as "no
  // comments" rather than throwing a cryptic "notes.filter is not a function"
  // that would collapse the entire detail panel.
  if (!Array.isArray(raw)) return []
  return mapNotes(raw as GlabNote[])
}

/**
 * Page through an MR/issue's notes endpoint. GitLab caps `per_page` at 100, so a
 * single request silently truncates long discussion threads; accumulate pages
 * (up to a 2000-note ceiling) until a short page. A failed or malformed page
 * degrades to whatever was collected rather than failing the whole detail.
 */
async function fetchAllNotes(runner: GlabRunner, base: string): Promise<IssueComment[]> {
  const comments: IssueComment[] = []
  for (let page = 1; page <= 20; page++) {
    let out = ''
    try {
      out = (await runner(['api', `${base}/notes?per_page=100&page=${page}`])).trim()
    } catch {
      break
    }
    if (!out) break
    let raw: unknown
    try {
      raw = JSON.parse(out)
    } catch {
      break
    }
    if (!Array.isArray(raw)) break
    comments.push(...mapNotes(raw as GlabNote[]))
    if (raw.length < 100) break
  }
  return comments
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

/**
 * Map a GitLab pipeline status to the GitHub check vocabulary the shared
 * inspector renderer buckets on (success / failure / pending). Without this,
 * GitLab's `failed`/`running`/`canceled` fall through to the renderer's "other"
 * bucket, so a red pipeline shows "1 other" instead of "1 fail".
 */
function normalizePipelineConclusion(status: string): string {
  switch (status) {
    case 'success':
      return 'success'
    case 'failed':
      return 'failure'
    case 'canceled':
      return 'cancelled'
    case 'running':
      return 'in_progress'
    case 'pending':
    case 'created':
    case 'scheduled':
    case 'manual':
    case 'preparing':
    case 'waiting_for_resource':
      return 'pending'
    default:
      return status // skipped / unknown → renderer's "other" bucket
  }
}

function parsePipelineAsChecks(pipeline: unknown): PullRequestStatusCheck[] {
  const p = pipeline as { status?: string } | null | undefined
  if (!p || typeof p.status !== 'string') return []
  // GitLab pipeline status: success/failed/running/pending/canceled/skipped.
  return [{ name: 'pipeline', status: p.status, conclusion: normalizePipelineConclusion(p.status) }]
}

export async function getMergeRequestDetail(
  projectPath: string,
  mergeRequestNumber: number,
  runner: GlabRunner = defaultGlabRunner
): Promise<PullRequestDetailResult> {
  try {
    const base = `projects/${enc(projectPath)}/merge_requests/${mergeRequestNumber}`
    const [mr, comments, approvals] = await Promise.all([
      safeJson<{ description?: string; head_pipeline?: unknown }>(runner, base),
      fetchAllNotes(runner, base),
      safeJson<unknown>(runner, `${base}/approvals`),
    ])

    if (!mr) {
      return { ok: false, message: `Empty response from glab for merge request !${mergeRequestNumber}` }
    }

    const detail: PullRequestDetail = {
      number: mergeRequestNumber,
      body: mr.description || '',
      comments,
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
    const [issue, comments] = await Promise.all([
      safeJson<{ description?: string }>(runner, base),
      fetchAllNotes(runner, base),
    ])

    if (!issue) {
      return { ok: false, message: `Empty response from glab for issue #${issueNumber}` }
    }

    const detail: IssueDetail = {
      number: issueNumber,
      body: issue.description || '',
      comments,
    }
    return { ok: true, detail }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export const __test = { parseNotes, parseApprovalsAsReviews, parsePipelineAsChecks }
