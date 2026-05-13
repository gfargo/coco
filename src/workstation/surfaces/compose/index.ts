/**
 * Compose surface — the in-TUI commit-message composer. Combines a
 * summary line, a body field, and a state-line footer; an inline
 * loading indicator + status / details area surfaces results from AI
 * draft generation, commitlint failures, etc.
 *
 * Extracted from `src/commands/log/inkRuntime.ts` as part of phase 5a.2
 * of #890. No behavior change.
 */

import type * as ReactTypes from 'react'
import type { LogInkContextStatus } from '../../chrome/context'
import { isLogInkContextKeyLoading } from '../../chrome/context'
import { pickSpinnerFrame } from '../../chrome/spinner'
import { formatLogInkComposeEmpty } from '../../chrome/surfaceStates'
import { truncateCells, wrapCells } from '../../chrome/text'
import type { LogInkTheme } from '../../chrome/theme'
import type { LogInkState } from '../../../commands/log/inkViewModel'
import type { LogInkComponents, LogInkContext } from '../../runtime/types'
import { focusBorderColor, panelTitle } from '../../runtime/utils'

export function renderComposeSurface(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  context: LogInkContext,
  contextStatus: LogInkContextStatus,
  bodyRows: number,
  width: number,
  theme: LogInkTheme,
  spinnerFrame: number = 0
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const compose = state.commitCompose
  const focused = state.focus === 'commits'
  const worktree = context.worktree
  const statusLine = isLogInkContextKeyLoading(contextStatus, 'worktree')
    ? 'Status loading'
    : worktree
      ? `${worktree.stagedCount} staged | ${worktree.unstagedCount} unstaged | ${worktree.untrackedCount} untracked`
      : 'No worktree info yet'
  const summaryCursor = compose.editing && compose.field === 'summary' ? '_' : ''
  const bodyCursor = compose.editing && compose.field === 'body' ? '_' : ''
  const bodyRowsAvailable = Math.max(4, bodyRows - 10)
  // Wrap each source line of the body to the panel width so long messages
  // line-wrap inside the compose surface instead of getting trimmed by an
  // outer truncate(line, 140). The 2-space indent eats 2 cells; chrome
  // (border + paddingX) eats 4 — same budget as renderCommitPanel.
  const bodyTextWidth = Math.max(8, width - 6)
  const bodyVisualLines = compose.body
    ? compose.body.split('\n').flatMap((line) => wrapCells(line, bodyTextWidth)).slice(0, bodyRowsAvailable)
    : ['<empty>']
  const summaryVisualLines = wrapCells(
    `${compose.summary || '<empty>'}${summaryCursor}`,
    Math.max(8, width - 11) // "Summary  " (9) + 2 chrome = 11
  )
  const stateLine = compose.editing
    ? 'Editing — Enter switches summary↔body, Esc exits edit mode.'
    : 'Press e to edit, c to commit, I for AI draft, esc to leave.'
  const hasStagedFiles = (worktree?.files || [])
    .some((file) => file.indexStatus !== ' ' && file.indexStatus !== '?')
  // Staged file list is rendered in the right Worktree panel
  // (renderComposeContextPanel); duplicating it here was confusing.
  // Keep only the actionable "stage something first" hint when nothing is
  // staged yet.
  const noStagedHint = !isLogInkContextKeyLoading(contextStatus, 'worktree')
    ? formatLogInkComposeEmpty({ hasStaged: hasStagedFiles })
    : undefined

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    flexShrink: 0,
    paddingX: 1,
    width,
  },
  h(Box, { justifyContent: 'space-between' },
    h(Text, { bold: true }, panelTitle('Compose commit', focused)),
    h(Text, { dimColor: true }, statusLine)
  ),
  h(Text, undefined, ''),
  h(Text, {
    bold: compose.field === 'summary' && compose.editing,
  }, `Summary  ${summaryVisualLines[0] || ''}`),
  ...summaryVisualLines.slice(1).map((line, index) => h(Text, {
    key: `compose-summary-${index}`,
    bold: compose.field === 'summary' && compose.editing,
  }, `         ${line}`)),
  h(Text, undefined, ''),
  h(Text, {
    bold: compose.field === 'body' && compose.editing,
  }, 'Body'),
  ...bodyVisualLines.map((line, index) => {
    const isLast = index === bodyVisualLines.length - 1
    return h(Text, {
      key: `compose-body-${index}`,
      dimColor: line === '<empty>',
    }, `  ${line}${bodyCursor && isLast ? bodyCursor : ''}`)
  }),
  // Loading indicator + post-action message belong inline with the draft
  // (they describe what just happened to the fields above). The state-
  // line ("Editing — Enter switches summary↔body…" / "Press e to edit
  // …") is footer-style guidance and now sits at the very bottom of the
  // pane so it doesn't visually separate the body from any
  // result/details.
  ...(compose.loading
    ? [
      h(Text, undefined, ''),
      h(Text, {
        key: 'compose-loading',
        bold: true,
        color: theme.noColor ? undefined : theme.colors.accent,
      }, theme.ascii
        ? `[${pickSpinnerFrame(spinnerFrame).replace(/[^a-zA-Z0-9 ]/g, '.')}] Generating AI commit draft (this can take a moment)`
        : `${pickSpinnerFrame(spinnerFrame)}  Generating AI commit draft… (this can take a moment)`),
    ]
    : []),
  ...(compose.message ? [h(Text, undefined, ''), h(Text, { key: 'compose-msg' }, truncateCells(compose.message, 140))] : []),
  ...(compose.details || []).map((line, index) => h(Text, {
    key: `compose-detail-${index}`,
    dimColor: true,
  }, truncateCells(`  ${line}`, 140))),
  ...(!hasStagedFiles && noStagedHint
    ? [
      h(Text, { key: 'compose-no-staged-spacer' }, ''),
      h(Text, { key: 'compose-no-staged', dimColor: true }, truncateCells(noStagedHint, 140)),
    ]
    : []),
  h(Box, { flexGrow: 1 }),
  h(Text, { key: 'compose-stateline', dimColor: true }, truncateCells(stateLine, width - 4)))
}
