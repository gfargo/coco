/**
 * Pull-request action panel (#783) — renders the current branch's PR
 * with header, checks table, reviews summary, and a body preview.
 * Action keys (m / x / a / R / c / O) are wired in inkInput.ts and
 * surfaced via the footer; this renderer is read-only.
 *
 * Three loading / fallback states matter:
 * - Provider data still loading → "Loading pull request..."
 * - GitHub remote present but no PR for the current branch → empty
 *   state hint pointing the user at `C` to create one.
 * - GitHub CLI missing / unauthenticated → unavailable hint.
 *
 * Extracted from `src/commands/log/inkRuntime.ts` as part of phase 5a.2
 * of #890. No behavior change.
 */

import type * as ReactTypes from 'react'
import type { LogInkContextStatus } from '../../chrome/context'
import { isLogInkContextKeyLoading } from '../../chrome/context'
import {
  buildPullRequestCheckRows,
  formatPullRequestChecksSummary,
  formatPullRequestReviewsSummary,
  formatPullRequestStateLine,
  summarizePullRequestChecks,
  summarizePullRequestReviews,
} from '../../chrome/pullRequestPanel'
import { formatLogInkLoading } from '../../chrome/surfaceStates'
import { truncateCells } from '../../chrome/text'
import type { LogInkTheme } from '../../chrome/theme'
import type { LogInkState } from '../../../commands/log/inkViewModel'
import type { LogInkComponents, LogInkContext } from '../../runtime/types'
import { focusBorderColor, panelTitle } from '../../runtime/utils'

export function renderPullRequestSurface(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  context: LogInkContext,
  contextStatus: LogInkContextStatus,
  bodyRows: number,
  width: number,
  theme: LogInkTheme
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const focused = state.focus === 'commits'
  const loading = isLogInkContextKeyLoading(contextStatus, 'pullRequest')
  const pullRequestOverview = context.pullRequest
  // Use the dedicated `pullRequest` overview only — the `provider`
  // shape carries a slimmer ProviderPullRequestStatus that lacks
  // url / headRefName / body / mergeable / reviews. The dedicated
  // overview hits `gh pr view --json` with the full enriched field
  // list (PULL_REQUEST_VIEW_JSON_FIELDS) so the panel has everything.
  const pr = pullRequestOverview?.currentPullRequest
  const muted = theme.noColor ? undefined : theme.colors.muted
  const accent = theme.noColor ? undefined : theme.colors.accent

  const containerProps = {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column' as const,
    flexShrink: 0,
    paddingX: 1,
    width,
  }

  if (loading && !pr) {
    return h(Box, containerProps,
      h(Box, { justifyContent: 'space-between' },
        h(Text, { bold: true }, panelTitle('Pull request', focused)),
        h(Text, { dimColor: true }, 'loading')
      ),
      h(Text, { dimColor: true }, formatLogInkLoading({ resource: 'pull request' })))
  }

  if (!pr) {
    const hint = pullRequestOverview?.message
      || 'No pull request detected for this branch. Press `C` (or `:create-pr`) to create one.'
    return h(Box, containerProps,
      h(Box, { justifyContent: 'space-between' },
        h(Text, { bold: true }, panelTitle('Pull request', focused)),
        h(Text, { dimColor: true }, 'no PR')
      ),
      h(Text, { dimColor: true }, truncateCells(hint, width - 4)))
  }

  const checks = summarizePullRequestChecks(pr.statusCheckRollup)
  const reviews = summarizePullRequestReviews(pr.reviews, pr.reviewDecision)
  const checkRows = buildPullRequestCheckRows(pr.statusCheckRollup, { ascii: theme.ascii })
  const checkColor = (s: 'success' | 'failure' | 'pending' | 'neutral' | 'skipped'): string | undefined => {
    if (theme.noColor) return undefined
    if (s === 'success') return theme.colors.success
    if (s === 'failure') return theme.colors.danger
    if (s === 'pending') return theme.colors.warning
    return theme.colors.muted
  }

  // Reserve a few rows for the header/section labels; the rest go to
  // the checks table. Body preview gets the leftover rows so the
  // surface stays vertically balanced even on tall terminals.
  const checkBudget = Math.max(3, Math.min(checkRows.length, Math.floor(bodyRows / 2)))
  const visibleChecks = checkRows.slice(0, checkBudget)
  const truncatedChecks = checkRows.length - visibleChecks.length
  const bodyPreviewBudget = Math.max(2, bodyRows - 8 - visibleChecks.length)
  const bodyLines = (pr.body || '').split(/\r?\n/).filter((line) => line.trim().length > 0)
  const visibleBodyLines = bodyLines.slice(0, bodyPreviewBudget)
  const truncatedBodyLines = bodyLines.length - visibleBodyLines.length

  const headerRight = `#${pr.number} · ${pr.headRefName} → ${pr.baseRefName}`
  const stateLine = formatPullRequestStateLine(pr)
  const author = pr.author ? `by @${pr.author}` : ''

  return h(Box, containerProps,
    h(Box, { justifyContent: 'space-between' },
      h(Text, { bold: true }, panelTitle('Pull request', focused)),
      h(Text, { dimColor: true }, headerRight)
    ),
    h(Text, undefined, truncateCells(pr.title, width - 4)),
    h(Text, { dimColor: true }, truncateCells(`${stateLine}${author ? ` · ${author}` : ''}`, width - 4)),
    h(Text, undefined, ''),

    // Checks section
    h(Text, { bold: true, color: accent }, 'Checks'),
    h(Text, { dimColor: true }, truncateCells(`  ${formatPullRequestChecksSummary(checks, { ascii: theme.ascii })}`, width - 4)),
    ...visibleChecks.map((row, index) => h(Text, {
      key: `pr-check-${index}`,
      color: checkColor(row.status),
    }, truncateCells(`  ${row.glyph} ${row.name.padEnd(28)} ${row.detail}`, width - 4))),
    ...(truncatedChecks > 0
      ? [h(Text, { key: 'pr-checks-trunc', dimColor: true }, truncateCells(`  … ${truncatedChecks} more`, width - 4))]
      : []),
    h(Text, undefined, ''),

    // Reviews section
    h(Text, { bold: true, color: accent }, 'Reviews'),
    h(Text, { dimColor: true }, truncateCells(`  ${formatPullRequestReviewsSummary(reviews)}`, width - 4)),
    h(Text, undefined, ''),

    // Body preview
    ...(visibleBodyLines.length > 0
      ? [
        h(Text, { key: 'pr-body-label', bold: true, color: accent }, 'Description'),
        ...visibleBodyLines.map((line, index) => h(Text, {
          key: `pr-body-${index}`,
          color: muted,
        }, truncateCells(`  ${line}`, width - 4))),
        ...(truncatedBodyLines > 0
          ? [h(Text, { key: 'pr-body-trunc', dimColor: true }, truncateCells(`  … ${truncatedBodyLines} more lines`, width - 4))]
          : []),
      ]
      : []))
}
