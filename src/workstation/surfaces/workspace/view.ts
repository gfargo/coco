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
import { truncateCells } from '../../chrome/text'
import { focusBorderColor, panelTitle } from '../../runtime/utils'

import type { WorkspaceComponents, WorkspaceInkRuntime } from './runtime'
import {
  buildWorkspaceFooter,
  buildWorkspaceHeader,
  buildWorkspaceListRows,
  buildWorkspaceSidebar,
  type WorkspaceListColumn,
} from './render'
import { selectVisibleRepos, type WorkspaceState } from './state'

type RenderWorkspaceAppDeps = {
  React: typeof ReactTypes
  ink: WorkspaceInkRuntime['ink']
  state: WorkspaceState
  theme: LogInkTheme
  appLabel: string
  filterDraft: string
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

function renderHeader(deps: RenderWorkspaceAppDeps): ReactTypes.ReactElement {
  const { React, ink, state, theme, appLabel } = deps
  const { Box, Text } = ink
  const model = buildWorkspaceHeader(state, { appLabel })
  const left = `${model.appLabel}  roots: ${model.rootsLabel || '—'}`
  const right = [
    `${model.visibleCount}/${model.repoCount} repos`,
    `sort: ${model.sortLabel}`,
    model.loading ? 'refreshing…' : '',
  ]
    .filter(Boolean)
    .join('  ·  ')
  return React.createElement(
    Box,
    { borderColor: focusBorderColor(theme, true), borderStyle: theme.borderStyle, paddingX: 1, justifyContent: 'space-between' },
    React.createElement(Text, { bold: true }, left),
    React.createElement(Text, { dimColor: true }, right)
  )
}

function renderSidebar(
  deps: RenderWorkspaceAppDeps
): ReactTypes.ReactElement {
  const { React, ink, state, theme } = deps
  const { Box, Text } = ink
  const focused = state.focus === 'list'
  const tabs = buildWorkspaceSidebar(state)
  const rows = tabs.map((row) => {
    const props: Record<string, unknown> = { key: row.tab }
    if (row.active) {
      props.bold = true
    } else if (row.disabled) {
      props.dimColor = true
    }
    const cursor = row.active ? '›' : ' '
    return React.createElement(Text, props, `${cursor} ${row.label}`)
  })
  return React.createElement(
    Box,
    {
      borderColor: focusBorderColor(theme, focused),
      borderStyle: theme.borderStyle,
      flexDirection: 'column',
      flexShrink: 0,
      paddingX: 1,
      width: 18,
    },
    React.createElement(Text, { bold: true }, panelTitle('Tabs', focused)),
    ...rows
  )
}

function renderListRow(
  deps: RenderWorkspaceAppDeps,
  row: ReturnType<typeof buildWorkspaceListRows>[number],
  key: string,
  width: number
): ReactTypes.ReactElement {
  const { React, ink, theme } = deps
  const { Box, Text } = ink
  const cursor = row.cursor ? '›' : ' '
  const cells = row.columns.map((column, index) =>
    React.createElement(
      Box,
      { key: index, marginRight: 1 },
      React.createElement(
        Text,
        {
          bold: row.cursor && column.primary,
          dimColor: !row.cursor && column.tone === 'dim',
          color: toneColor(column.tone, theme),
        },
        column.text
      )
    )
  )
  return React.createElement(
    Box,
    { key, flexDirection: 'row' },
    React.createElement(Text, { bold: row.cursor }, `${cursor} `),
    React.createElement(Box, { flexDirection: 'row', flexShrink: 1, flexWrap: 'wrap' }, ...cells),
    React.createElement(Box, { flexShrink: 0 }, React.createElement(Text, { dimColor: true }, truncateCells('', Math.max(0, width)))) // reserve trailing space
  )
}

function renderListBody(
  deps: RenderWorkspaceAppDeps,
  width: number
): ReactTypes.ReactElement {
  const { React, ink, state, theme } = deps
  const { Box, Text } = ink
  const focused = state.focus !== 'filter'
  const rows = buildWorkspaceListRows(state)
  const visibleRepos = selectVisibleRepos(state)
  const filterChip = state.filter
    ? `  ·  filter: ${state.filter}`
    : state.focus === 'filter'
      ? `  ·  filter: ${deps.filterDraft}_`
      : ''
  const headerRight = state.loading
    ? 'loading repos…'
    : `${visibleRepos.length} visible${filterChip}`
  const lines: ReactTypes.ReactNode[] = rows.length === 0
    ? [
      React.createElement(
        Text,
        { dimColor: true, key: 'empty' },
        state.loading
          ? 'Scanning configured roots…'
          : state.overview.repos.length === 0
            ? 'No repositories discovered. Configure workspace.roots and try again.'
            : 'No repos match the current filter.'
      ),
    ]
    : rows.map((row, index) => renderListRow(deps, row, `row-${index}`, width))
  return React.createElement(
    Box,
    {
      borderColor: focusBorderColor(theme, focused),
      borderStyle: theme.borderStyle,
      flexDirection: 'column',
      flexGrow: 1,
      paddingX: 1,
    },
    React.createElement(
      Box,
      { justifyContent: 'space-between' },
      React.createElement(Text, { bold: true }, panelTitle('Workspace', focused)),
      React.createElement(Text, { dimColor: true }, headerRight)
    ),
    ...lines
  )
}

function renderFooter(deps: RenderWorkspaceAppDeps): ReactTypes.ReactElement {
  const { React, ink, state, theme } = deps
  const { Box, Text } = ink
  const model = buildWorkspaceFooter(state)
  return React.createElement(
    Box,
    {
      borderColor: focusBorderColor(theme, false),
      borderStyle: theme.borderStyle,
      paddingX: 1,
      flexDirection: 'column',
    },
    React.createElement(Text, { dimColor: true }, model.hint),
    model.status
      ? React.createElement(Text, { color: toneColor('warn', theme) }, model.status)
      : null
  )
}

export function renderWorkspaceApp(deps: RenderWorkspaceAppDeps): ReactTypes.ReactElement {
  const { React, ink } = deps
  const { Box } = ink
  const { columns } = ink.useWindowSize()
  const bodyWidth = Math.max(40, columns - 4)
  return React.createElement(
    Box,
    { flexDirection: 'column' },
    renderHeader(deps),
    React.createElement(
      Box,
      { flexDirection: 'row' },
      renderSidebar(deps),
      renderListBody(deps, bodyWidth - 22)
    ),
    renderFooter(deps)
  )
}

export type { WorkspaceComponents }
