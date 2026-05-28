/**
 * React/Ink view layer for the workspace surface (#880).
 *
 * Translates the pure `render.ts` models into `<Text>` / `<Box>`
 * elements. Kept in its own module so `runtime.ts` doesn't carry
 * Ink-shaped JSX details and the pure model layer never imports
 * React.
 */

import type * as ReactTypes from 'react'

import type { LogInkTheme } from '../../chrome/theme'
import { focusBorderColor, panelTitle } from '../../runtime/utils'

import type { WorkspaceComponents } from './runtime'
import { type PathCompletionResult } from './pathCompletion'
import {
  buildWorkspaceColumnHeaders,
  buildWorkspaceFooter,
  buildWorkspaceHeaderChips,
  buildWorkspaceHelpRows,
  buildWorkspaceListWindow,
  buildWorkspaceOnboarding,
  buildWorkspaceSidebar,
  shouldRailWorkspaceSidebar,
  type WorkspaceHeaderChip,
  type WorkspaceListColumn,
  type WorkspaceListRow,
} from './render'
import { selectVisibleRepos, type WorkspaceState } from './state'

type RenderWorkspaceAppDeps = {
  React: typeof ReactTypes
  ink: WorkspaceComponents
  state: WorkspaceState
  theme: LogInkTheme
  appLabel: string
  filterDraft: string
  addRepoDraft: string
  addRepoCompletion: PathCompletionResult
  /** Terminal width in cells. Caller resolves via Ink's useWindowSize. */
  columns: number
  /** Terminal height in rows. Caller resolves via Ink's useWindowSize. */
  rows: number
}

function toneColor(tone: WorkspaceListColumn['tone'], theme: LogInkTheme): string | undefined {
  if (theme.noColor) {
    return undefined
  }
  switch (tone) {
    case 'warn':
      return theme.colors.warning
    case 'ok':
      return theme.colors.success
    case 'dim':
      return theme.colors.muted
    case 'default':
    default:
      return undefined
  }
}

function focusLabel(focus: WorkspaceState['focus']): string {
  switch (focus) {
    case 'sidebar':
      return 'Tabs'
    case 'list':
      return 'List'
    case 'filter':
      return 'Filter'
    case 'add-repo':
      return 'Add'
    case 'confirm-delete':
      return 'Confirm'
    default:
      return 'List'
  }
}

function chipColor(tone: WorkspaceHeaderChip['tone'], theme: LogInkTheme): string | undefined {
  if (theme.noColor) return undefined
  switch (tone) {
    case 'accent':
      return theme.colors.accent
    case 'warn':
      return theme.colors.warning
    case 'dim':
      return theme.colors.muted
    case 'default':
    default:
      return undefined
  }
}

function renderHeader(deps: RenderWorkspaceAppDeps): ReactTypes.ReactElement {
  const { React, ink, state, theme, appLabel } = deps
  const { Box, Text } = ink
  const chips = buildWorkspaceHeaderChips(state, {
    appLabel,
    focusLabel: focusLabel(state.focus),
  })
  const separator = ' · '
  // Interleave chips with a dim separator. Each chip gets its own Text
  // so its color survives the render — same shape as `coco ui`'s
  // chip header.
  const nodes: ReactTypes.ReactNode[] = []
  chips.forEach((chip, index) => {
    if (index > 0) {
      nodes.push(
        React.createElement(Text, { key: `sep-${index}`, dimColor: true }, separator)
      )
    }
    nodes.push(
      React.createElement(
        Text,
        {
          key: chip.id,
          bold: chip.bold,
          dimColor: chip.tone === 'dim',
          color: chipColor(chip.tone, theme),
        },
        chip.label
      )
    )
  })
  return React.createElement(
    Box,
    {
      borderColor: focusBorderColor(theme, true),
      borderStyle: theme.borderStyle,
      paddingX: 1,
    },
    ...nodes
  )
}

const SIDEBAR_WIDTH_EXPANDED = 22
const SIDEBAR_WIDTH_RAILED = 5
const SIDEBAR_LABEL_WIDTH = 9 // " Dirty " etc. — enough for the longest tab label

function sidebarWidthFor(deps: RenderWorkspaceAppDeps): number {
  const focused = deps.state.focus === 'sidebar'
  return shouldRailWorkspaceSidebar(deps.columns, focused)
    ? SIDEBAR_WIDTH_RAILED
    : SIDEBAR_WIDTH_EXPANDED
}

