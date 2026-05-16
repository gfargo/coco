/**
 * Title-bar renderer. Surfaces:
 *   - the app label (e.g. "coco ui")
 *   - current repo owner/name (or "local repository")
 *   - current branch + dirty / BISECTING flag
 *   - PR glyph + label when one is detected
 *   - breadcrumb of the view stack
 *   - loading hint for boot / context fetches
 *   - mode indicator: [NORMAL] / [EDIT] / [FILTER]
 *   - active filter / search input
 *
 * Truncation: when the assembled title overruns the available columns we
 * fall back to a single-fragment Text (truncating the joined string) so
 * the ellipsis can't land mid-glyph. The split-fragment path keeps the PR
 * glyph in its own colored span when there's headroom.
 *
 * Extracted from `src/commands/log/inkRuntime.ts` as part of phase 5a.7
 * of #890. No behavior change.
 */

import type * as ReactTypes from 'react'
import type { LogInkContextStatus } from '../chrome/context'
import { isLogInkContextLoading } from '../chrome/context'
import { getPullRequestStateGlyph } from '../chrome/iconography'
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
  const branch = context.branches?.currentBranch || context.provider?.currentBranch || '<detached>'
  // #784 — surface bisect-in-progress in the title bar so users entering
  // the TUI mid-bisect see it immediately, before they navigate to gB.
  const dirtyBase = context.branches?.dirty ? 'dirty' : 'clean'
  const dirty = context.bisect?.active ? `${dirtyBase} · BISECTING` : dirtyBase
  const repo = context.provider?.repository.owner && context.provider.repository.name
    ? `${context.provider.repository.owner}/${context.provider.repository.name}`
    : 'local repository'
  const prInfo = context.provider?.currentPullRequest || context.pullRequest?.currentPullRequest
  const prGlyph = prInfo ? getPullRequestStateGlyph(prInfo, theme) : null
  const prLabel = prInfo
    ? `PR #${prInfo.number} ${prInfo.isDraft ? 'DRAFT' : prInfo.state}`
    : 'no PR'
  const search = state.filterMode ? `search: ${state.filter}_` : state.filter ? `filter: ${state.filter}` : ''
  // Boot loading wins over the per-context loading hint because it
  // tells the user the headline thing they care about (commits aren't
  // ready yet) — the context fetches finish independently and surface
  // their own per-section loading copy in the sidebars.
  const loading = state.bootLoading
    ? '  loading commits'
    : isLogInkContextLoading(contextStatus) ? '  loading context' : ''
  const breadcrumb = formatLogInkBreadcrumb(state.viewStack)
  const repoCrumb = formatLogInkRepoBreadcrumb(state.repoStack)
  // Repo breadcrumb (when nested) comes first so the user sees which
  // submodule they're in at a glance, then the view breadcrumb (when
  // pushed deeper than the root view). The truncate fallback in the
  // title row still applies — when both fight for space, the ellipsis
  // lands at the end of whichever segment overflows.
  const view = combineLogInkBreadcrumbSegments(repoCrumb, breadcrumb)
  // Mode indicator (P2.2) — surfaces the current input mode so users
  // never wonder why `q` doesn't quit while they're editing or filtering.
  const mode = state.commitCompose.editing
    ? '[EDIT]'
    : state.filterMode
      ? '[FILTER]'
      : '[NORMAL]'
  const titlePrefix = `${appLabel}  ${repo}  ${branch}  ${dirty}  `
  const glyphPart = prGlyph?.glyph ? `${prGlyph.glyph} ` : ''
  const titleSuffix = `${view}${loading}`
  const fullTitle = `${titlePrefix}${glyphPart}${prLabel}${titleSuffix}`
  const titleBudget = columns - mode.length - 4
  const truncatedTitle = truncateCells(fullTitle, titleBudget)
  // Only split into colored fragments when the prefix + glyph + label all
  // fit unmodified — otherwise the truncate ellipsis can land mid-fragment
  // and we'd render half a glyph in the wrong color.
  const splitFragments = truncatedTitle === fullTitle && glyphPart.length > 0
  const modeColor = theme.noColor
    ? undefined
    : state.filterMode || state.commitCompose.editing
      ? theme.colors.warning
      : theme.colors.accent

  return h(Box, {
    borderColor: theme.colors.border,
    borderStyle: theme.borderStyle,
    height: 3,
    paddingX: 1,
  },
  splitFragments
    ? h(Text, { bold: true, color: theme.colors.accent }, titlePrefix)
    : h(Text, { bold: true, color: theme.colors.accent }, truncatedTitle),
  splitFragments
    ? h(Text, { bold: true, color: prGlyph?.color, dimColor: prGlyph?.dim }, glyphPart)
    : undefined,
  splitFragments
    ? h(Text, { bold: true, color: theme.colors.accent }, `${prLabel}${titleSuffix}`)
    : undefined,
  h(Text, { bold: true, color: modeColor }, `  ${mode}`),
  search ? h(Text, { dimColor: true }, `  ${truncateCells(search, 36)}`) : undefined)
}
