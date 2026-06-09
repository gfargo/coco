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
 * Extracted from `src/workstation/runtime/inkRuntime.ts` as part of phase 5a.7
 * of #890. No behavior change.
 */

import type * as ReactTypes from 'react'
import type {
    GitCommitDetail,
    GitCommitFilePreview,
} from '../../commands/log/data'
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
    renderChoicePanel,
    renderCommandPalette,
    renderConfirmationPanel,
    renderHelpPanel,
    renderInputPromptPanel,
    renderGitignorePickerOverlay,
    renderThemePickerOverlay,
    renderViewKeysOverlay,
} from './overlays'
import type { SurfaceRenderContext } from './types'

/**
 * The detail/inspector-specific render slices, bundled (#0.68) so
 * `renderDetailPanel` takes the shared `SurfaceRenderContext` plus this object
 * instead of 13 positional params (which it shared awkwardly with the universal
 * h/components/state/... values now carried by the context).
 */
export type DetailPanelExtras = {
  detail: GitCommitDetail | undefined
  loading: boolean
  filePreview: GitCommitFilePreview | undefined
  filePreviewLoading: boolean
  tabbed: boolean
}

export function renderDetailPanel(
  surface: SurfaceRenderContext,
  extras: DetailPanelExtras
): ReactTypes.ReactElement {
  const { h, components, state, context, contextStatus, bodyRows, width, theme } = surface
  const { detail, loading, filePreview, filePreviewLoading, tabbed } = extras
  const focused = state.focus === 'detail'

  // Overlays (help / palette / input / confirmation / chord) take
  // precedence over every per-view surface because they claim the
  // panel's full width via the help-overlay layout branch.
  if (state.showHelp) {
    return renderHelpPanel(h, components, state, width, theme, focused, bodyRows)
  }

  // #1137 — the `g?` which-key strip lists the current view's single-key
  // actions. Checked alongside the other overlays; the reducer keeps it
  // mutually exclusive with help / palette / pickers.
  if (state.showViewKeys) {
    return renderViewKeysOverlay(h, components, state, width, theme, focused)
  }

  if (state.showCommandPalette) {
    return renderCommandPalette(h, components, state, width, theme, focused)
  }

  if (state.showThemePicker) {
    return renderThemePickerOverlay(h, components, state.themePickerFilter, state.themePickerIndex, width, theme, focused)
  }

  if (state.gitignorePicker) {
    return renderGitignorePickerOverlay(h, components, state.gitignorePicker.file, state.gitignorePicker.index, width, theme, focused)
  }

  if (state.inputPrompt) {
    return renderInputPromptPanel(h, components, state, width, theme, focused)
  }

  if (state.pendingChoice) {
    return renderChoicePanel(h, components, state.pendingChoice, width, theme, focused)
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
