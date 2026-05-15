/**
 * Preview-pane content formatters for the promoted views (P4.1).
 *
 * Each formatter turns an existing context entry into a list of lines the
 * detail panel renders on the right. Pure — no git calls, no React — so the
 * shape is easy to assert in unit tests and the renderer stays a simple map
 * over the result.
 *
 * Designed to mirror what `lazygit` / `yazi` show in their preview pane:
 * the answer to "what am I about to act on" without forcing a checkout / show.
 */

import { BranchRef } from '../../git/branchData'
import type { IssueDetail } from '../../git/issueDetailData'
import type { IssueListItem } from '../../git/issuesListData'
import type { PullRequestDetail } from '../../git/pullRequestDetailData'
import type { PullRequestListItem } from '../../git/pullRequestListData'
import { StashEntry } from '../../git/stashData'
import { GitTagRef } from '../../git/tagData'

export type PreviewLineEmphasis = 'heading' | 'dim'

export type PreviewLine = {
  text: string
  emphasis?: PreviewLineEmphasis
}

const heading = (text: string): PreviewLine => ({ text, emphasis: 'heading' })
const dim = (text: string): PreviewLine => ({ text, emphasis: 'dim' })
const line = (text: string): PreviewLine => ({ text })
const blank = (): PreviewLine => ({ text: '' })

function shortHash(hash: string | undefined): string {
  return hash ? hash.slice(0, 7) : '<none>'
}

/* ------------------------------- branch -------------------------------- */

function describeBranchDivergence(branch: Pick<BranchRef, 'ahead' | 'behind'>): string {
  if (branch.ahead === 0 && branch.behind === 0) {
    return 'in sync'
  }
  return `${branch.ahead} ahead, ${branch.behind} behind`
}

export function formatBranchPreview(branch: BranchRef | undefined): PreviewLine[] {
  if (!branch) {
    return [dim('Select a branch to preview.')]
  }

  const out: PreviewLine[] = [
    heading(branch.shortName),
    blank(),
    line(`Tip:    ${shortHash(branch.hash)}`),
    line(`Date:   ${branch.date || '<unknown>'}`),
    line(`Subject: ${branch.subject || '<no subject>'}`),
    blank(),
  ]

  if (branch.upstream) {
    out.push(line(`Upstream: ${branch.upstream}`))
    out.push(line(`Status:   ${describeBranchDivergence(branch)}`))
  } else {
    out.push(dim('No upstream tracking.'))
  }

  if (branch.current) {
    out.push(blank())
    out.push(dim('* current branch'))
  }

  return out
}

/* --------------------------------- tag --------------------------------- */

export function formatTagPreview(tag: GitTagRef | undefined): PreviewLine[] {
  if (!tag) {
    return [dim('Select a tag to preview.')]
  }

  return [
    heading(tag.name),
    blank(),
    line(`Commit:  ${shortHash(tag.hash)}`),
    line(`Date:    ${tag.date || '<unknown>'}`),
    blank(),
    line('Subject:'),
    line(`  ${tag.subject || '<no subject>'}`),
  ]
}

/* -------------------------------- stash -------------------------------- */

export type StashPreviewOptions = {
  /** Cap on listed file paths in the preview. */
  fileCap?: number
}

export function formatStashPreview(
  stash: StashEntry | undefined,
  options: StashPreviewOptions = {}
): PreviewLine[] {
  if (!stash) {
    return [dim('Select a stash to preview.')]
  }

  const cap = options.fileCap ?? 10
  const out: PreviewLine[] = [
    heading(stash.ref),
    blank(),
    line(`On:      ${stash.branch || '<unknown>'}`),
    line(`Commit:  ${shortHash(stash.hash)}`),
    line(`Date:    ${stash.date || '<unknown>'}`),
    blank(),
    line('Message:'),
    line(`  ${stash.message || '<no message>'}`),
  ]

  const files = stash.files || []
  if (files.length > 0) {
    out.push(blank())
    out.push(line(`Files (${files.length}):`))
    files.slice(0, cap).forEach((path) => out.push(line(`  ${path}`)))
    if (files.length > cap) {
      out.push(dim(`  … ${files.length - cap} more`))
    }
  } else {
    out.push(blank())
    out.push(dim('No files in stash.'))
  }

  return out
}

/* ------------------------- detail-section helpers ----------------------- */

