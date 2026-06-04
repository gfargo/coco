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
  const bodyRowsAvailable = Math.max(4, bodyRows - 10)
  // Wrap each source line of the body to the panel width so long messages
  // line-wrap inside the compose surface instead of getting trimmed by an
  // outer truncate(line, 140). The 2-space indent eats 2 cells; chrome
  // (border + paddingX) eats 4 — same budget as renderCommitPanel.
  const bodyTextWidth = Math.max(8, width - 6)
  const bodyVisualLines = compose.body
    ? compose.body.split('\n').flatMap((line) => wrapCells(line, bodyTextWidth)).slice(0, bodyRowsAvailable)
    : ['<empty>']
  // Summary now renders on its own indented line under the label (like the
  // body), so it wraps at the full content width instead of the cramped
  // "Summary  " (9) + chrome budget it had when label and value shared a row.
  const summaryVisualLines = compose.summary
    ? compose.summary.split('\n').flatMap((line) => wrapCells(line, bodyTextWidth))
    : ['<empty>']
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
    ? 'Editing — Enter switches summary↔body, Esc exits edit mode.'
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
  ...renderSectionContent(summaryVisualLines, 'summary', summaryCursor),
  h(Text, undefined, ''),
  renderSectionHeader('Body', 'body'),
  ...renderSectionContent(bodyVisualLines, 'body', bodyCursor),
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
