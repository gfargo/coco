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
import type { LogInkState } from '../../commands/log/inkViewModel'
import {
  renderBranchPreviewPanel,
  renderCommitDiffDetail,
  renderCommitPanel,
  renderComposeContextPanel,
  renderHistoryInspector,
  renderStashPreviewPanel,
  renderTagPreviewPanel,
} from '../surfaces/detail'
import {
  renderChordOverlay,
  renderCommandPalette,
  renderConfirmationPanel,
  renderHelpPanel,
  renderInputPromptPanel,
  renderSplitPlanOverlay,
} from './overlays'
import type { LogInkComponents, LogInkContext } from './types'

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
  theme: LogInkTheme
): ReactTypes.ReactElement {
  const focused = state.focus === 'detail'

  if (state.showHelp) {
    return renderHelpPanel(h, components, state, width, theme, focused)
  }

  // Split-plan overlay (#907) sits above the regular palette/input/
  // confirmation flow because the underlying input handler already
  // intercepts all keystrokes while it's open — only the rendering
  // needs to match. Bound by `bodyRows` so the scroll/clamp math has
  // a real viewport; falls back to a sensible minimum elsewhere.
  if (state.splitPlan) {
    // Use the same height heuristic the diff/changelog surfaces use —
    // detail panel body is roughly the panel width column count, but
    // we don't have that here. Pass a permissive default; the overlay
    // computes its own visible-line window from listRows.
    return renderSplitPlanOverlay(h, components, state, width, 24, theme, focused)
  }

  if (state.showCommandPalette) {
    return renderCommandPalette(h, components, state, width, theme, focused)
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
  if (state.pendingKey) {
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

  return renderHistoryInspector(
    h, components, state, context, contextStatus, detail, loading,
    filePreview, filePreviewLoading, width, tabbed, theme, focused
  )
}
