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
 * Row 2 styling is kind-aware. Each statusKind gets its own theme
 * color and glyph prefix so the message is identifiable at a glance
 * — even with NO_COLOR set, the glyph alone communicates kind:
 *
 *   loading  →  spinner + accent  + bold
 *   error    →  ✗ / !  + danger   + bold
 *   warning  →  ⚠ / !  + warning  + bold
 *   success  →  ✓ / +  + success  + bold
 *   info     →  ℹ / i  + info     + bold
 *   idle tip →  no glyph + dim muted (passive)
 *
 * Pre-redesign success and loading both used `accent` (cyan), so the
 * user couldn't tell "done" from "in progress" by color alone. Each
 * kind now uses its dedicated theme color and ships an ASCII glyph
 * fallback for `theme.ascii` mode (TERM=dumb / vt100).
 *
 * Extracted from `src/commands/log/inkRuntime.ts` as part of phase
 * 5a.7 of #890. Two-row layout introduced post-0.54.2; per-kind
 * colors + glyphs added in the same pass.
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
  spinnerFrame: number = 0,
  singlePane: boolean = false
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
  // The single-pane pane switcher only makes sense in the plain
  // per-pane states. While an overlay or filter owns the screen the
  // visible pane is forced (split-plan → main; help / palette / theme /
  // gitignore / input prompt / confirmation / chord → inspector) or
  // input is captured, and Tab does something else — so the switcher
  // would point at a pane that isn't on screen. Suppress it then. Mirror
  // of the runtime's `forcedPane` derivation in `app.ts`.
  const overlayForcesPane = Boolean(
    state.splitPlan ||
      state.showHelp ||
      state.showCommandPalette ||
      state.showThemePicker ||
      state.gitignorePicker ||
      state.inputPrompt ||
      state.pendingConfirmationId ||
      state.pendingMutationConfirmation ||
      state.pendingKey ||
      state.filterMode
  )
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
    singlePane: singlePane && !overlayForcesPane,
  })
  // Real status messages always win; idle tips only fill the slot when it
  // would otherwise be empty.
  const hasStatusMessage = Boolean(state.statusMessage)
  const isLoading = Boolean(state.statusLoading && hasStatusMessage)
  const isError = state.statusKind === 'error'
  const isWarning = state.statusKind === 'warning'
  const isSuccess = state.statusKind === 'success'
  // 'info' is the implicit kind when statusKind is undefined but
  // statusMessage is set — it's a deliberate status update, not an
  // idle tip, so it gets info treatment rather than the dim fallback.
  const isInfo = hasStatusMessage && !isError && !isWarning && !isSuccess && !isLoading
  const rawTrailing = state.statusMessage || idleTip || ''

  // Glyphs per kind so the message is identifiable even before reading
  // the color — improves scan-ability and degrades gracefully when the
  // terminal lacks color. ASCII fallback for `theme.ascii` mode (TERM
  // = dumb / vt100) where unicode glyphs render as garbage.
  //   loading  →  spinner (animated)
  //   error    →  ✗  / !
  //   warning  →  ⚠  / !
  //   success  →  ✓  / +
  //   info     →  ℹ  / i
  //   idle tip →  no glyph (passive)
  const glyph = ((): string => {
    if (isLoading) return pickSpinnerFrame(spinnerFrame)
    if (isError) return theme.ascii ? '!' : '✗'
    if (isWarning) return theme.ascii ? '!' : '⚠'
    if (isSuccess) return theme.ascii ? '+' : '✓'
    if (isInfo) return theme.ascii ? 'i' : 'ℹ'
    return ''
  })()
  const statusBody = rawTrailing
    ? glyph
      ? `${glyph} ${rawTrailing}`
      : rawTrailing
    : ''

  // Row 2 color picks. Each kind gets its own theme color so success
  // and loading are visually distinct (was conflated under `accent`
  // pre-redesign — users couldn't tell "done" from "in progress").
  //   loading → accent  (cyan / preset blue)
  //   error   → danger  (red / preset red)
  //   warning → warning (yellow)
  //   success → success (green)
  //   info    → info    (blue / preset accent in light themes)
  //   idle    → undefined + dim (passive, blends with chrome)
  const statusColor = isError
    ? theme.colors.danger
    : isWarning
      ? theme.colors.warning
      : isSuccess
        ? theme.colors.success
        : isLoading
          ? theme.colors.accent
          : isInfo
            ? theme.colors.info
            : undefined
  const statusBold = isError || isWarning || isSuccess || isLoading || isInfo
  const statusDim = !statusBold

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