function renderSidebarRail(
  deps: RenderWorkspaceAppDeps,
  height: number
): ReactTypes.ReactElement {
  const { React, ink, state, theme } = deps
  const { Box, Text } = ink
  const focused = state.focus === 'sidebar' // never true while railed, but defensive
  const tabs = buildWorkspaceSidebar(state)
  const rows = tabs.map((row) => {
    const tone = row.disabled
      ? { dimColor: true }
      : row.active
        ? { bold: true, color: theme.noColor ? undefined : theme.colors.accent }
        : { dimColor: true }
    // Single-glyph rail row. The active tab's glyph keeps its accent
    // even when the sidebar isn't focused so the user can still see
    // "which filter is on" at a glance.
    return React.createElement(
      Text,
      { key: row.tab, ...tone },
      ` ${row.glyph}`
    )
  })
  return React.createElement(
    Box,
    {
      borderColor: focusBorderColor(theme, focused),
      borderStyle: theme.borderStyle,
      flexDirection: 'column',
      flexShrink: 0,
      height,
      paddingX: 0,
      width: SIDEBAR_WIDTH_RAILED,
    },
    React.createElement(Text, { dimColor: true }, ' »'),
    ...rows
  )
}

function renderSidebar(
  deps: RenderWorkspaceAppDeps,
  height: number
): ReactTypes.ReactElement {
  const { React, ink, state, theme } = deps
  const { Box, Text } = ink
  const focused = state.focus === 'sidebar'

  if (shouldRailWorkspaceSidebar(deps.columns, focused)) {
    return renderSidebarRail(deps, height)
  }

  const tabs = buildWorkspaceSidebar(state)
  const widest = tabs.reduce((acc, row) => Math.max(acc, row.label.length), SIDEBAR_LABEL_WIDTH)
  const rows = tabs.map((row) => {
    const labelProps: Record<string, unknown> = { key: 'label' }
    const glyphProps: Record<string, unknown> = { key: 'glyph' }
    if (row.active) {
      labelProps.bold = true
      glyphProps.bold = true
      if (focused && !theme.noColor) {
        labelProps.color = theme.colors.accent
        glyphProps.color = theme.colors.accent
      } else if (!theme.noColor) {
        // Tab glyph keeps a hint of color even while the sidebar
        // isn't focused, so users see "which filter is on" without
        // peering at the bold treatment.
        glyphProps.color = theme.colors.accent
      }
    } else {
      if (row.disabled) {
        labelProps.dimColor = true
        glyphProps.dimColor = true
      } else if (!theme.noColor) {
        // Inactive glyphs render in muted color so the column reads
        // as a visual key — never relying on color alone since the
        // glyph itself is the primary signal.
        glyphProps.color = theme.colors.muted
      }
    }
    const cursor = row.active ? '›' : ' '
    const paddedLabel = row.label.padEnd(widest)
    const countText = row.count > 0 ? String(row.count) : '·'
    return React.createElement(
      Box,
      { key: row.tab, flexDirection: 'row' },
      React.createElement(Text, labelProps, `${cursor} `),
      React.createElement(Text, glyphProps, `${row.glyph} `),
      React.createElement(Text, labelProps, paddedLabel),
      React.createElement(
        Text,
        { dimColor: !row.active, color: row.active && !theme.noColor ? theme.colors.accent : undefined },
        ` ${countText}`
      )
    )
  })
  return React.createElement(
    Box,
    {
      borderColor: focusBorderColor(theme, focused),
      borderStyle: theme.borderStyle,
      flexDirection: 'column',
      flexShrink: 0,
      height,
      paddingX: 1,
      width: SIDEBAR_WIDTH_EXPANDED,
    },
    React.createElement(Text, { bold: true }, panelTitle('Tabs', focused)),
    ...rows
  )
}

const COLUMN_GAP = 1
const CURSOR_PREFIX_WIDTH = 2

