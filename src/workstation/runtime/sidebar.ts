/**
 * Sidebar renderer + accordion-tab content. Renders the left rail with
 * tab headers and the active tab's body content. Tabs:
 *   - Status   — counts + worktree file list
 *   - Branches — current / dirty + selectable branch list
 *   - Tags     — selectable tag list
 *   - Stashes  — selectable stash list
 *   - Worktrees — selectable worktree list
 *
 * Tab selection (`1`-`5` / `[`-`]`) is wired in inkInput.ts; this
 * renderer is read-only and assumes the active tab from `state.sidebarTab`.
 *
 * Extracted from `src/commands/log/inkRuntime.ts` as part of phase 5a.7
 * of #890. No behavior change.
 */

import type * as ReactTypes from 'react'
import type { LogInkContextStatus } from '../chrome/context'
import { isLogInkContextKeyLoading } from '../chrome/context'
import { branchRowMarker, sidebarTabCount } from '../chrome/iconography'
import { getSidebarVisibleWindow } from '../chrome/sidebarSelection'
import { sortBranches, sortTags } from '../chrome/sorting'
import { inlineSpinnerGlyph } from '../chrome/spinner'
import { cellWidth, truncateCells, truncatePathCells } from '../chrome/text'
import type { LogInkTheme } from '../chrome/theme'
import type {
  LogInkSidebarTab,
  LogInkState,
} from '../../commands/log/inkViewModel'
import { getLogInkSidebarTabs, isPendingItemAction } from '../../commands/log/inkViewModel'
import type { LogInkComponents, LogInkContext } from './types'
import { focusBorderColor, panelTitle, sidebarTabLabel } from './utils'

/**
 * Render a sliding-window list of selectable sidebar rows. The cursor
 * highlights the row at `selectedIndex` only when `focused` is true so
 * an unfocused sidebar doesn't compete visually with the active panel.
 * Sliding window keeps the cursor in view as the user navigates a long
 * list; truncation hints surface the count of hidden rows.
 */
function renderSelectableSidebarRows<T>(
  h: typeof ReactTypes.createElement,
  Text: LogInkComponents['Text'],
  items: T[],
  selectedIndex: number,
  focused: boolean,
  width: number,
  theme: LogInkTheme,
  toRowText: (item: T, index: number) => string,
  keyPrefix: string,
  visibleCount?: number,
): ReactTypes.ReactElement[] {
  if (items.length === 0) return []

  const window = getSidebarVisibleWindow(items.length, selectedIndex, visibleCount)
  const elements: ReactTypes.ReactElement[] = []

  if (window.truncatedAbove > 0) {
    elements.push(h(Text, {
      key: `${keyPrefix}-trunc-above`,
      dimColor: true,
    }, truncateCells(`  … ${window.truncatedAbove} more above`, width - 4)))
  }

  for (let offset = 0; offset < window.size; offset += 1) {
    const index = window.start + offset
    if (index >= items.length) break
    const isSelected = focused && index === selectedIndex
    const text = toRowText(items[index], index)
    elements.push(h(Text, {
      key: `${keyPrefix}-row-${index}`,
      backgroundColor: isSelected && !theme.noColor ? theme.colors.selection : undefined,
      inverse: isSelected,
    }, truncateCells(`  ${text}`, width - 4)))
  }

  if (window.truncatedBelow > 0) {
    elements.push(h(Text, {
      key: `${keyPrefix}-trunc-below`,
      dimColor: true,
    }, truncateCells(`  … ${window.truncatedBelow} more below`, width - 4)))
  }

  return elements
}

function renderActiveStatusTabContent(
  h: typeof ReactTypes.createElement,
  Text: LogInkComponents['Text'],
  context: LogInkContext,
  contextStatus: LogInkContextStatus,
  width: number,
  theme: LogInkTheme
): ReactTypes.ReactElement[] {
  if (isLogInkContextKeyLoading(contextStatus, 'worktree')) {
    return [h(Text, { key: 'tab-status-loading', dimColor: true }, '  Loading status…')]
  }
  const worktree = context.worktree
  if (!worktree) {
    return [h(Text, { key: 'tab-status-empty', dimColor: true }, '  Status unavailable')]
  }
  const colorOf = (state: 'staged' | 'unstaged' | 'untracked'): string | undefined => {
    if (theme.noColor) return undefined
    if (state === 'staged') return theme.colors.warning
    if (state === 'unstaged') return theme.colors.danger
    return theme.colors.muted
  }
  const summaryRow = (count: number, label: string, key: string, kind: 'staged' | 'unstaged' | 'untracked') =>
    h(Text, { key }, '  ', h(Text, { color: colorOf(kind), bold: count > 0 }, `${count} ${label}`))
  const fileRows = worktree.files.slice(0, 12).map((file, index) => {
    const codes = `${file.indexStatus}${file.worktreeStatus}`
    // Smart path truncation: keep the leading status codes and elide
    // middle directory segments to preserve the filename. Falls back
    // to plain truncation when the codes + a meaningful filename
    // don't both fit. Same shape as the detail surface so all the
    // status-row renderings elide consistently.
    const prefix = `  ${codes} `
    const totalBudget = width - 4
    const pathBudget = totalBudget - cellWidth(prefix)
    const label = pathBudget >= 8
      ? `${prefix}${truncatePathCells(file.path, pathBudget)}`
      : truncateCells(`${prefix}${file.path}`, totalBudget)
    return h(Text, {
      key: `tab-status-file-${index}`,
      color: colorOf(file.state),
    }, label)
  })
  return [
    summaryRow(worktree.stagedCount, 'staged', 'tab-status-staged', 'staged'),
    summaryRow(worktree.unstagedCount, 'unstaged', 'tab-status-unstaged', 'unstaged'),
    summaryRow(worktree.untrackedCount, 'untracked', 'tab-status-untracked', 'untracked'),
    ...(fileRows.length
      ? [h(Text, { key: 'tab-status-spacer' }, ''), ...fileRows]
      : []),
  ]
}

