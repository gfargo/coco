import { PullRequestInfo, PullRequestStatusCheck } from '../../git/pullRequestData'

/**
 * Pull request panel formatting helpers (#783).
 *
 * The runtime owns the Ink layout — these helpers produce the strings
 * and glyph metadata so the renderer just maps over them. Keeping the
 * formatting logic here makes it easy to unit-test (no Ink dependency)
 * and matches the TUI cadence preference of separating helpers from
 * runtime.
 */

export type PullRequestCheckStatus = 'success' | 'failure' | 'pending' | 'neutral' | 'skipped'

/**
 * Normalize gh's two parallel signals (`status` for in-flight check
 * runs, `conclusion` for completed runs and status contexts) into a
 * single status enum the renderer can map to a glyph + color.
 */
export function normalizePullRequestCheckStatus(
  check: PullRequestStatusCheck
): PullRequestCheckStatus {
  const status = (check.status || '').toUpperCase()
  const conclusion = (check.conclusion || '').toUpperCase()

  // In-flight check runs: gh emits `status: IN_PROGRESS|QUEUED` with
  // no conclusion yet. `PENDING` covers status-context runs that are
  // still waiting on a reporter.
  if (!conclusion && (status === 'IN_PROGRESS' || status === 'QUEUED' || status === 'PENDING')) {
    return 'pending'
  }

  switch (conclusion || status) {
    case 'SUCCESS':
      return 'success'
    case 'FAILURE':
    case 'ERROR':
    case 'TIMED_OUT':
    case 'ACTION_REQUIRED':
      return 'failure'
    case 'NEUTRAL':
      return 'neutral'
    case 'SKIPPED':
    case 'CANCELLED':
      return 'skipped'
    default:
      return 'pending'
  }
}

/**
 * Glyph for a normalized check status. ASCII fallbacks keep the panel
 * usable on legacy terminals where the geometric shapes block isn't
 * rendered.
 */
export function pullRequestCheckGlyph(
  status: PullRequestCheckStatus,
  options: { ascii?: boolean } = {}
): string {
  if (options.ascii) {
    switch (status) {
      case 'success': return '+'
      case 'failure': return 'x'
      case 'pending': return '.'
      case 'neutral': return '-'
      case 'skipped': return '/'
    }
  }

  switch (status) {
    case 'success': return '✓'
    case 'failure': return '✗'
    case 'pending': return '◌'
    case 'neutral': return '○'
    case 'skipped': return '∼'
  }
}

export type PullRequestChecksSummary = {
  total: number
  success: number
  failure: number
  pending: number
  neutral: number
  skipped: number
}

export function summarizePullRequestChecks(
  checks: PullRequestStatusCheck[] | undefined
): PullRequestChecksSummary {
  const summary: PullRequestChecksSummary = {
    total: 0, success: 0, failure: 0, pending: 0, neutral: 0, skipped: 0,
  }
  if (!checks) return summary
  for (const check of checks) {
    summary.total += 1
    summary[normalizePullRequestCheckStatus(check)] += 1
  }
  return summary
}

/**
 * One-line summary like `5 checks · 4 ✓ · 1 ◌` for the panel header.
 * Hides zero-count categories so the line stays scannable.
 */
export function formatPullRequestChecksSummary(
  summary: PullRequestChecksSummary,
  options: { ascii?: boolean } = {}
): string {
  if (summary.total === 0) {
    return 'No status checks reported'
  }
  const parts: string[] = [`${summary.total} ${summary.total === 1 ? 'check' : 'checks'}`]
  const push = (count: number, status: PullRequestCheckStatus) => {
    if (count > 0) parts.push(`${count} ${pullRequestCheckGlyph(status, options)}`)
  }
  push(summary.success, 'success')
  push(summary.failure, 'failure')
  push(summary.pending, 'pending')
  push(summary.neutral, 'neutral')
  push(summary.skipped, 'skipped')
  return parts.join(' · ')
}