function renderListRow(
  deps: RenderWorkspaceAppDeps,
  row: WorkspaceListRow,
  key: string
): ReactTypes.ReactElement {
  const { React, ink, theme } = deps
  const { Box, Text } = ink
  const cursor = row.cursor ? '›' : ' '
  // Cursored rows use reverse video for the strongest selection
  // signal — the canonical TUI convention since VT100 and the same
  // affordance coco ui uses for active commits. Reverse video skips
  // applying per-cell tone colors because the inverted background
  // makes faint tones unreadable.
  const cursorReverse = row.cursor
  const cells = row.columns.map((column, index) => {
    const textProps: Record<string, unknown> = {
      bold: row.cursor && column.primary,
      inverse: cursorReverse,
    }
    if (!cursorReverse) {
      textProps.dimColor = column.tone === 'dim'
      const color = toneColor(column.tone, theme)
      if (color) textProps.color = color
    }
    // Fixed-width Box per column — table-style alignment across rows.
    return React.createElement(
      Box,
      {
        key: column.key,
        width: column.width + (index < row.columns.length - 1 ? COLUMN_GAP : 0),
        flexShrink: 0,
      },
      React.createElement(Text, textProps, column.text)
    )
  })
  return React.createElement(
    Box,
    { key, flexDirection: 'row' },
    React.createElement(
      Box,
      { width: CURSOR_PREFIX_WIDTH, flexShrink: 0 },
      React.createElement(
        Text,
        {
          bold: row.cursor,
          inverse: cursorReverse,
          color: row.cursor && !theme.noColor ? theme.colors.accent : undefined,
        },
        `${cursor} `
      )
    ),
    ...cells
  )
}

/**
 * Centered empty-state rendered when there's nothing to show in the
 * list (loading, no repos discovered, or filtered to zero). Uses
 * Box marginLeft to center horizontally — cheaper than computing a
 * perfect width and skipping cells, and visually equivalent.
 */
function renderEmptyState(
  deps: RenderWorkspaceAppDeps,
  width: number
): ReactTypes.ReactElement {
  const { React, ink, state, theme } = deps
  const { Box, Text } = ink
  const variant: 'loading' | 'no-repos' | 'no-matches' = state.loading
    ? 'loading'
    : state.overview.repos.length === 0
      ? 'no-repos'
      : 'no-matches'
  const glyph = variant === 'loading' ? '◐' : variant === 'no-repos' ? '∅' : '○'
  const headline =
    variant === 'loading'
      ? 'Scanning configured roots…'
      : variant === 'no-repos'
        ? 'No repositories discovered'
        : 'No repos match the current filter'
  const detail =
    variant === 'no-repos'
      ? 'Press `a` to add a repo by path, or configure `workspace.roots`.'
      : variant === 'no-matches'
        ? 'Press `esc` to clear the filter, or `tab` to change the sidebar tab.'
        : ''
  return React.createElement(
    Box,
    {
      key: 'empty',
      flexDirection: 'column',
      alignItems: 'center',
      width,
      marginTop: 2,
    },
    React.createElement(
      Text,
      {
        bold: true,
        color: variant === 'no-repos' && !theme.noColor ? theme.colors.muted : undefined,
      },
      `${glyph}  ${headline}`
    ),
    detail
      ? React.createElement(Text, { dimColor: true, key: 'detail' }, detail)
      : null
  )
}

function renderColumnHeader(
  deps: RenderWorkspaceAppDeps,
  width: number
): ReactTypes.ReactElement {
  const { React, ink, theme } = deps
  const { Box, Text } = ink
  const headers = buildWorkspaceColumnHeaders(width)
  const cells = headers.map((header, index) =>
    React.createElement(
      Box,
      {
        key: header.key,
        width: header.width + (index < headers.length - 1 ? COLUMN_GAP : 0),
        flexShrink: 0,
      },
      React.createElement(
        Text,
        { dimColor: true, color: theme.noColor ? undefined : theme.colors.muted },
        header.label
      )
    )
  )
  return React.createElement(
    Box,
    { flexDirection: 'row' },
    React.createElement(Box, { width: CURSOR_PREFIX_WIDTH, flexShrink: 0 }),
    ...cells
  )
}