/**
 * Render the first `maxLines` non-empty lines of an issue / PR body
 * as preview lines. Returns an empty array when the body itself is
 * empty (or whitespace only) so callers can `out.push(...body(...))`
 * without an extra guard. Trailer appears only when content was
 * actually truncated.
 */
function bodyExcerptLines(body: string, maxLines: number): PreviewLine[] {
  if (!body.trim()) return []
  const lines = body.replace(/\r\n/g, '\n').split('\n')
  // Drop leading blanks so the excerpt opens on the first real line
  // rather than rendering an awkward "blank line, then body".
  while (lines.length > 0 && !lines[0].trim()) lines.shift()
  const shown = lines.slice(0, maxLines)
  const truncated = lines.length > maxLines
  const out: PreviewLine[] = [
    heading('Body'),
    ...shown.map((l) => line(l)),
  ]
  if (truncated) {
    out.push(dim(`… ${lines.length - maxLines} more line(s)`))
  }
  return out
}

function shortenLine(value: string, maxLength: number): string {
  const flattened = value.replace(/\s+/g, ' ').trim()
  if (flattened.length <= maxLength) return flattened
  return `${flattened.slice(0, Math.max(0, maxLength - 1))}…`
}

function commentsSection(
  comments: ReadonlyArray<{ author?: string; body: string }>,
  maxShown: number
): PreviewLine[] {
  if (comments.length === 0) return []
  const recent = comments.slice(-maxShown)
  const out: PreviewLine[] = [heading(`Comments (${comments.length})`)]
  for (const comment of recent) {
    const who = comment.author || 'anonymous'
    out.push(line(`@${who}: ${shortenLine(comment.body, 80)}`))
  }
  if (comments.length > recent.length) {
    out.push(dim(`… ${comments.length - recent.length} earlier comment(s)`))
  }
  return out
}

function reviewsSection(
  reviews: ReadonlyArray<{ author?: string; state: string; body: string }>
): PreviewLine[] {
  if (reviews.length === 0) return []
  const out: PreviewLine[] = [heading(`Reviews (${reviews.length})`)]
  for (const review of reviews) {
    const who = review.author || 'anonymous'
    const stateLabel = (review.state || 'commented').toLowerCase().replace(/_/g, ' ')
    const inlineBody = review.body ? ` — ${shortenLine(review.body, 60)}` : ''
    out.push(line(`@${who} (${stateLabel})${inlineBody}`))
  }
  return out
}

function statusChecksSection(
  checks: ReadonlyArray<{ name: string; status?: string; conclusion?: string }>
): PreviewLine[] {
  if (checks.length === 0) return []
  const grouped = {
    success: 0,
    failure: 0,
    pending: 0,
    other: 0,
  }
  for (const check of checks) {
    const result = check.conclusion?.toLowerCase() ?? check.status?.toLowerCase() ?? ''
    if (result === 'success') grouped.success++
    else if (result === 'failure' || result === 'cancelled' || result === 'timed_out')
      grouped.failure++
    else if (result === 'pending' || result === 'queued' || result === 'in_progress')
      grouped.pending++
    else grouped.other++
  }
  const parts: string[] = []
  if (grouped.success) parts.push(`${grouped.success} pass`)
  if (grouped.failure) parts.push(`${grouped.failure} fail`)
  if (grouped.pending) parts.push(`${grouped.pending} pending`)
  if (grouped.other) parts.push(`${grouped.other} other`)
  return [
    heading(`Checks (${checks.length})`),
    line(parts.join(' · ')),
  ]
}

/* -------------------------------- issue -------------------------------- */

/**
 * Format an issue triage entry into preview lines (#882 phase 3,
 * body + comments added in the inspector-hydration follow-up).
 * The list payload from `gh issue list --json` carries metadata
 * only; the optional `detail` argument is filled by the runtime's
 * debounced hydration effect when the cursor rests on a row, and
 * unlocks the body / comments sections.
 */
