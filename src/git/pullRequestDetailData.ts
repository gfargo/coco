/**
 * Per-item PR detail fetcher (#882 inspector hydration). Mirrors
 * `issueDetailData.ts`'s shape — pulls body, comments, reviews,
 * and the status-check rollup on demand when the user rests the
 * cursor on a PR row.
 *
 * Distinct from the existing `pullRequestData.ts` which fetches
 * the CURRENT BRANCH's PR via `gh pr view` (no number arg). This
 * fetcher takes an explicit PR number so the triage view can
 * hydrate any cursored PR, not just the one matching the current
 * branch.
 */

import { defaultGhRunner, type GhRunner } from './githubCli'
import { sanitizePullRequestDetail } from './forgeText'
import type { IssueComment } from './issueDetailData'

export type PullRequestReview = {
  author?: string
  state: string
  body: string
  submittedAt: string
}

export type PullRequestStatusCheck = {
  name: string
  status?: string
  conclusion?: string
  /**
   * Opaque per-forge identifier for re-running this check — a GitHub
   * Actions workflow run id, a GitLab pipeline job id, etc. `undefined`
   * when the forge/check doesn't expose one (e.g. a legacy commit
   * status with no backing job to re-trigger).
   */
  runId?: string
}

export type PullRequestDetail = {
  number: number
  body: string
  comments: IssueComment[]
  reviews: PullRequestReview[]
  statusCheckRollup: PullRequestStatusCheck[]
  /**
   * `true` when the comment list is known to be incomplete — either the
   * pagination ceiling was reached or a mid-pagination error was swallowed.
   * Used by the preview pane to render a "… more comments" notice so
   * reviewers know they may be missing entries.
   */
  commentsTruncated?: boolean
}

/**
 * `gh pr view <#> --json` field list. Subset of what
 * `pullRequestData.ts`'s `PULL_REQUEST_VIEW_JSON_FIELDS` includes —
 * the triage list payload already carries the structural metadata
 * (state, isDraft, branches, labels, etc.), so the detail fetch
 * only needs the heavy/expensive fields that the list omits.
 */
export const PULL_REQUEST_DETAIL_JSON_FIELDS = [
  'number',
  'body',
  'comments',
  'reviews',
  'statusCheckRollup',
].join(',')

function parseComments(value: unknown): IssueComment[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) => {
    const raw = entry as Record<string, unknown>
    const author =
      raw.author && typeof raw.author === 'object' && 'login' in raw.author
        ? String((raw.author as { login: unknown }).login)
        : undefined
    return {
      author,
      body: typeof raw.body === 'string' ? raw.body : '',
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    }
  })
}

function parseReviews(value: unknown): PullRequestReview[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => {
      const raw = entry as Record<string, unknown>
      const author =
        raw.author && typeof raw.author === 'object' && 'login' in raw.author
          ? String((raw.author as { login: unknown }).login)
          : undefined
      return {
        author,
        state: typeof raw.state === 'string' ? raw.state : '',
        body: typeof raw.body === 'string' ? raw.body : '',
        submittedAt: typeof raw.submittedAt === 'string' ? raw.submittedAt : '',
      }
    })
    // gh occasionally returns review entries without an author when the
    // reviewer's account is deleted. Those are unactionable noise here;
    // strip them so the inspector doesn't render anonymous rows.
    .filter((review) => review.author || review.body)
}

/**
 * gh's `statusCheckRollup` entries for Actions-backed check runs carry a
 * `detailsUrl` like `https://github.com/owner/repo/actions/runs/123/job/456`
 * — the workflow RUN id (not the job id) is what `gh run rerun` takes, so
 * pull it out here rather than plumbing a second gh call just to resolve it.
 */
function parseCheckRunId(detailsUrl: unknown): string | undefined {
  if (typeof detailsUrl !== 'string') return undefined
  return detailsUrl.match(/\/actions\/runs\/(\d+)/)?.[1]
}

function parseStatusCheckRollup(value: unknown): PullRequestStatusCheck[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) => {
    const raw = entry as Record<string, unknown>
    return {
      name: String(raw.name || raw.context || 'check'),
      status: typeof raw.status === 'string' ? raw.status : undefined,
      conclusion: typeof raw.conclusion === 'string' ? raw.conclusion : undefined,
      runId: parseCheckRunId(raw.detailsUrl),
    }
  })
}

function parsePullRequestDetail(output: string): PullRequestDetail | undefined {
  const trimmed = output.trim()
  if (!trimmed) return undefined

  const raw = JSON.parse(trimmed) as Record<string, unknown>
  if (typeof raw.number !== 'number') return undefined

  return {
    number: raw.number,
    body: typeof raw.body === 'string' ? raw.body : '',
    comments: parseComments(raw.comments),
    reviews: parseReviews(raw.reviews),
    statusCheckRollup: parseStatusCheckRollup(raw.statusCheckRollup),
  }
}

export type PullRequestDetailResult =
  | { ok: true; detail: PullRequestDetail }
  | { ok: false; message: string }

export async function getPullRequestDetail(
  pullRequestNumber: number,
  runner: GhRunner = defaultGhRunner
): Promise<PullRequestDetailResult> {
  try {
    const output = await runner([
      'pr',
      'view',
      String(pullRequestNumber),
      '--json',
      PULL_REQUEST_DETAIL_JSON_FIELDS,
    ])
    const detail = parsePullRequestDetail(output)
    if (!detail) {
      return {
        ok: false,
        message: `Empty response from gh for pull request #${pullRequestNumber}`,
      }
    }
    return { ok: true, detail: sanitizePullRequestDetail(detail) }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

export type PullRequestChecksResult =
  | { ok: true; checks: PullRequestStatusCheck[] }
  | { ok: false; message: string }

/**
 * Lighter-weight sibling of `getPullRequestDetail` that fetches only the
 * check rollup (OSS-1615) — used by the checks surface and by
 * `rerunFailedChecks`, which needs the freshest run ids rather than
 * whatever happened to be cached from the last full detail fetch.
 */
export async function getPullRequestChecks(
  pullRequestNumber: number,
  runner: GhRunner = defaultGhRunner
): Promise<PullRequestChecksResult> {
  try {
    const output = await runner(['pr', 'view', String(pullRequestNumber), '--json', 'statusCheckRollup'])
    const trimmed = output.trim()
    if (!trimmed) return { ok: true, checks: [] }
    const raw = JSON.parse(trimmed) as { statusCheckRollup?: unknown }
    return { ok: true, checks: parseStatusCheckRollup(raw.statusCheckRollup) }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}
