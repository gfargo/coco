/**
 * Status-bar / footer renderer. Two-row layout, using the full
 * `height: 2` the footer already reserves:
 *
 *   Row 1 — keyboard hint band:
 *     ┌──── contextual hints ────┐                ┌──── globals ────┐
 *     ↑/↓ branches  ←/→ tab  …                    ? help · : cmds · q
 *
 *   Row 2 — status / feedback band:
 *     ⠋ main has no upstream — nothing to fetch.
 *
 * Row 2 is empty when there's no status message, idle tip, or error.
 * This is a behaviour change from the pre-0.54.2 single-row layout
 * where the status message sat awkwardly between the contextual and
 * global hints, getting visually crushed.
 *
 * The separation matters because:
 *   - status text and key hints serve different cognitive purposes
 *     (read vs. scan) and competing for the same row makes both
 *     harder to use,
 *   - long status messages (especially errors / multi-clause loading
 *     copy) no longer push global hints off screen or wrap into the
 *     hint cluster,
 *   - errors now keep the global hints visible — the user often
 *     needs `?` / `:` / `q` to *recover* from the error.
 *
 * Idle tips fill row 2 only when no real status message is set so the
 * tip cycle never overwrites genuine workflow feedback.
 *
 * Extracted from `src/commands/log/inkRuntime.ts` as part of phase
 * 5a.7 of #890. Two-row layout introduced post-0.54.2.
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
  const isError = state.statusKind === 'error'
  const isSuccess = state.statusKind === 'success'
  const rawTrailing = state.statusMessage || idleTip || ''

  // Loading status gets a spinner prefix in front of the message —
  // motion makes transient LLM calls (create-PR body, PR fetches,
  // etc.) feel less frozen even when they're sub-second. Errors get
  // the ✗ glyph; nothing else gets a prefix.
  const prefix = isError
    ? '✗ '
    : isLoading
      ? `${pickSpinnerFrame(spinnerFrame)} `
      : ''
  const statusBody = rawTrailing ? `${prefix}${rawTrailing}` : ''

  // Row 2 color picks: errors red+bold (must pop), loading/success
  // accent+bold (visible against the muted hint row above), everything
  // else dim+muted (idle tips and informational status shouldn't
  // compete with the hint band for attention).
  const statusColor = isError
    ? 'red'
    : (isLoading || isSuccess)
      ? theme.colors.accent
      : undefined
  const statusBold = isError || isLoading || isSuccess
  const statusDim = !isError && !isLoading && !isSuccess

  const hintsText = hints.contextual.join('   ')
  const globalText = hints.global.join(' · ')

  return h(Box, { flexDirection: 'column', height: 2, paddingX: 1 },
    // Row 1: contextual ↔ global hints. justifyContent pushes them
    // to opposite edges so the eye can scan each cluster as one
    // block instead of hunting through a single concatenated line.
    h(Box, { flexDirection: 'row', justifyContent: 'space-between' },
      h(Text, { color: theme.colors.muted, dimColor: true }, hintsText),
      h(Text, { color: theme.colors.muted, dimColor: true }, globalText)
    ),
    // Row 2: status / loading / idle tip / error. Empty Text keeps
    // the row reserved when nothing's set so the surrounding layout
    // doesn't shift as status flips on/off.
    h(Text, {
      color: statusColor,
      dimColor: statusDim,
      bold: statusBold,
    }, statusBody)
  )
}
