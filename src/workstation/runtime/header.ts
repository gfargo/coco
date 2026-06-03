/**
 * Title-bar renderer. Surfaces the workstation's identity + navigation
 * state as a row of small visually-distinct chips:
 *
 *   coco · gfargo/coco · ⎇ main · ✓ clean · [NORMAL]
 *
 * The PR chip is appended only when a pull request exists (e.g.
 * `· ⊠ PR #1234 OPEN`); there's no "no PR" placeholder chip.
 *
 * Per-chip color/glyph treatment lets the user scan in chunks ("what
 * app, what repo, what branch, how clean, what PR state, what mode")
 * instead of parsing one long sentence. Chip construction is in
 * `chrome/headerChips.ts`; this runtime just renders.
 *
 * Truncation: when the assembled chip row overruns the available
 * columns we fall back to a single Text fragment (truncating the
 * joined chip labels) so the ellipsis can't land mid-glyph. This is
 * the same defensive pattern the pre-redesign single-fragment code
 * used, applied at the chip-list level instead of the inline glyph
 * split.
 *
 * Extracted from `src/commands/log/inkRuntime.ts` as part of phase
 * 5a.7 of #890. Chip restructuring introduced post-0.54.2.
 */

import type * as ReactTypes from 'react'
import type { LogInkContextStatus } from '../chrome/context'
import { isLogInkContextLoading } from '../chrome/context'
import {
  HEADER_CHIP_SEPARATOR,
  buildHeaderChips,
  measureHeaderChipsWidth,
  type HeaderChip,
} from '../chrome/headerChips'
import { truncateCells } from '../chrome/text'
import type { LogInkTheme } from '../chrome/theme'
import {
  combineLogInkBreadcrumbSegments,
  formatLogInkBreadcrumb,
  formatLogInkRepoBreadcrumb,
} from '../../commands/log/inkKeymap'
import type { LogInkState } from '../../commands/log/inkViewModel'
import type { LogInkComponents, LogInkContext } from './types'

export function renderHeader(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  context: LogInkContext,
  contextStatus: LogInkContextStatus,
  columns: number,
  theme: LogInkTheme,
  appLabel: string
): ReactTypes.ReactElement {
  const { Box, Text } = components

  // Pull the source state into the small "describe what to render"
  // shape the chip builder expects. Keeps the runtime decoupled from
  // the chip layout — the builder doesn't know about LogInkState /
  // LogInkContext, just plain values.
  const branch = context.branches?.currentBranch || context.provider?.currentBranch || '<detached>'
  const dirty = Boolean(context.branches?.dirty)
  const bisecting = Boolean(context.bisect?.active)
  const repo = context.provider?.repository.owner && context.provider.repository.name
    ? `${context.provider.repository.owner}/${context.provider.repository.name}`
    : 'local repository'
  const prInfo = context.provider?.currentPullRequest || context.pullRequest?.currentPullRequest
  // Boot loading wins over the per-context loading hint — same
  // priority as pre-redesign. Context fetches still surface their own
  // copy in the sidebars.
  const loading = state.bootLoading
    ? 'loading commits'
    : isLogInkContextLoading(contextStatus) ? 'loading context' : ''
  const breadcrumb = formatLogInkBreadcrumb(state.viewStack)
  const repoCrumb = formatLogInkRepoBreadcrumb(state.repoStack)
  const view = combineLogInkBreadcrumbSegments(repoCrumb, breadcrumb)
  const mode: 'NORMAL' | 'EDIT' | 'FILTER' = state.commitCompose.editing
    ? 'EDIT'
    : state.filterMode
      ? 'FILTER'
      : 'NORMAL'
  const search = state.filterMode
    ? `search: ${state.filter}_`
    : state.filter
      ? `filter: ${state.filter}`
      : ''

  const chips = buildHeaderChips({
    appLabel,
    repo,
    branch,
    dirty,
    bisecting,
    pullRequest: prInfo ? {
      number: prInfo.number,
      state: prInfo.state,
      isDraft: prInfo.isDraft,
    } : undefined,
    breadcrumb: view,
    loading,
    mode,
    search: search ? truncateCells(search, 36) : '',
    theme,
  })

  // Truncation budget. Header line gets the full terminal width minus
  // the box's horizontal padding (2 cells) and a small safety margin.
  const budget = Math.max(0, columns - 4)
  const chipsWidth = measureHeaderChipsWidth(chips)

  return h(Box, {
    borderColor: theme.colors.border,
    borderStyle: theme.borderStyle,
    height: 3,
    paddingX: 1,
  },
  chipsWidth <= budget
    ? renderChipRow(h, Text, chips)
    : renderFallback(h, Text, chips, theme, budget))
}

/**
 * Render every chip as its own Text span with its own color/style,
 * interleaved with dim separator spans. This is the path used when
 * everything fits — the eye gets the full chip treatment.
 */
function renderChipRow(
  h: typeof ReactTypes.createElement,
  Text: LogInkComponents['Text'],
  chips: ReadonlyArray<HeaderChip>
): ReactTypes.ReactNode {
  const nodes: ReactTypes.ReactNode[] = []
  chips.forEach((chip, index) => {
    if (index > 0) {
      // Separator is intentionally dim so the eye can use it as a
      // visual delimiter without it competing with chip labels for
      // attention.
      nodes.push(h(Text, { key: `sep-${index}`, dimColor: true }, HEADER_CHIP_SEPARATOR))
    }
    nodes.push(h(Text, {
      key: chip.id,
      color: chip.color,
      dimColor: chip.dim,
      bold: chip.bold,
    }, chip.label))
  })
  return nodes
}

/**
 * Fallback path for narrow terminals. Concatenates every chip label
 * with separators, then truncates the whole string with
 * `truncateCells` so the ellipsis lands at a cell boundary. Loses the
 * per-chip color treatment in exchange for guaranteed legibility on
 * narrow displays — the same trade-off the pre-redesign single-
 * fragment code made for its inline glyph color split.
 */
function renderFallback(
  h: typeof ReactTypes.createElement,
  Text: LogInkComponents['Text'],
  chips: ReadonlyArray<HeaderChip>,
  theme: LogInkTheme,
  budget: number
): ReactTypes.ReactNode {
  const joined = chips.map((chip) => chip.label).join(HEADER_CHIP_SEPARATOR)
  return h(Text, { bold: true, color: theme.colors.accent }, truncateCells(joined, budget))
}
