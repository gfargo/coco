/**
 * Detail-panel dispatcher. Routes to the right detail / overlay
 * renderer based on:
 *
 *   - transient overlay state (help, palette, input prompt,
 *     confirmation, chord) — these take precedence
 *   - the active view (compose / status / diff / branches / tags /
 *     stash / history → different detail surfaces)
 *   - whether the history view is showing the synthetic pending-commit
 *     row (which swaps the inspector out for the worktree summary)
 *
 * Extracted from `src/commands/log/inkRuntime.ts` as part of phase 5a.7
 * of #890. No behavior change.
 */

import type * as ReactTypes from 'react'
import type { LogInkContextStatus } from '../chrome/context'
import type { LogInkTheme } from '../chrome/theme'
import type {
    GitCommitDetail,
    GitCommitFilePreview,
} from '../../commands/log/data'
import { getSelectedInkCommit } from '../../commands/log/inkViewModel'
import type { LogInkState } from '../../commands/log/inkViewModel'
import { focusBorderColor, panelTitle } from './utils'
import {
    renderBranchPreviewPanel,
    renderCommitDiffDetail,
    renderCommitPanel,
    renderComposeContextPanel,
    renderHistoryInspector,
    renderIssueTriagePreviewPanel,
    renderPullRequestTriagePreviewPanel,
    renderStashPreviewPanel,
    renderSubmodulePreviewPanel,
    renderTagPreviewPanel,
} from '../surfaces/detail'
import {
    renderChordOverlay,
    renderCommandPalette,
    renderConfirmationPanel,
    renderHelpPanel,
    renderInputPromptPanel,
    renderThemePickerOverlay,
} from './overlays'
import type { LogInkComponents, LogInkContext } from './types'

/**
 * Rail-mode inspector — shown on terminals < 100 columns when the
 * detail panel does not hold focus. The full inspector (commit body,
 * file list, actions) does not survive truncation to ~4 content cells
 * so we collapse to a stack with the panel label and the selected
 * commit's shortHash. Focus pops the panel back to its expanded
 * widths via the layout, so this renderer is only reached at rest.
 *
 * Help / overlay states are still handled by their own renderers
 * above; this short-circuit only kicks in for the regular "view the
 * commit" cases.
 */
function renderInspectorRail(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  detail: GitCommitDetail | undefined,
  width: number,
  theme: LogInkTheme,
  focused: boolean
): ReactTypes.ReactElement {
  const { Box, Text } = components
  // Prefer the loaded detail's hash (canonical) but fall back to the
  // selected list row's shortHash so the rail isn't blank on the
  // first render before getCommitDetail resolves.
  const selectedRow = getSelectedInkCommit(state)
  const hashText = detail?.hash.slice(0, 4)
    ?? selectedRow?.shortHash.slice(0, 4)
    ?? '····'

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    width,
    paddingX: 1,
  },
  h(Text, { bold: true, dimColor: !focused }, panelTitle('Insp', focused)),
  h(Text, { dimColor: true }, '────'),
  h(Text, { color: theme.noColor ? undefined : theme.colors.accent }, hashText))
}