/**
 * Per-check rows for the table body. Each entry includes the
 * normalized status so the renderer can pick a color without
 * re-running the normalizer.
 */
export type PullRequestCheckRow = {
  glyph: string
  name: string
  status: PullRequestCheckStatus
  /** Raw context — `IN_PROGRESS`, `SUCCESS`, etc. — for the dim trailer. */
  detail: string
}

export function buildPullRequestCheckRows(
  checks: PullRequestStatusCheck[] | undefined,
  options: { ascii?: boolean } = {}
): PullRequestCheckRow[] {
  if (!checks) return []
  return checks.map((check) => {
    const status = normalizePullRequestCheckStatus(check)
    return {
      glyph: pullRequestCheckGlyph(status, options),
      name: check.name,
      status,
      detail: (check.conclusion || check.status || '').toLowerCase(),
    }
  })
}

/**
 * Counts of the per-state reviews. `decisionLabel` is the
 * GraphQL-aggregated review decision (APPROVED / CHANGES_REQUESTED /
 * REVIEW_REQUIRED / etc.) when available — that's the canonical
 * "what's the verdict" answer; the per-state counts surface as the
 * supporting detail.
 */
export type PullRequestReviewsSummary = {
  total: number
  approved: number
  changesRequested: number
  commented: number
  dismissed: number
  pending: number
  decisionLabel?: string
}

export function summarizePullRequestReviews(
  reviews: { state: string }[] | undefined,
  reviewDecision?: string
): PullRequestReviewsSummary {
  const summary: PullRequestReviewsSummary = {
    total: 0, approved: 0, changesRequested: 0, commented: 0, dismissed: 0, pending: 0,
    decisionLabel: reviewDecision || undefined,
  }
  if (!reviews) return summary
  for (const review of reviews) {
    summary.total += 1
    switch (review.state.toUpperCase()) {
      case 'APPROVED':
        summary.approved += 1
        break
      case 'CHANGES_REQUESTED':
        summary.changesRequested += 1
        break
      case 'COMMENTED':
        summary.commented += 1
        break
      case 'DISMISSED':
        summary.dismissed += 1
        break
      case 'PENDING':
        summary.pending += 1
        break
    }
  }
  return summary
}

export function formatPullRequestReviewsSummary(summary: PullRequestReviewsSummary): string {
  const decision = summary.decisionLabel
    ? summary.decisionLabel.replace(/_/g, ' ').toLowerCase()
    : undefined
  if (summary.total === 0) {
    return decision ? `No reviews · ${decision}` : 'No reviews submitted'
  }
  const parts: string[] = [`${summary.total} ${summary.total === 1 ? 'review' : 'reviews'}`]
  if (summary.approved > 0) parts.push(`${summary.approved} approved`)
  if (summary.changesRequested > 0) parts.push(`${summary.changesRequested} changes requested`)
  if (summary.commented > 0) parts.push(`${summary.commented} commented`)
  if (summary.pending > 0) parts.push(`${summary.pending} pending`)
  if (summary.dismissed > 0) parts.push(`${summary.dismissed} dismissed`)
  if (decision) parts.push(`decision: ${decision}`)
  return parts.join(' · ')
}

/**
 * One-line state badge for the header, e.g. `OPEN · draft` or `MERGED`.
 * Mergeable / merge-state is appended as a secondary chip when the PR
 * is open so the user sees `MERGEABLE` / `CONFLICTING` at a glance.
 */
export function formatPullRequestStateLine(pr: PullRequestInfo): string {
  const parts: string[] = [pr.state]
  if (pr.isDraft) parts.push('draft')
  if (pr.state === 'OPEN' && pr.mergeable) {
    parts.push(pr.mergeable.toLowerCase())
  }
  if (pr.state === 'OPEN' && pr.mergeStateStatus && pr.mergeStateStatus !== 'CLEAN') {
    parts.push(pr.mergeStateStatus.toLowerCase())
  }
  return parts.join(' · ')
}