export function formatIssueTriagePreview(
  issue: IssueListItem | undefined,
  detail?: IssueDetail
): PreviewLine[] {
  if (!issue) {
    return [dim('Select an issue to preview.')]
  }

  const out: PreviewLine[] = [
    heading(`#${issue.number} · ${issue.title}`),
    blank(),
    line(`State:    ${issue.state.toLowerCase()}`),
  ]
  if (issue.author) out.push(line(`Author:   ${issue.author}`))
  if (issue.assignees && issue.assignees.length > 0) {
    out.push(line(`Assigned: ${issue.assignees.join(', ')}`))
  }
  if (issue.labels && issue.labels.length > 0) {
    out.push(line(`Labels:   ${issue.labels.join(', ')}`))
  }
  if (typeof issue.comments === 'number') {
    out.push(line(`Comments: ${issue.comments}`))
  }
  out.push(blank())
  if (issue.createdAt) out.push(line(`Created:  ${issue.createdAt}`))
  if (issue.updatedAt) out.push(line(`Updated:  ${issue.updatedAt}`))
  out.push(blank())
  out.push(dim(issue.url))

  // Hydrated sections (body + recent comments). Inserted only when
  // the runtime has finished the per-cursor-rest detail fetch and
  // populated the cache.
  if (detail) {
    const body = bodyExcerptLines(detail.body, 6)
    if (body.length > 0) {
      out.push(blank())
      out.push(...body)
    }
    const comments = commentsSection(detail.comments, 3)
    if (comments.length > 0) {
      out.push(blank())
      out.push(...comments)
    }
  } else if (typeof issue.comments === 'number' && issue.comments > 0) {
    // Pre-hydration affordance — tell the user the body / comments
    // section is coming, so a 250ms wait doesn't look like a bug.
    out.push(blank())
    out.push(dim('Loading body + comments…'))
  }

  return out
}

/* ----------------------------- pull request ---------------------------- */

/**
 * Format a pull-request triage entry into preview lines (#882 phase 3,
 * body / comments / reviews / checks added in the inspector-hydration
 * follow-up). Optional `detail` argument is filled by the runtime's
 * debounced hydration effect when the cursor rests on a row.
 */
export function formatPullRequestTriagePreview(
  pr: PullRequestListItem | undefined,
  detail?: PullRequestDetail
): PreviewLine[] {
  if (!pr) {
    return [dim('Select a pull request to preview.')]
  }

  const out: PreviewLine[] = [
    heading(`#${pr.number} · ${pr.title}`),
    blank(),
    line(`State:     ${pr.isDraft ? 'draft' : pr.state.toLowerCase()}`),
  ]
  if (pr.author) out.push(line(`Author:    ${pr.author}`))
  out.push(line(`Branches:  ${pr.headRefName} → ${pr.baseRefName}`))
  if (pr.mergeable || pr.mergeStateStatus) {
    const merge = [pr.mergeable, pr.mergeStateStatus].filter(Boolean).join(' / ')
    out.push(line(`Mergeable: ${merge.toLowerCase()}`))
  }
  if (pr.reviewDecision) {
    out.push(line(`Review:    ${pr.reviewDecision.toLowerCase().replace(/_/g, ' ')}`))
  }
  if (pr.assignees && pr.assignees.length > 0) {
    out.push(line(`Assigned:  ${pr.assignees.join(', ')}`))
  }
  if (pr.labels && pr.labels.length > 0) {
    out.push(line(`Labels:    ${pr.labels.join(', ')}`))
  }
  out.push(blank())
  if (pr.createdAt) out.push(line(`Created:   ${pr.createdAt}`))
  if (pr.updatedAt) out.push(line(`Updated:   ${pr.updatedAt}`))
  out.push(blank())
  out.push(dim(pr.url))

  // Hydrated sections — body, status checks, reviews, comments.
  // Status checks come BEFORE reviews because failing CI is usually
  // what a triager wants to see first; reviews come second because
  // they're the human-judgment layer on top.
  if (detail) {
    const body = bodyExcerptLines(detail.body, 6)
    if (body.length > 0) {
      out.push(blank())
      out.push(...body)
    }
    const checks = statusChecksSection(detail.statusCheckRollup)
    if (checks.length > 0) {
      out.push(blank())
      out.push(...checks)
    }
    const reviews = reviewsSection(detail.reviews)
    if (reviews.length > 0) {
      out.push(blank())
      out.push(...reviews)
    }
    const comments = commentsSection(detail.comments, 3)
    if (comments.length > 0) {
      out.push(blank())
      out.push(...comments)
    }
  } else {
    // Pre-hydration affordance — same as the issue preview.
    out.push(blank())
    out.push(dim('Loading body + reviews + comments…'))
  }

  return out
}