function renderListBody(
  deps: RenderWorkspaceAppDeps,
  width: number,
  height: number
): ReactTypes.ReactElement {
  const { React, ink, state, theme } = deps
  const { Box, Text } = ink
  const focused = state.focus !== 'sidebar'

  // Reserve: 1 row each for panel title, column header, top chevron,
  // bottom chevron, plus 2 for the border. Floor at 1 so we always
  // render at least one row of content.
  const reservedChrome = 5
  const listRows = Math.max(1, height - reservedChrome)
  const windowed = buildWorkspaceListWindow(state, { width, rows: listRows })
  const visibleRepos = selectVisibleRepos(state)

  const filterChip = state.filter
    ? `  ·  filter: ${state.filter}`
    : state.focus === 'filter'
      ? `  ·  filter: ${deps.filterDraft}_`
      : ''
  // Half-circle ◐ reads as "in progress" without animation; pairs
  // nicely with the text so the column doesn't depend on color alone.
  const headerRight = state.loading
    ? '◐ loading repos…'
    : `${visibleRepos.length} visible${filterChip}`

  const lines: ReactTypes.ReactNode[] = windowed.rows.length === 0
    ? [renderEmptyState(deps, width)]
    : windowed.rows.map((row, index) =>
      renderListRow(deps, row, `row-${windowed.hiddenAbove + index}`)
    )

  // Scroll chevrons render as fixed-height single-cell rows. Always
  // present (blank when nothing hidden) so the panel layout doesn't
  // shift as the user scrolls — keeps the visual frame steady.
  const topChevron = React.createElement(
    Text,
    { key: 'chevron-top', dimColor: true },
    windowed.hiddenAbove > 0 ? `↑ ${windowed.hiddenAbove} more` : ' '
  )
  const bottomChevron = React.createElement(
    Text,
    { key: 'chevron-bottom', dimColor: true },
    windowed.hiddenBelow > 0 ? `↓ ${windowed.hiddenBelow} more` : ' '
  )

  return React.createElement(
    Box,
    {
      borderColor: focusBorderColor(theme, focused),
      borderStyle: theme.borderStyle,
      flexDirection: 'column',
      flexGrow: 1,
      height,
      paddingX: 1,
    },
    // Panel title — kept on its own row, never crowded by the
    // scroll indicator (which used to overlap when content reflowed).
    React.createElement(
      Box,
      { justifyContent: 'space-between' },
      React.createElement(Text, { bold: true }, panelTitle('Workspace', focused)),
      React.createElement(Text, { dimColor: true }, headerRight)
    ),
    renderColumnHeader(deps, width),
    topChevron,
    ...lines,
    bottomChevron
  )
}

function renderHelpOverlay(deps: RenderWorkspaceAppDeps): ReactTypes.ReactElement | null {
  if (!deps.state.showHelp) {
    return null
  }
  const { React, ink, theme } = deps
  const { Box, Text } = ink
  const rows = buildWorkspaceHelpRows()
  const widest = rows.reduce((acc, row) => Math.max(acc, row.keys.length), 0)
  return React.createElement(
    Box,
    {
      borderColor: focusBorderColor(theme, true),
      borderStyle: theme.borderStyle,
      flexDirection: 'column',
      paddingX: 1,
    },
    React.createElement(Text, { bold: true }, 'Workspace keymap'),
    ...rows.map((row, index) =>
      React.createElement(
        Box,
        { key: index, flexDirection: 'row' },
        React.createElement(
          Text,
          { color: toneColor('ok', theme) },
          row.keys.padEnd(widest + 2)
        ),
        React.createElement(Text, null, row.description)
      )
    ),
    React.createElement(
      Text,
      { dimColor: true },
      'esc / ? / q close · auto-refresh disabled while help is open'
    )
  )
}

function renderOnboardingBanner(deps: RenderWorkspaceAppDeps): ReactTypes.ReactElement | null {
  const model = buildWorkspaceOnboarding(deps.state)
  if (!model.show) {
    return null
  }
  const { React, ink, theme } = deps
  const { Box, Text } = ink
  const lines = [model.emptyHint, model.populatedHint].filter(Boolean) as string[]
  return React.createElement(
    Box,
    {
      borderColor: focusBorderColor(theme, true),
      borderStyle: theme.borderStyle,
      flexDirection: 'column',
      paddingX: 1,
    },
    React.createElement(Text, { bold: true }, 'Welcome to `coco workspace`'),
    ...lines.map((line, idx) => React.createElement(Text, { key: idx }, line)),
    React.createElement(Text, { dimColor: true }, 'Any keypress dismisses this banner.')
  )
}

function renderConfirmDelete(deps: RenderWorkspaceAppDeps): ReactTypes.ReactElement | null {
  if (deps.state.focus !== 'confirm-delete' || !deps.state.pendingDeletePath) {
    return null
  }
  const { React, ink, theme } = deps
  const { Box, Text } = ink
  return React.createElement(
    Box,
    {
      borderColor: focusBorderColor(theme, true),
      borderStyle: theme.borderStyle,
      flexDirection: 'column',
      paddingX: 1,
    },
    React.createElement(Text, { bold: true }, `Remove ${deps.state.pendingDeletePath}?`),
    React.createElement(
      Text,
      { dimColor: true },
      'Only removes the entry from the known-repos store · the repo on disk is untouched.'
    ),
    React.createElement(Text, { color: toneColor('warn', theme) }, 'press y to confirm · any other key to cancel')
  )
}

