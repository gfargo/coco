import chalk from 'chalk'
import type { IssueListItem } from './issuesListData'
import type { PullRequestListItem } from './pullRequestListData'

/**
 * Pad a (possibly already-colored) string to `width` visible columns.
 * We can't naively `String#padEnd` after coloring because ANSI escape
 * codes inflate `.length` past the visible width. The pattern here is
 * "measure the plain string, color last" — every formatter below
 * computes column widths from raw values and passes the visible
 * length explicitly so `padToVisible` only needs to add spaces.
 */
function padToVisible(colored: string, visibleLength: number, width: number): string {
  if (visibleLength >= width) return colored
  return colored + ' '.repeat(width - visibleLength)
}

const STATE_COLORS: Record<string, (s: string) => string> = {
  OPEN: chalk.green,
  CLOSED: chalk.red,
  MERGED: chalk.magenta,
}

function colorState(state: string): string {
  const fn = STATE_COLORS[state.toUpperCase()] || chalk.dim
  return fn(state.toLowerCase())
}

function formatLabels(labels: string[] | undefined): string {
  if (!labels || labels.length === 0) return ''
  return chalk.dim(labels.map((l) => `[${l}]`).join(' '))
}

function formatReviewDecision(decision: string | undefined): string {
  if (!decision) return ' '
  switch (decision) {
    case 'APPROVED':
      return chalk.green('✓')
    case 'CHANGES_REQUESTED':
      return chalk.red('✗')
    case 'REVIEW_REQUIRED':
      return chalk.yellow('?')
    default:
      return chalk.dim(decision.slice(0, 1))
  }
}

function formatMergeable(mergeable: string | undefined, mergeStateStatus: string | undefined): string {
  if (mergeStateStatus === 'CLEAN') return chalk.green('●')
  if (mergeStateStatus === 'BLOCKED') return chalk.yellow('●')
  if (mergeStateStatus === 'DIRTY' || mergeable === 'CONFLICTING') return chalk.red('●')
  if (mergeStateStatus === 'BEHIND') return chalk.cyan('●')
  if (mergeStateStatus === 'UNSTABLE') return chalk.yellow('●')
  return chalk.dim('●')
}

export function formatIssueList(items: IssueListItem[]): string {
  if (items.length === 0) {
    return chalk.dim('No issues match the current filter.')
  }

  const numberWidth = Math.max(...items.map((i) => `#${i.number}`.length))
  const authorWidth = Math.max(
    ...items.map((i) => (i.author ? i.author.length : 0)),
    1
  )
  const stateWidth = 6

  return items
    .map((issue) => {
      const numRaw = `#${issue.number}`
      const num = padToVisible(chalk.dim(numRaw), numRaw.length, numberWidth)

      const stateRaw = issue.state.toLowerCase()
      const state = padToVisible(colorState(issue.state), stateRaw.length, stateWidth)

      const authorRaw = issue.author || ''
      const author = padToVisible(chalk.cyan(authorRaw), authorRaw.length, authorWidth)

      const comments =
        typeof issue.comments === 'number' && issue.comments > 0
          ? chalk.dim(` ${issue.comments}c`)
          : ''
      const labels = formatLabels(issue.labels)

      const parts = [num, state, author, issue.title]
      if (labels) parts.push(labels)
      return parts.join('  ') + comments
    })
    .join('\n')
}

export function formatPullRequestList(
  items: PullRequestListItem[],
  nounLower = 'pull request'
): string {
  if (items.length === 0) {
    return chalk.dim(`No ${nounLower}s match the current filter.`)
  }

  const numberWidth = Math.max(...items.map((i) => `#${i.number}`.length))
  const authorWidth = Math.max(
    ...items.map((i) => (i.author ? i.author.length : 0)),
    1
  )
  const headWidth = Math.min(
    Math.max(...items.map((i) => i.headRefName.length), 1),
    28
  )
  const stateWidth = 6

  return items
    .map((pr) => {
      const numRaw = `#${pr.number}`
      const num = padToVisible(chalk.dim(numRaw), numRaw.length, numberWidth)

      const stateRaw = pr.isDraft ? 'draft' : pr.state.toLowerCase()
      const stateColored = pr.isDraft ? chalk.dim('draft') : colorState(pr.state)
      const state = padToVisible(stateColored, stateRaw.length, stateWidth)

      const mergeable = formatMergeable(pr.mergeable, pr.mergeStateStatus)
      const review = formatReviewDecision(pr.reviewDecision)

      const authorRaw = pr.author || ''
      const author = padToVisible(chalk.cyan(authorRaw), authorRaw.length, authorWidth)

      const branchTruncated =
        pr.headRefName.length > headWidth
          ? pr.headRefName.slice(0, headWidth - 1) + '…'
          : pr.headRefName
      const branch = padToVisible(chalk.dim(branchTruncated), branchTruncated.length, headWidth)

      const labels = formatLabels(pr.labels)

      const parts = [num, state, mergeable, review, author, branch, pr.title]
      if (labels) parts.push(labels)
      return parts.join('  ')
    })
    .join('\n')
}
