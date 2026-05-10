/**
 * Status-bar / footer renderer. Two-column layout:
 *   - Left: contextual hints for the active view (built by inkKeymap's
 *     `getLogInkFooterHints`), with the optional status message / idle
 *     tip appended.
 *   - Right: global key hints (`?` help, `:` palette, `q` quit, …).
 *
 * Idle tips only fill the slot when no real status message is set so the
 * tip cycle never overwrites genuine workflow feedback.
 *
 * Extracted from `src/commands/log/inkRuntime.ts` as part of phase 5a.7
 * of #890. No behavior change.
 */

import type * as ReactTypes from 'react'
import type { LogInkTheme } from '../chrome/theme'
import { getLogInkFooterHints } from '../../commands/log/inkKeymap'
import type { LogInkState } from '../../commands/log/inkViewModel'
import type { LogInkComponents, LogInkContext } from './types'

export function renderFooter(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  context: LogInkContext,
  theme: LogInkTheme,
  idleTip?: string
): ReactTypes.ReactElement {
  const { Box, Text } = components
  // Sidebar item count drives the per-tab footer hints — when items are
  // present the footer surfaces in-sidebar ops (checkout / apply / pop /
  // drop), otherwise it falls back to the generic "enter open" hint.
  const sidebarItemCount = (() => {
    switch (state.sidebarTab) {
      case 'branches': return context.branches?.localBranches.length
      case 'tags': return context.tags?.tags.length
      case 'stashes': return context.stashes?.stashes.length
      case 'worktrees': return context.worktreeList?.worktrees.length
      default: return undefined
    }
  })()
  const hints = getLogInkFooterHints({
    activeView: state.activeView,
    diffSource: state.diffSource,
    diffViewMode: state.diffViewMode,
    filterMode: state.filterMode,
    focus: state.focus,
    pendingKey: state.pendingKey,
    showCommandPalette: state.showCommandPalette,
    showHelp: state.showHelp,
    sidebarTab: state.sidebarTab,
    sidebarItemCount,
    compareBaseSet: Boolean(state.compareBase),
  })
  // Real status messages always win; idle tips only fill the slot when it
  // would otherwise be empty.
  const trailing = state.statusMessage || idleTip || ''
  const status = trailing ? `  ${trailing}` : ''
  const contextualText = `${hints.contextual.join('   ')}${status}`
  const globalText = hints.global.join(' · ')

  return h(Box, {
    flexDirection: 'row',
    height: 2,
    justifyContent: 'space-between',
    paddingX: 1,
  },
  h(Text, { color: theme.colors.muted, dimColor: true }, contextualText),
  h(Text, { color: theme.colors.muted, dimColor: true }, globalText))
}
