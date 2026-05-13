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
  const status = trailingWithSpinner ? `  ${trailingWithSpinner}` : ''
  const isError = state.statusKind === 'error'
  const isSuccess = state.statusKind === 'success'
  const contextualText = isError
    // Errors get the full footer width and a `✗` prefix so they read
    // as alarming. We drop the contextual hints when an error is
    // active — they'd compete for attention with the message and
    // long validator outputs (#907 polish: split-plan validator
    // errors are often 100+ chars and got truncated against the hints).
    ? `✗ ${state.statusMessage || ''}`
    : `${hints.contextual.join('   ')}${status}`
  const globalText = hints.global.join(' · ')

  // Error rendering: hide the global hints on the right so the
  // message can wrap into that space. Success rendering: accent
  // color on the message, hints stay visible. Default: existing
  // muted styling.
  const contextualColor = isError
    ? 'red'
    : isSuccess
      ? theme.colors.accent
      : theme.colors.muted

  return h(Box, {
    flexDirection: 'row',
    height: 2,
    justifyContent: 'space-between',
    paddingX: 1,
  },
  h(Text, {
    color: contextualColor,
    dimColor: !isError && !isSuccess,
    bold: isError,
  }, contextualText),
  // Globals are dropped entirely when an error is on screen — that
  // space is what the long message needs to render. They come back
  // the moment the status flips to info / success / cleared.
  isError
    ? h(Text, undefined, '')
    : h(Text, { color: theme.colors.muted, dimColor: true }, globalText))
}
