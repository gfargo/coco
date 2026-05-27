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
  buildWorkspaceFooter,
  buildWorkspaceHeader,
  buildWorkspaceHelpRows,
  buildWorkspaceListRows,
  buildWorkspaceOnboarding,
  buildWorkspaceSidebar,
  type WorkspaceListColumn,
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
  key: string
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
    React.createElement(Box, { flexDirection: 'row', flexShrink: 1, flexWrap: 'wrap' }, ...cells)
  )
}

function renderListBody(
  deps: RenderWorkspaceAppDeps,
  width: number
): ReactTypes.ReactElement {
  const { React, ink, state, theme } = deps
  const { Box, Text } = ink
  const focused = state.focus !== 'filter'
  const rows = buildWorkspaceListRows(state, { width })
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
    : rows.map((row, index) => renderListRow(deps, row, `row-${index}`))
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
  const bodyWidth = Math.max(40, deps.columns - 4)
  // Help is modal — when it's up, replace the main list/sidebar pair
  // with the help panel so the user isn't distracted by background
  // updates while reading.
  if (deps.state.showHelp) {
    return React.createElement(
      Box,
      { flexDirection: 'column' },
      renderHeader(deps),
      renderHelpOverlay(deps),
      renderFooter(deps)
    )
  }
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
    renderOnboardingBanner(deps),
    renderAddRepoPrompt(deps),
    renderConfirmDelete(deps),
    renderFooter(deps)
  )
}

export type { RenderWorkspaceAppDeps }
