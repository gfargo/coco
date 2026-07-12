/**
 * Compose surface — the in-TUI commit-message composer. Combines a
 * summary line, a body field, and a state-line footer; an inline
 * loading indicator + status / details area surfaces results from AI
 * draft generation, commitlint failures, etc.
 *
 * Extracted from `src/workstation/runtime/inkRuntime.ts` as part of phase 5a.2
 * of #890. No behavior change.
 */

import type * as ReactTypes from 'react'
import { isLogInkContextKeyLoading } from '../../chrome/context'
import { pickSpinnerFrame } from '../../chrome/spinner'
import {
  formatStreamingPreview,
  streamingPreviewTruncateMarker,
} from '../../chrome/streamingPreview'
import { formatLogInkComposeEmpty } from '../../chrome/surfaceStates'
import { truncateCells, wrapCells } from '../../chrome/text'
import type { LogInkTheme } from '../../chrome/theme'
import type { LogInkComponents, SurfaceRenderContext } from '../../runtime/types'
import { focusBorderColor, panelTitle } from '../../runtime/utils'

/**
 * Render the streaming-preview block — the trailing lines of the
 * in-flight LLM stream that sit below the loading spinner. Pure
 * formatting; the wrap math + truncation flag live in the
 * `streamingPreview` chrome helper so other surfaces (PR body,
 * review) can reuse them later.
 *
 * Returns an empty array when no preview text is present (the loader
 * just shows the spinner) so the caller's spread doesn't insert blank
 * rows that would shift the state-line.
 */
function renderStreamingPreviewLines(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  preview: string | undefined,
  width: number,
  theme: LogInkTheme,
): ReactTypes.ReactElement[] {
  const { Text } = components
  const view = formatStreamingPreview(preview, width)
  if (view.lines.length === 0) return []
  const marker = view.truncated ? streamingPreviewTruncateMarker(theme.ascii) : ''
  return view.lines.map((line, index) => {
    // Prefix the first line with the truncation marker when earlier
    // content was elided. Subsequent lines render unprefixed.
    const prefix = index === 0 && marker ? `${marker} ` : '  '
    return h(Text, {
      key: `compose-stream-${index}`,
      dimColor: true,
    }, `${prefix}${line}`)
  })
}

