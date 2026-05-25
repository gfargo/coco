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
import { pickSpinnerFrame } from '../chrome/spinner'
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
  idleTip?: string,
  spinnerFrame: number = 0
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
    splitPlanStatus: state.splitPlan?.status,
  })
  // Real status messages always win; idle tips only fill the slot when it
  // would otherwise be empty.
  const isLoading = Boolean(state.statusLoading && state.statusMessage)
  const trailing = state.statusMessage || idleTip || ''
  // Loading status gets a spinner prefix in front of the message —
  // motion makes transient LLM calls (create-PR body, PR fetches,
  // etc.) feel less frozen even when they're sub-second.
  const spinnerPrefix = isLoading ? `${pickSpinnerFrame(spinnerFrame)} ` : ''
  const trailingWithSpinner = trailing ? `${spinnerPrefix}${trailing}` : ''
  // Separated status text so loading rendering can give the message
  // its own visual treatment (bold + accent) without dragging the
  // keyboard hints along. Pre-loading users reported the spinner
  // was nearly invisible against the dimmed footer; isolating the
  // status to its own Text span fixes that.
  const status = trailingWithSpinner ? `  ${trailingWithSpinner}` : ''
  const hintsText = hints.contextual.join('   ')
  const isError = state.statusKind === 'error'
  const isSuccess = state.statusKind === 'success'
  const errorText = isError ? `✗ ${state.statusMessage || ''}` : ''
  const globalText = hints.global.join(' · ')

  // Color the status portion based on kind. Loading uses the accent
  // color (same as success) so motion glyphs stay readable; default
  // status messages stay muted to match the surrounding chrome.
  const statusColor = isSuccess || isLoading ? theme.colors.accent : undefined

  return h(Box, {
    flexDirection: 'row',
    height: 2,
    justifyContent: 'space-between',
    paddingX: 1,
  },
  // Errors take over the whole contextual area (replace hints + status).
  // Otherwise: hints stay dim/muted, status gets its own non-dim span
  // when loading / success so it pops.
  isError
    ? h(Text, { color: 'red', bold: true }, errorText)
    : h(Text, undefined,
        h(Text, { color: theme.colors.muted, dimColor: true }, hintsText),
        status
          ? h(Text, {
              color: statusColor,
              dimColor: !isLoading && !isSuccess,
              bold: isLoading,
            }, status)
          : ''
      ),
  // Globals are dropped entirely when an error is on screen — that
  // space is what the long message needs to render. They come back
  // the moment the status flips to info / success / cleared.
  isError
    ? h(Text, undefined, '')
    : h(Text, { color: theme.colors.muted, dimColor: true }, globalText))
}
