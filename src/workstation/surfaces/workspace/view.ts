/**
 * React/Ink view layer for the workspace surface (#880).
 *
 * Translates the pure `render.ts` models into `<Text>` / `<Box>`
 * elements. Kept in its own module so `runtime.ts` doesn't carry
 * Ink-shaped JSX details and the pure model layer never imports
 * React.
 */

import type * as ReactTypes from 'react'
import type { TextProps } from 'ink'

import type { LogInkTheme } from '../../chrome/theme'
import { renderThemePickerOverlay } from '../../runtime/overlays'
import { focusBorderColor, panelTitle } from '../../runtime/utils'

import type { WorkspaceComponents } from './runtime'
import { type PathCompletionResult } from './pathCompletion'
import {
    buildWorkspaceColumnHeaders,
    buildWorkspaceFooter,
    buildWorkspaceHeaderChips,
    buildWorkspaceHelpSections,
    buildWorkspaceListWindow,
    buildWorkspaceOnboarding,
    buildWorkspaceSidebar,
    shouldRailWorkspaceSidebar,
    type WorkspaceHeaderChip,
    type WorkspaceHelpRow,
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
  /**
   * Tick counter for the per-row PR-fetch spinner. Caller increments
   * this on a setInterval while any row is mid-fetch.
   */
  spinnerTick: number
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
    // The `key` is on each call site (caret/glyph/label/count) so we
    // don't recycle the same key string across siblings — that tripped
    // React's dup-key warning when both the caret cell and the label
    // cell shared `{ key: 'label' }` via the same props object.
    //
    // Props are built as plain literals (rather than mutated) because
    // Ink's TextProps fields are `readonly`. The tone choices follow
    // a small decision matrix:
    //   active + focused: bold + accent on both label and glyph
    //   active + unfocused: bold + glyph keeps accent so the user
    //     can still see "which filter is on" without the focus cue
    //   inactive + disabled: dim everything
    //   inactive + enabled: glyph in muted color (it's a visual key,
    //     never relying on color alone since the glyph itself is the
    //     primary signal)
    const useColor = !theme.noColor
    const labelProps: TextProps = row.active
      ? { bold: true, color: focused && useColor ? theme.colors.accent : undefined }
      : row.disabled
        ? { dimColor: true }
        : {}
    const glyphProps: TextProps = row.active
      ? { bold: true, color: useColor ? theme.colors.accent : undefined }
      : row.disabled
        ? { dimColor: true }
        : { color: useColor ? theme.colors.muted : undefined }
    const cursor = row.active ? '›' : ' '
    const paddedLabel = row.label.padEnd(widest)
    const countText = row.count > 0 ? String(row.count) : '·'
    return React.createElement(
      Box,
      { key: row.tab, flexDirection: 'row' },
      React.createElement(Text, { ...labelProps, key: 'caret' }, `${cursor} `),
      React.createElement(Text, { ...glyphProps, key: 'glyph' }, `${row.glyph} `),
      React.createElement(Text, { ...labelProps, key: 'label' }, paddedLabel),
      React.createElement(
        Text,
        {
          key: 'count',
          dimColor: !row.active,
          color: row.active && !theme.noColor ? theme.colors.accent : undefined,
        },
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
// Cursor prefix is 2 cells: caret + trailing space. The caret swaps
// between `↵` (cursored + list focus, since Enter drills in) and
// `›` (cursored + non-list focus, where Enter is repurposed). Other
// rows render two blanks so the table stays aligned regardless of
// which row is selected.
const CURSOR_PREFIX_WIDTH = 2

function renderListRow(
  deps: RenderWorkspaceAppDeps,
  row: WorkspaceListRow,
  key: string
): ReactTypes.ReactElement {
  const { React, ink, theme, state } = deps
  const { Box, Text } = ink
  // Single-glyph cursor that doubles as the drill-in hint when
  // appropriate. `↵` reads as "Enter to open this row" inline; `›`
  // is the fallback when Enter is repurposed (filter / add-repo /
  // confirm-delete focus). Replaces the earlier `›↵` pair which
  // landed on the screen as visual noise.
  const cursorGlyph = row.cursor
    ? state.focus === 'list'
      ? '↵'
      : '›'
    : ' '
  const cells = row.columns.map((column, index) => {
    // Cursored rows lean on bold + a richer color treatment rather
    // than full-row reverse video. The earlier inverse-background
    // approach made the row's other cells (especially dim tones)
    // hard to read on most themes.
    //
    // Props are built as plain literals (rather than mutated) because
    // Ink's TextProps fields are `readonly`. The matrix:
    //   cursored + primary cell: bold + accent color
    //   cursored + secondary cell: skip dimColor, keep the cell's
    //     semantic tone so the row reads brighter than its neighbors
    //     without inverting the background
    //   uncursored: dim flag + semantic tone if any
    const tonedColor = !theme.noColor ? toneColor(column.tone, theme) : undefined
    const textProps: TextProps = row.cursor
      ? {
        bold: column.primary,
        color:
          !theme.noColor && column.primary
            ? theme.colors.accent
            : tonedColor,
      }
      : {
        dimColor: column.tone === 'dim',
        color: tonedColor,
      }
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
          color: row.cursor && !theme.noColor ? theme.colors.accent : undefined,
        },
        `${cursorGlyph} `
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
  const windowed = buildWorkspaceListWindow(state, {
    width,
    rows: listRows,
    spinnerTick: deps.spinnerTick,
  })
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

function renderHelpRow(
  deps: RenderWorkspaceAppDeps,
  row: WorkspaceHelpRow,
  glyphWidth: number,
  keysWidth: number,
  key: string
): ReactTypes.ReactElement {
  const { React, ink, theme } = deps
  const { Box, Text } = ink
  return React.createElement(
    Box,
    { key, flexDirection: 'row' },
    React.createElement(
      Box,
      { width: glyphWidth, flexShrink: 0 },
      React.createElement(
        Text,
        { color: theme.noColor ? undefined : theme.colors.accent, bold: true },
        ` ${row.glyph ?? ' '} `
      )
    ),
    React.createElement(
      Box,
      { width: keysWidth, flexShrink: 0 },
      React.createElement(
        Text,
        { color: theme.noColor ? undefined : theme.colors.success, bold: true },
        row.keys
      )
    ),
    React.createElement(Text, null, row.description)
  )
}

function renderHelpOverlay(deps: RenderWorkspaceAppDeps): ReactTypes.ReactElement | null {
  if (!deps.state.showHelp) {
    return null
  }
  const { React, ink, theme } = deps
  const { Box, Text } = ink
  const sections = buildWorkspaceHelpSections()
  const allRows = sections.flatMap((section) => section.rows)
  // Columns: glyph cell (4 cells) · keys (padded to longest) · description.
  const glyphWidth = 4
  const keysWidth = Math.max(
    14,
    allRows.reduce((acc, row) => Math.max(acc, row.keys.length), 0) + 4
  )

  const children: ReactTypes.ReactNode[] = []

  // Title bar — accent-tinged, matches the chip-style header on the
  // main surface so the help reads as the same app, just a different
  // panel.
  children.push(
    React.createElement(
      Box,
      { key: 'title', flexDirection: 'row', justifyContent: 'space-between' },
      React.createElement(
        Box,
        { key: 'title-left', flexDirection: 'row' },
        React.createElement(
          Text,
          { bold: true, color: theme.noColor ? undefined : theme.colors.accent },
          ' ?  coco workspace'
        ),
        React.createElement(Text, { dimColor: true }, '  keymap · '),
        React.createElement(Text, { dimColor: true }, `${allRows.length} bindings`)
      ),
      React.createElement(
        Text,
        { dimColor: true },
        'esc / ? to close '
      )
    )
  )
  children.push(React.createElement(Text, { key: 'title-sep', dimColor: true }, ''))

  // Sections — each gets a title in accent, optional subtitle dim,
  // then its rows, then a blank line.
  sections.forEach((section, sIndex) => {
    children.push(
      React.createElement(
        Text,
        {
          key: `section-${sIndex}-title`,
          bold: true,
          color: theme.noColor ? undefined : theme.colors.muted,
        },
        section.title.toUpperCase()
      )
    )
    if (section.subtitle) {
      children.push(
        React.createElement(
          Text,
          { key: `section-${sIndex}-subtitle`, dimColor: true },
          ` ${section.subtitle}`
        )
      )
    }
    section.rows.forEach((row, rIndex) => {
      children.push(
        renderHelpRow(deps, row, glyphWidth, keysWidth, `row-${sIndex}-${rIndex}`)
      )
    })
    if (sIndex < sections.length - 1) {
      children.push(React.createElement(Text, { key: `section-${sIndex}-spacer` }, ''))
    }
  })

  return React.createElement(
    Box,
    {
      borderColor: focusBorderColor(theme, true),
      borderStyle: theme.borderStyle,
      flexDirection: 'column',
      paddingX: 1,
    },
    ...children
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
  const contextualText = model.contextual.join('   ')
  const globalText = model.global.join(' · ')
  return React.createElement(
    Box,
    {
      borderColor: focusBorderColor(theme, false),
      borderStyle: theme.borderStyle,
      paddingX: 1,
      flexDirection: 'column',
      height: FOOTER_HEIGHT,
    },
    // Row 1: contextual ↔ global hints. justifyContent pushes them
    // to opposite edges so the eye scans each cluster as one block —
    // same shape as `coco ui`'s footer post-0.54.2 redesign.
    React.createElement(
      Box,
      { flexDirection: 'row', justifyContent: 'space-between' },
      React.createElement(Text, { dimColor: true }, contextualText),
      React.createElement(Text, { dimColor: true }, globalText)
    ),
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
  // Theme picker is modal too — the chrome live-previews underneath via
  // the reactive `deps.theme`, while the overlay replaces the body.
  if (deps.state.showThemePicker) {
    return React.createElement(
      Box,
      { flexDirection: 'column', height: rootHeight },
      renderHeader(deps),
      renderThemePickerOverlay(
        React.createElement,
        { Box: ink.Box, Text: ink.Text },
        deps.state.themePickerFilter,
        deps.state.themePickerIndex,
        bodyWidth,
        deps.theme,
        true
      ),
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