export function renderComposeSurface(ctx: SurfaceRenderContext, spinnerFrame: number = 0): ReactTypes.ReactElement {
  const { h, components, state, context, contextStatus, bodyRows, width, theme } = ctx
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
  // Wrap each source line of the body to the panel width so long messages
  // line-wrap inside the compose surface instead of getting trimmed by an
  // outer truncate(line, 140). The 2-space indent eats 2 cells; chrome
  // (border + paddingX) eats 4 — same budget as renderCommitPanel.
  const bodyTextWidth = Math.max(8, width - 6)
  // Summary now renders on its own indented line under the label (like the
  // body), so it wraps at the full content width instead of the cramped
  // "Summary  " (9) + chrome budget it had when label and value shared a row.
  //
  // #1632 — capped and windowed the same way as Body below: an
  // unbounded wrap let a long pasted subject (or over-long AI draft)
  // grow the panel past bodyRows, pushing the state line and footer
  // off-screen. 3 lines is plenty for a subject (the counter already
  // flags anything past 72 chars); one of those rows is spent on the
  // overflow marker once capped, same "pin to the tail while editing"
  // behavior as Body.
  const summaryMaxVisibleLines = 3
  const allSummaryLines = compose.summary
    ? compose.summary.split('\n').flatMap((line) => wrapCells(line, bodyTextWidth))
    : ['<empty>']
  const summaryEditingActive = compose.editing && compose.field === 'summary'
  let summaryVisualLines = allSummaryLines
  let summaryOverflowMarker: { text: string; above: boolean } | undefined
  if (allSummaryLines.length > summaryMaxVisibleLines) {
    const visibleCount = Math.max(1, summaryMaxVisibleLines - 1)
    const hidden = allSummaryLines.length - visibleCount
    const plural = hidden === 1 ? '' : 's'
    if (summaryEditingActive) {
      summaryVisualLines = allSummaryLines.slice(-visibleCount)
      summaryOverflowMarker = {
        text: `${theme.ascii ? '^' : '↑'} ${hidden} earlier line${plural}`,
        above: true,
      }
    } else {
      summaryVisualLines = allSummaryLines.slice(0, visibleCount)
      summaryOverflowMarker = {
        text: `${theme.ascii ? 'v' : '↓'} ${hidden} more line${plural}`,
        above: false,
      }
    }
  }
  // The Body budget below assumes a ~1-line summary (see its own
  // comment); deduct however many EXTRA rows the summary section
  // actually renders (wrapped lines beyond the first, plus the
  // overflow marker row when capped) so the combined sections always
  // fit bodyRows.
  const summaryRenderedRowCount = summaryVisualLines.length + (summaryOverflowMarker ? 1 : 0)
  const summaryExtraRows = Math.max(0, summaryRenderedRowCount - 1)
  const bodyRowsAvailable = Math.max(4, bodyRows - 10 - summaryExtraRows)
  const allBodyLines = compose.body
    ? compose.body.split('\n').flatMap((line) => wrapCells(line, bodyTextWidth))
    : ['<empty>']
  // Long bodies scroll with the insertion point (#1345): editing always
  // appends at the END of the body, so while the body field is being
  // edited the window pins to the tail — otherwise newly typed text
  // landed below the fold with no indication. Outside editing the head
  // slice is kept (reading order), with an explicit overflow marker
  // either way. One row of the budget is spent on the marker so the
  // panel's height math is unchanged.
  const bodyEditingActive = compose.editing && compose.field === 'body'
  let bodyVisualLines = allBodyLines
  let bodyOverflowMarker: { text: string; above: boolean } | undefined
  if (allBodyLines.length > bodyRowsAvailable) {
    const visibleCount = Math.max(1, bodyRowsAvailable - 1)
    const hidden = allBodyLines.length - visibleCount
    const plural = hidden === 1 ? '' : 's'
    if (bodyEditingActive) {
      bodyVisualLines = allBodyLines.slice(-visibleCount)
      bodyOverflowMarker = {
        text: `${theme.ascii ? '^' : '↑'} ${hidden} earlier line${plural}`,
        above: true,
      }
    } else {
      bodyVisualLines = allBodyLines.slice(0, visibleCount)
      bodyOverflowMarker = {
        text: `${theme.ascii ? 'v' : '↓'} ${hidden} more line${plural}`,
        above: false,
      }
    }
  }
  // Subject length drives a subtle counter on the Summary label: dim under
  // 50, warning past the conventional 50-char soft limit, danger past 72.
  // Counted in code points so multibyte subjects aren't over-counted.
  const summaryLength = [...compose.summary].length
  // State-line cycles through three modes (#881 phase 3 added the
  // loading variant): editing copy when the user is typing, cancel
  // hint when an AI draft is generating, default guidance otherwise.
  // The cancel hint also covers the streaming preview window — same
  // keystroke (Esc) aborts whether or not the preview is visible.
  const stateLine = compose.editing
    ? 'Editing — Ctrl+D commits · Enter switches summary↔body · Esc exits edit mode.'
    : compose.loading
      ? 'Generating AI draft — press Esc to cancel.'
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

  // Section header for a field (Summary / Body). The active field's label
  // carries an arrow marker + the repo's selection highlight (matching the
  // status surface, see status/index.ts) so the user can see which field
  // their keystrokes target — even before entering edit mode, and even
  // under NO_COLOR where the marker + bold/dim carry the signal alone. An
  // optional length counter (Summary only) trails the label outside the
  // highlight so its own warning/danger color stays legible.
  const renderSectionHeader = (
    name: string,
    field: typeof compose.field,
    count?: number,
  ): ReactTypes.ReactElement => {
    const active = compose.field === field
    const highlight = active && focused && !theme.noColor
    const marker = active ? (theme.ascii ? '> ' : '▸ ') : '  '
    const badge = active && compose.editing ? '  EDITING' : ''
    const children: ReactTypes.ReactElement[] = [
      h(Text, {
        key: `compose-${field}-label`,
        bold: active,
        dimColor: !active,
        backgroundColor: highlight ? theme.colors.selection : undefined,
        color: highlight ? theme.colors.selectionForeground : undefined,
      }, `${marker}${name}${badge}`),
    ]
    if (count !== undefined) {
      const countColor = theme.noColor
        ? undefined
        : count > 72
          ? theme.colors.danger
          : count > 50
            ? theme.colors.warning
            : undefined
      children.push(h(Text, {
        key: `compose-${field}-count`,
        color: countColor,
        dimColor: countColor === undefined,
      }, ` ${count}`))
    }
    return h(Box, { key: `compose-${field}-header` }, ...children)
  }

  // Content lines for a field — indented two cells under the header, with
  // the edit cursor parked on the final line when this field is active.
  const renderSectionContent = (
    lines: string[],
    field: string,
    cursor: string,
  ): ReactTypes.ReactElement[] =>
    lines.map((line, index) => {
      const isLast = index === lines.length - 1
      return h(Text, {
        key: `compose-${field}-${index}`,
        dimColor: line === '<empty>',
      }, `  ${line}${cursor && isLast ? cursor : ''}`)
    })

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
  renderSectionHeader('Summary', 'summary', summaryLength > 0 ? summaryLength : undefined),
  ...(summaryOverflowMarker?.above
    ? [h(Text, { key: 'compose-summary-overflow-above', dimColor: true }, `  ${summaryOverflowMarker.text}`)]
    : []),
  ...renderSectionContent(summaryVisualLines, 'summary', summaryCursor),
  ...(summaryOverflowMarker && !summaryOverflowMarker.above
    ? [h(Text, { key: 'compose-summary-overflow-below', dimColor: true }, `  ${summaryOverflowMarker.text}`)]
    : []),
  h(Text, undefined, ''),
  renderSectionHeader('Body', 'body'),
  ...(bodyOverflowMarker?.above
    ? [h(Text, { key: 'compose-body-overflow-above', dimColor: true }, `  ${bodyOverflowMarker.text}`)]
    : []),
  ...renderSectionContent(bodyVisualLines, 'body', bodyCursor),
  ...(bodyOverflowMarker && !bodyOverflowMarker.above
    ? [h(Text, { key: 'compose-body-overflow-below', dimColor: true }, `  ${bodyOverflowMarker.text}`)]
    : []),
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
      // Streaming preview (#881 phase 2). Renders the trailing visual
      // lines of the in-flight LLM stream below the loader so the user
      // sees content building up instead of an opaque spinner. Empty
      // before the first chunk arrives; the preview helper returns an
      // empty `lines` array in that window so we skip the block
      // entirely.
      ...renderStreamingPreviewLines(h, components, compose.streamingPreview, bodyTextWidth, theme),
    ]
    : []),
  // Panel-width budget, not a hardcoded 140 (#1390) — long result /
  // detail / hint lines wrapped and pushed the panel past bodyRows.
  ...(compose.message ? [h(Text, undefined, ''), h(Text, { key: 'compose-msg' }, truncateCells(compose.message, Math.max(20, width - 4)))] : []),
  ...(compose.details || []).map((line, index) => h(Text, {
    key: `compose-detail-${index}`,
    dimColor: true,
  }, truncateCells(`  ${line}`, Math.max(20, width - 4)))),
  ...(!hasStagedFiles && noStagedHint
    ? [
      h(Text, { key: 'compose-no-staged-spacer' }, ''),
      h(Text, { key: 'compose-no-staged', dimColor: true }, truncateCells(noStagedHint, Math.max(20, width - 4))),
    ]
    : []),
  h(Box, { flexGrow: 1 }),
  h(Text, { key: 'compose-stateline', dimColor: true }, truncateCells(stateLine, width - 4)))
}