function renderAddRepoPrompt(deps: RenderWorkspaceAppDeps): ReactTypes.ReactElement | null {
  if (deps.state.focus !== 'add-repo') {
    return null
  }
  const { React, ink, theme, addRepoDraft, addRepoCompletion } = deps
  const { Box, Text } = ink
  const completionLine = addRepoCompletion.completions.slice(0, 8).join('  ')
  const hint =
    addRepoCompletion.completions.length === 0
      ? 'no matches'
      : `${addRepoCompletion.completions.length} match${
        addRepoCompletion.completions.length === 1 ? '' : 'es'
      } · tab to extend · * = git repo`
  return React.createElement(
    Box,
    {
      borderColor: focusBorderColor(theme, true),
      borderStyle: theme.borderStyle,
      flexDirection: 'column',
      paddingX: 1,
    },
    React.createElement(Text, { bold: true }, `Add repo: ${addRepoDraft}_`),
    React.createElement(Text, { dimColor: true }, hint),
    completionLine
      ? React.createElement(Text, { color: toneColor('dim', theme) }, completionLine)
      : null
  )
}

const FOOTER_HEIGHT = 4 // 2 borders + hint row + status row

function renderFooter(deps: RenderWorkspaceAppDeps): ReactTypes.ReactElement {
  const { React, ink, state, theme } = deps
  const { Box, Text } = ink
  const model = buildWorkspaceFooter(state)
  // Always render the status row (placeholder when empty) so the
  // footer height never changes with state. Without this, the body
  // height shifted by a row every time a status banner came and went,
  // forcing the panel chrome to reflow.
  const statusContent = model.status ?? ''
  return React.createElement(
    Box,
    {
      borderColor: focusBorderColor(theme, false),
      borderStyle: theme.borderStyle,
      paddingX: 1,
      flexDirection: 'column',
      height: FOOTER_HEIGHT,
    },
    React.createElement(Text, { dimColor: true }, model.hint),
    React.createElement(
      Text,
      {
        color: model.status ? toneColor('warn', theme) : undefined,
        dimColor: !model.status,
      },
      statusContent || ' '
    )
  )
}

/**
 * Lay out vertical space for the workspace. Reserves rows for the
 * header (3 cells: top border + content + bottom border), the footer
 * (3 cells minimum, +1 when a status is set), and any overlay panels
 * currently showing. Body height is what's left, floored at 8 so the
 * list panel always renders something even on a tiny terminal.
 */
function computeBodyHeight(deps: RenderWorkspaceAppDeps): number {
  const HEADER_ROWS = 3
  // Footer height is now fixed (#1063 polish) so the body height
  // doesn't shift as status banners appear / disappear.
  const FOOTER_ROWS = FOOTER_HEIGHT
  const onboardingRows = buildWorkspaceOnboarding(deps.state).show ? 5 : 0
  const addRepoRows = deps.state.focus === 'add-repo' ? 5 : 0
  const confirmRows = deps.state.focus === 'confirm-delete' ? 5 : 0
  const reserved = HEADER_ROWS + FOOTER_ROWS + onboardingRows + addRepoRows + confirmRows
  return Math.max(8, deps.rows - reserved)
}

export function renderWorkspaceApp(deps: RenderWorkspaceAppDeps): ReactTypes.ReactElement {
  const { React, ink } = deps
  const { Box } = ink
  const bodyWidth = Math.max(40, deps.columns - 4)
  // Lock the root box to the terminal height so Ink never paints past
  // the screen. Same shape as `coco ui`'s root.
  const rootHeight = Math.max(10, deps.rows)
  // Help is modal — when it's up, replace the main list/sidebar pair
  // with the help panel so the user isn't distracted by background
  // updates while reading.
  if (deps.state.showHelp) {
    return React.createElement(
      Box,
      { flexDirection: 'column', height: rootHeight },
      renderHeader(deps),
      renderHelpOverlay(deps),
      renderFooter(deps)
    )
  }
  const bodyHeight = computeBodyHeight(deps)
  return React.createElement(
    Box,
    { flexDirection: 'column', height: rootHeight },
    renderHeader(deps),
    React.createElement(
      Box,
      { flexDirection: 'row', height: bodyHeight },
      renderSidebar(deps, bodyHeight),
      renderListBody(deps, bodyWidth - sidebarWidthFor(deps) - 2, bodyHeight)
    ),
    renderOnboardingBanner(deps),
    renderAddRepoPrompt(deps),
    renderConfirmDelete(deps),
    renderFooter(deps)
  )
}

export type { RenderWorkspaceAppDeps }