export function renderDetailPanel(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  context: LogInkContext,
  contextStatus: LogInkContextStatus,
  detail: GitCommitDetail | undefined,
  loading: boolean,
  filePreview: GitCommitFilePreview | undefined,
  filePreviewLoading: boolean,
  width: number,
  tabbed: boolean,
  theme: LogInkTheme,
  railed: boolean = false,
  bodyRows: number = 0
): ReactTypes.ReactElement {
  const focused = state.focus === 'detail'

  // Overlays (help / palette / input / confirmation / chord) take
  // precedence over rail because they always claim the panel's width
  // via the help-overlay layout branch — and railing those would
  // defeat their whole purpose (the user is reading them).
  if (state.showHelp) {
    return renderHelpPanel(h, components, state, width, theme, focused, bodyRows)
  }

  if (state.showCommandPalette) {
    return renderCommandPalette(h, components, state, width, theme, focused)
  }

  if (state.showThemePicker) {
    return renderThemePickerOverlay(h, components, state.themePickerFilter, state.themePickerIndex, width, theme, focused)
  }

  if (state.inputPrompt) {
    return renderInputPromptPanel(h, components, state, width, theme, focused)
  }

  if (state.pendingConfirmationId || state.pendingMutationConfirmation) {
    return renderConfirmationPanel(h, components, state, width, theme, focused)
  }

  // which-key style overlay — shows the available chord continuations
  // when the user has pressed the prefix and we're waiting for the
  // second key. Mirrors helix / which-key.nvim / doom-emacs.
  //
  // Suppressed when the split-plan overlay is open (#920 follow-up):
  // the overlay re-uses `pendingKey='g'` for its own `gg` chord
  // (jump-to-top scroll), and surfacing the global g-chord menu
  // (gB / gT / gS / …) at that moment would mislead the user into
  // thinking the global view-selector overrode the overlay's
  // navigation. The overlay's footer hint already documents `g/G top/bot`.
  if (state.pendingKey && !state.splitPlan) {
    return renderChordOverlay(h, components, state, width, theme, focused)
  }

  // Rail mode applies only after every overlay above has had its say
  // — those would all be unreadable at 4 cells of content. The layout
  // also clears `railed` whenever the inspector takes focus, so we
  // can safely short-circuit the per-view dispatch here without
  // worrying about hiding the panel from a user who's actively
  // reading it.
  if (railed) {
    return renderInspectorRail(h, components, state, detail, width, theme, focused)
  }

  // The synthetic "(+) new commit" row routes the inspector through the
  // worktree summary so the user sees what's staged / unstaged at a glance
  // — same surface as the compose view's right panel.
  if (state.activeView === 'history' && state.pendingCommitFocused) {
    return renderComposeContextPanel(h, components, state, context, contextStatus, width, theme, focused)
  }

  // Status + worktree-sourced diff keep the staging compose panel — it's
  // the action surface for stage / hunk / commit. Commit-sourced diff (from
  // history → Enter) gets a dedicated explore panel: subject, body, and a
  // navigable file list whose selection swaps the center diff.
  if (state.activeView === 'status') {
    return renderCommitPanel(h, components, state, context, contextStatus, width, theme, focused)
  }

  if (state.activeView === 'diff') {
    if (state.diffSource === 'commit') {
      return renderCommitDiffDetail(h, components, state, detail, loading, width, theme, focused)
    }
    return renderCommitPanel(h, components, state, context, contextStatus, width, theme, focused)
  }

  // Compose view: the right panel had been falling through to the inspector
  // and showing the last selected commit's data, which is wrong context for
  // an in-progress commit. Show the worktree summary instead.
  if (state.activeView === 'compose') {
    return renderComposeContextPanel(h, components, state, context, contextStatus, width, theme, focused)
  }

  // Preview pane (P4.1) — fzf / yazi / lazygit style: branches, tags, and
  // stash views each get a tailored summary of the selected entry instead
  // of falling through to the (stale) history inspector.
  if (state.activeView === 'branches') {
    return renderBranchPreviewPanel(h, components, state, context, contextStatus, width, theme, focused)
  }
  if (state.activeView === 'tags') {
    return renderTagPreviewPanel(h, components, state, context, contextStatus, width, theme, focused)
  }
  if (state.activeView === 'stash') {
    return renderStashPreviewPanel(h, components, state, context, contextStatus, width, theme, focused)
  }

  if (state.activeView === 'submodules') {
    return renderSubmodulePreviewPanel(h, components, state, context, contextStatus, width, theme, focused)
  }

  if (state.activeView === 'issues') {
    return renderIssueTriagePreviewPanel(h, components, state, context, contextStatus, width, theme, focused)
  }

  if (state.activeView === 'pull-request-triage') {
    return renderPullRequestTriagePreviewPanel(h, components, state, context, contextStatus, width, theme, focused)
  }

  return renderHistoryInspector(
    h, components, state, context, contextStatus, detail, loading,
    filePreview, filePreviewLoading, width, tabbed, theme, focused
  )
}
