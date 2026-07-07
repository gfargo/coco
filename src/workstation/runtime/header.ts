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
 * Extracted from `src/workstation/runtime/inkRuntime.ts` as part of phase
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
import { cellWidth, truncateCells } from '../chrome/text'
import type { LogInkTheme } from '../chrome/theme'
import {
    combineLogInkBreadcrumbSegments,
    formatLogInkBreadcrumb,
    formatLogInkRepoBreadcrumb,
} from '../../workstation/runtime/inkKeymap'
import { useLogInkRuntime } from './runtimeContext'
import type { LogInkComponents } from './types'

/**
 * Props the header still receives explicitly. Everything else
 * (`state` / `context` / `theme` / `layout.columns`) now comes from the
 * runtime context via `useLogInkRuntime`; only these two values aren't
 * carried on that context value, so they stay props.
 */
export type LogInkHeaderProps = {
  contextStatus: LogInkContextStatus
  appLabel: string
}

/**
 * Factory for the header surface component, mirroring the
 * `getLogInkRuntimeContext(React)` convention: the workstation never
 * statically imports React, so the component must be built from the same
 * runtime React instance that renders the tree (and that the context
 * provider is bound to). `h` / `components` are closed over so the
 * component body keeps using the exact rendering primitives the old
 * `renderHeader` function received.
 *
 * The returned component is the first real consumer of
 * `LogInkRuntimeContext` (#1136): it reads `state` / `context` / `theme`
 * / `layout` from the hook instead of receiving them as positional props.
 * `React.memo` keeps the re-render behavior identical to the previous
 * render-function call — the wrapping tree re-renders every frame, so the
 * header element is rebuilt every frame just as before.
 *
 * Callers must create this once with a stable identity (e.g. a
 * render-scope `useMemo` or a module cache); calling the factory inline
 * each render would remount the subtree.
 */
export function createLogInkHeader(
  React: typeof ReactTypes,
  h: typeof ReactTypes.createElement,
  components: LogInkComponents
): ReactTypes.NamedExoticComponent<LogInkHeaderProps> {
  const { Box, Text } = components

  return React.memo(function LogInkHeader(props: LogInkHeaderProps): ReactTypes.ReactElement {
    const { state, context, theme, layout } = useLogInkRuntime(React)
    const { contextStatus, appLabel } = props
    const columns = layout.columns

    // Pull the source state into the small "describe what to render"
    // shape the chip builder expects. Keeps the runtime decoupled from
    // the chip layout — the builder doesn't know about LogInkState /
    // LogInkContext, just plain values.
    const branch = context.branches?.currentBranch || context.provider?.currentBranch || '<detached>'
    const dirty = Boolean(context.branches?.dirty)
    const bisecting = Boolean(context.bisect?.active)
    // In-progress merge-machinery operation (#1360) — 'none' collapses
    // to undefined so the chip builder's omit-when-absent rule applies.
    const operation = context.operation?.operation && context.operation.operation !== 'none'
      ? context.operation.operation
      : undefined
    const operationConflicts = context.operation?.conflictedFiles?.length ?? 0
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
      operation,
      operationConflicts,
      pullRequest: prInfo ? {
        number: prInfo.number,
        state: prInfo.state,
        isDraft: prInfo.isDraft,
      } : undefined,
      forge: context.provider?.repository.provider,
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
  })
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
 * Fallback path for narrow terminals. Drops the lowest-priority chips
 * first until the remaining ones fit the budget, then renders them as
 * a single truncated string (#1368 item 5). Mode and search never drop;
 * low-value chips (loading, clean state, app name) drop first.
 */
function renderFallback(
  h: typeof ReactTypes.createElement,
  Text: LogInkComponents['Text'],
  chips: ReadonlyArray<HeaderChip>,
  theme: LogInkTheme,
  budget: number
): ReactTypes.ReactNode {
  // Sort candidates by priority (ascending) so we can drop from the front.
  const sorted = [...chips].sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50))
  let kept = [...chips]
  let joined = kept.map((chip) => chip.label).join(HEADER_CHIP_SEPARATOR)

  // Progressively drop the lowest-priority chip until it fits.
  let dropIndex = 0
  while (cellWidth(joined) > budget && dropIndex < sorted.length) {
    const toDrop = sorted[dropIndex]
    kept = kept.filter((chip) => chip !== toDrop)
    joined = kept.map((chip) => chip.label).join(HEADER_CHIP_SEPARATOR)
    dropIndex++
  }

  return h(Text, { bold: true, color: theme.colors.accent }, truncateCells(joined, budget))
}
