/**
 * Conflicts surface — exposes the conflicted files for an in-progress
 * merge / rebase / cherry-pick / revert. Per-file actions (resolve
 * ours, resolve theirs, stage resolved) are wired in inkInput.ts; the
 * surface itself is read-only.
 *
 * Three states matter:
 *   - No operation in progress → reassuring "nothing to resolve" copy.
 *   - Operation in progress with all conflicts resolved → "press C to
 *     continue" hint.
 *   - Conflicts remain → list with windowed scrolling.
 *
 * Extracted from `src/commands/log/inkRuntime.ts` as part of phase 5a.3
 * of #890. No behavior change.
 */

import type * as ReactTypes from 'react'
import type { LogInkContextStatus } from '../../chrome/context'
import { isLogInkContextKeyLoading } from '../../chrome/context'
import { formatLogInkLoading } from '../../chrome/surfaceStates'
import { truncateCells } from '../../chrome/text'
import type { LogInkTheme } from '../../chrome/theme'
import type { LogInkState } from '../../../commands/log/inkViewModel'
import type { LogInkComponents, LogInkContext } from '../../runtime/types'
import { focusBorderColor, panelTitle } from '../../runtime/utils'

export function renderConflictsSurface(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  context: LogInkContext,
  contextStatus: LogInkContextStatus,
  bodyRows: number,
  width: number,
  theme: LogInkTheme
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const focused = state.focus === 'commits'
  const loading = isLogInkContextKeyLoading(contextStatus, 'operation')
  const operation = context.operation
  const conflictedFiles = operation?.conflictedFiles || []
  const operationType = operation?.operation || 'none'

  // If no operation is in progress, show a fallback message.
  if (!loading && operationType === 'none') {
    return h(Box, {
      borderColor: focusBorderColor(theme, focused),
      borderStyle: theme.borderStyle,
      flexDirection: 'column',
      flexShrink: 0,
      paddingX: 1,
      width,
    },
    h(Box, { justifyContent: 'space-between' },
      h(Text, { bold: true }, panelTitle('Conflicts', focused)),
      h(Text, { dimColor: true }, 'no operation in progress')
    ),
    h(Text, { key: 'conflicts-empty', dimColor: true },
      'No merge, rebase, cherry-pick, or revert in progress.'
    ))
  }

  // All conflicts resolved — show the "continue" hint.
  if (!loading && conflictedFiles.length === 0 && operationType !== 'none') {
    return h(Box, {
      borderColor: focusBorderColor(theme, focused),
      borderStyle: theme.borderStyle,
      flexDirection: 'column',
      flexShrink: 0,
      paddingX: 1,
      width,
    },
    h(Box, { justifyContent: 'space-between' },
      h(Text, { bold: true }, panelTitle('Conflicts', focused)),
      h(Text, { dimColor: true }, `${operationType} — all conflicts resolved`)
    ),
    h(Text, { key: 'conflicts-hint', dimColor: true },
      `All conflicts resolved. Press C to continue the ${operationType}, or < to go back.`
    ))
  }

  const selected = Math.max(0, Math.min(state.selectedConflictFileIndex, Math.max(0, conflictedFiles.length - 1)))
  const listRows = Math.max(4, bodyRows - 4)
  const startIndex = Math.max(0, selected - Math.floor(listRows / 2))
  const visible = conflictedFiles.slice(startIndex, startIndex + listRows)
  const remaining = conflictedFiles.length
  const headerRight = loading
    ? 'loading conflicts'
    : `${operationType} — ${remaining} ${remaining === 1 ? 'conflict' : 'conflicts'} remaining`

  const statusLabel = (file: { indexStatus: string; worktreeStatus: string }): string => {
    const code = `${file.indexStatus}${file.worktreeStatus}`
    switch (code) {
      case 'UU': return 'both modified'
      case 'AA': return 'added by both'
      case 'DD': return 'both deleted'
      case 'AU': case 'UA': return 'added by one'
      case 'DU': return 'deleted by us'
      case 'UD': return 'deleted by them'
      default: return code
    }
  }

  const lines: ReactTypes.ReactNode[] = loading
    ? [h(Text, { key: 'conflicts-loading', dimColor: true }, formatLogInkLoading({ resource: 'conflicts' }))]
    : visible.map((file, offset) => {
      const index = startIndex + offset
      const isSelected = index === selected
      const cursor = isSelected ? '>' : ' '
      const code = `${file.indexStatus}${file.worktreeStatus}`
      const label = statusLabel(file)
      return h(Text, {
        key: `conflict-${index}`,
        bold: isSelected,
        dimColor: !isSelected,
      }, truncateCells(
        `${cursor} ${code} ${file.path}  (${label})`,
        width - 4
      ))
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
    h(Text, { bold: true }, panelTitle('Conflicts', focused)),
    h(Text, { dimColor: true }, headerRight)
  ),
  ...lines)
}