/**
 * Render the indented body of the active sidebar tab. The status tab
 * colours its summary counts (warning / danger / muted) and per-file
 * rows so they read as the same severity scale used in the main status
 * surface; every other tab falls through to selectable rows.
 */
function renderActiveSidebarContent(
  h: typeof ReactTypes.createElement,
  Text: LogInkComponents['Text'],
  tab: LogInkSidebarTab,
  state: LogInkState,
  context: LogInkContext,
  contextStatus: LogInkContextStatus,
  width: number,
  bodyRows: number,
  theme: LogInkTheme,
  spinnerFrame: number
): ReactTypes.ReactElement[] {
  // Inline pending-delete glyph: while a row's delete is in flight it
  // shows this spinner in place of its leading marker (branches /
  // worktrees) or appended to the row (tags / stashes, which have no
  // leading status icon). `pending` is the single in-flight target.
  const pending = state.pendingItemAction
  const spin = inlineSpinnerGlyph(spinnerFrame, theme.ascii)
  // Available rows for the active tab's list. The sidebar chrome
  // takes ~10 rows (panel title + spacer + 5 tab headers + 4 inter-tab
  // spacers); the branches tab eats 3 more for its summary header
  // (Current / Worktree / spacer). Floor of 8 keeps short terminals
  // usable; tall terminals (40+ rows) get noticeably more items.
  const sidebarChrome = 10
  const branchHeaderRows = tab === 'branches' ? 3 : 0
  const visibleListCount = Math.max(8, bodyRows - sidebarChrome - branchHeaderRows)
  if (tab === 'status') {
    return renderActiveStatusTabContent(h, Text, context, contextStatus, width, theme)
  }

  // Branches / tags / stashes / worktrees: render selectable rows so
  // ↑/↓ navigates within the sidebar list and Enter / per-entity keys
  // act on the cursored item without needing to drill into the
  // dedicated view (#791 follow-up — in-sidebar selection).
  // Items render with the cursor highlight only when the sidebar is
  // focused on this tab AND the cursor is on items (not promoted to
  // the tab header). The header-focused branch up in `renderSidebar`
  // owns the highlight in that case.
  const focused = state.focus === 'sidebar' && state.sidebarTab === tab && !state.sidebarHeaderFocused

  if (tab === 'branches') {
    if (isLogInkContextKeyLoading(contextStatus, 'branches')) {
      return [h(Text, { key: 'tab-branches-loading', dimColor: true }, '  Loading branches…')]
    }
    const branches = context.branches
    if (!branches) {
      return [h(Text, { key: 'tab-branches-empty', dimColor: true }, '  Branches unavailable')]
    }
    const sortedBranches = sortBranches(branches.localBranches, state.branchSort)
    const headerRows: ReactTypes.ReactElement[] = [
      h(Text, { key: 'tab-branches-current', dimColor: true },
        truncateCells(`  Current: ${branches.currentBranch || '<detached>'}`, width - 4)),
      h(Text, { key: 'tab-branches-state', dimColor: true },
        `  Worktree: ${branches.dirty ? 'dirty' : 'clean'}`),
      h(Text, { key: 'tab-branches-spacer' }, ''),
    ]
    return [
      ...headerRows,
      ...renderSelectableSidebarRows(
        h, Text, sortedBranches, state.selectedBranchIndex, focused, width, theme,
        (branch) => {
          const glyph = isPendingItemAction(pending, 'branch', branch.shortName)
            ? spin
            : branchRowMarker(branch, { ascii: theme.ascii }).glyph
          return `${glyph} ${branch.shortName}`
        },
        'tab-branches', visibleListCount,
      ),
    ]
  }

  if (tab === 'tags') {
    if (isLogInkContextKeyLoading(contextStatus, 'tags')) {
      return [h(Text, { key: 'tab-tags-loading', dimColor: true }, '  Loading tags…')]
    }
    const tags = sortTags(context.tags?.tags || [], state.tagSort)
    if (tags.length === 0) {
      return [h(Text, { key: 'tab-tags-empty', dimColor: true }, '  No tags found')]
    }
    return renderSelectableSidebarRows(
      h, Text, tags, state.selectedTagIndex, focused, width, theme,
      (tag) => {
        const base = `${truncateCells(tag.name, 16)} ${tag.subject}`
        // Tags have no leading status icon, so the pending spinner is
        // appended to the row instead of replacing a glyph.
        return isPendingItemAction(pending, 'tag', tag.name) ? `${base} ${spin}` : base
      },
      'tab-tags', visibleListCount,
    )
  }

  if (tab === 'stashes') {
    if (isLogInkContextKeyLoading(contextStatus, 'stashes')) {
      return [h(Text, { key: 'tab-stashes-loading', dimColor: true }, '  Loading stashes…')]
    }
    const stashes = context.stashes?.stashes || []
    if (stashes.length === 0) {
      return [h(Text, { key: 'tab-stashes-empty', dimColor: true }, '  No stashes found')]
    }
    return renderSelectableSidebarRows(
      h, Text, stashes, state.selectedStashIndex, focused, width, theme,
      (stash, index) => {
        const base = `@{${index}} ${stash.message || '(no message)'}`
        // `@{N}` is the stash ref, not a status icon, so append the
        // spinner rather than replacing it.
        return isPendingItemAction(pending, 'stash', stash.ref) ? `${base} ${spin}` : base
      },
      'tab-stashes', visibleListCount,
    )
  }

  // worktrees
  if (isLogInkContextKeyLoading(contextStatus, 'worktreeList')) {
    return [h(Text, { key: 'tab-worktrees-loading', dimColor: true }, '  Loading worktrees…')]
  }
  const worktrees = context.worktreeList?.worktrees || []
  if (worktrees.length === 0) {
    return [h(Text, { key: 'tab-worktrees-empty', dimColor: true }, '  No linked worktrees')]
  }
  return renderSelectableSidebarRows(
    h, Text, worktrees, state.selectedWorktreeListIndex, focused, width, theme,
    (worktree) => {
      const marker = isPendingItemAction(pending, 'worktree', worktree.path)
        ? spin
        : worktree.current ? '*' : ' '
      const wstate = worktree.dirty ? 'dirty' : 'clean'
      return `${marker} ${worktree.branch || worktree.path} ${wstate}`
    },
    'tab-worktrees', visibleListCount,
  )
}

