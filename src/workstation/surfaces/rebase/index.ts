/**
 * Interactive rebase surface (#1359). Renders the todo plan for
 * `<base>^..HEAD` as a first-person list: an action tag per row
 * (pick / squash / fixup / drop / reword / edit), the short sha, and
 * the subject (the reword replacement when one is staged). A summary
 * line previews the resulting commit count so squashes/drops read at a
 * glance before anything executes.
 *
 * Keys are dispatched in inkInput (j/k cursor · J/K reorder · p/s/f/d/e
 * retag · r reword · Enter run behind y-confirm · Esc back, which
 * clears the plan).
 */

import type * as ReactTypes from 'react'
import type { RebaseTodoAction } from '../../../git/rebasePlanActions'
import { truncateCells } from '../../chrome/text'
import type { LogInkTheme } from '../../chrome/theme'
import type { SurfaceRenderContext } from '../../runtime/types'
import { focusBorderColor, panelTitle } from '../../runtime/utils'

const ACTION_ORDER: RebaseTodoAction[] = ['pick', 'squash', 'fixup', 'drop', 'reword', 'edit']

function actionColor(action: RebaseTodoAction, theme: LogInkTheme): string | undefined {
  if (theme.noColor) return undefined
  switch (action) {
    case 'pick':
      return undefined
    case 'squash':
    case 'fixup':
      return theme.colors.accent
    case 'drop':
      return theme.colors.danger
    case 'reword':
    case 'edit':
      return theme.colors.warning
  }
}

export function renderRebaseSurface(ctx: SurfaceRenderContext): ReactTypes.ReactElement {
  const { h, components, state, bodyRows, width, theme } = ctx
  const { Box, Text } = components
  const focused = state.focus === 'commits'
  const plan = state.rebasePlan
  const rows = plan?.rows ?? []
  const selected = plan ? Math.max(0, Math.min(plan.selectedIndex, Math.max(0, rows.length - 1))) : 0

  const listRows = Math.max(4, bodyRows - 5)
  const startIndex = Math.max(
    0,
    Math.min(selected - Math.floor(listRows / 2), Math.max(0, rows.length - listRows))
  )
  const visible = rows.slice(startIndex, startIndex + listRows)

  const kept = rows.filter((row) => row.action !== 'drop')
  const folded = kept.filter((row) => row.action === 'squash' || row.action === 'fixup').length
  const resulting = Math.max(0, kept.length - folded)
  const summary = plan
    ? `${rows.length} in plan · ${resulting} result${resulting === 1 ? '' : 's'} after squash/drop`
    : ''

  const children: ReactTypes.ReactElement[] = [
    h(Text, { key: 'rebase-title', bold: true }, panelTitle('Rebase plan', focused)),
  ]

  if (!plan || rows.length === 0) {
    children.push(
      h(Text, { key: 'rebase-empty', dimColor: true },
        'No rebase plan open — press i on a history commit to build one.')
    )
  } else {
    children.push(
      h(Text, { key: 'rebase-meta', dimColor: true },
        truncateCells(`oldest → newest · ${summary}`, Math.max(10, width - 4)))
    )
    for (let offset = 0; offset < visible.length; offset += 1) {
      const index = startIndex + offset
      const row = visible[offset]
      const isSelected = index === selected
      const tag = row.action.padEnd(6)
      const subject = row.action === 'reword' && row.newMessage
        ? `${row.newMessage.split('\n')[0]} (reworded)`
        : row.subject
      const line = `${isSelected ? '❯ ' : '  '}${tag} ${row.shortSha} ${subject}`
      children.push(
        h(Text, {
          key: `rebase-row-${row.sha}`,
          color: isSelected ? (theme.noColor ? undefined : theme.colors.accent) : actionColor(row.action, theme),
          bold: isSelected,
          dimColor: !isSelected && row.action === 'drop',
        }, truncateCells(line, Math.max(10, width - 4)))
      )
    }
    children.push(
      h(Text, { key: 'rebase-hint', dimColor: true },
        truncateCells(
          `p/s/f/d/e retag · r reword · J/K reorder · enter run · esc back (${ACTION_ORDER.join('/')})`,
          Math.max(10, width - 4)
        ))
    )
  }

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    width,
    paddingX: 1,
  }, ...children)
}
