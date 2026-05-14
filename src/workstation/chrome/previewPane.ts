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
import type { IssueListItem } from '../../git/issuesListData'
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

/* -------------------------------- issue -------------------------------- */

/**
 * Format an issue triage entry into preview lines (#882 phase 3).
 * Returns a uniform "select to preview" message when nothing is
 * cursored; otherwise renders #/state/author/labels/assignees, a
 * timestamp pair, and a short body excerpt clipped at 6 lines.
 *
 * The list payload from `gh issue list --json` doesn't include body
 * text — that's a deliberate scope cut in phase 1 to keep the list
 * fetch cheap. The preview pane therefore omits the body section
 * entirely; phase 4 will introduce a per-issue fetch that hydrates
 * the body on demand when the cursor rests.
 */
export function formatIssueTriagePreview(
  issue: IssueListItem | undefined
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

  return out
}

/* ----------------------------- pull request ---------------------------- */

/**
 * Format a pull-request triage entry into preview lines (#882 phase 3).
 * Renders #/state/author/branches/labels/mergeable/review-decision and
 * a timestamp pair. Like the issue preview, the body is not included
 * — list payloads from `gh pr list --json` don't carry bodies; phase 4
 * will hydrate one per cursor rest.
 */
export function formatPullRequestTriagePreview(
  pr: PullRequestListItem | undefined
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

  return out
}
