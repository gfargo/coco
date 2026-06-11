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
}

export type PullRequestDetail = {
  number: number
  body: string
  comments: IssueComment[]
  reviews: PullRequestReview[]
  statusCheckRollup: PullRequestStatusCheck[]
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

function parseStatusCheckRollup(value: unknown): PullRequestStatusCheck[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) => {
    const raw = entry as Record<string, unknown>
    return {
      name: String(raw.name || raw.context || 'check'),
      status: typeof raw.status === 'string' ? raw.status : undefined,
      conclusion: typeof raw.conclusion === 'string' ? raw.conclusion : undefined,
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