export function renderSidebar(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  context: LogInkContext,
  contextStatus: LogInkContextStatus,
  width: number,
  bodyRows: number,
  theme: LogInkTheme,
  spinnerFrame: number = 0
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const focused = state.focus === 'sidebar'
  const tabs = getLogInkSidebarTabs()

  // Accordion layout — every tab's title is visible on its own line, but
  // only the active tab expands its content underneath. Switching tabs
  // (1-5 / [/]) collapses the previous and expands the next.
  // When sidebar focus has been promoted to the tab header (#806
  // follow-up), the active tab's title row gets selection styling
  // and the items below it render without their cursor highlight
  // (which now lives on the header).
  const headerFocused = focused && state.sidebarHeaderFocused
  const tabBlocks = tabs.flatMap((tab, tabIndex) => {
    const isActive = tab === state.sidebarTab
    const count = sidebarTabCount(tab, context)
    const labelWithCount = count !== undefined
      ? `${sidebarTabLabel(tab)} (${count})`
      : sidebarTabLabel(tab)
    const headerText = isActive ? `[${labelWithCount}]` : labelWithCount
    const headerSelected = isActive && headerFocused
    const blocks: ReactTypes.ReactElement[] = []
    if (tabIndex > 0) {
      blocks.push(h(Text, { key: `tab-spacer-${tab}` }, ''))
    }
    blocks.push(h(Text, {
      key: `tab-header-${tab}`,
      bold: isActive,
      dimColor: !isActive,
      // Selection styling on the header itself when the cursor has
      // been promoted off the items list. inverse swaps fg/bg so the
      // highlight reads as "this is the cursor target" identically
      // to how items render when focused.
      backgroundColor: headerSelected && !theme.noColor ? theme.colors.selection : undefined,
      inverse: headerSelected,
    }, headerText))
    if (isActive) {
      blocks.push(...renderActiveSidebarContent(h, Text, tab, state, context, contextStatus, width, bodyRows, theme, spinnerFrame))
    }
    return blocks
  })

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    width,
    paddingX: 1,
  },
  h(Text, { bold: true }, panelTitle('Repository', focused)),
  h(Text, undefined, ''),
  ...tabBlocks)
}
