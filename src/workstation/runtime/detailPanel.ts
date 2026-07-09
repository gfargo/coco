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
import { useSurfaceRenderContext } from './runtimeContext'
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

/**
 * Detail-panel surface components (#1237 surface migration). The detail
 * renderers keep their positional signatures (and their colocated
 * render-snapshot suites) unchanged; these thin wrappers read the base
 * context via {@link useSurfaceRenderContext} (panel `'detail'`, so the
 * detail width resolves correctly) and call the renderer, deriving
 * `focused` from `state.focus === 'detail'` exactly as the dispatcher did.
 * The overlays (help / palette / pickers / confirmation / chord) stay
 * positional — a separate, transient concern. All cached per process.
 */

// The eight preview/context panels share one positional signature, so they
// group like the main panel's zero-extra set.
type CoreDetailRenderer = (
  h: typeof ReactTypes.createElement,
  components: SurfaceRenderContext['components'],
  state: SurfaceRenderContext['state'],
  context: SurfaceRenderContext['context'],
  contextStatus: SurfaceRenderContext['contextStatus'],
  width: number,
  theme: SurfaceRenderContext['theme'],
  focused: boolean
) => ReactTypes.ReactElement

let cachedCoreDetailComponents: Partial<Record<string, ReactTypes.FC>> | null = null
function coreDetailComponent(React: typeof ReactTypes, key: string): ReactTypes.FC | undefined {
  if (!cachedCoreDetailComponents) {
    const make = (render: CoreDetailRenderer, displayName: string): ReactTypes.FC => {
      const Component: ReactTypes.FC = () => {
        const { h, components, state, context, contextStatus, width, theme } =
          useSurfaceRenderContext(React, 'detail')
        return render(h, components, state, context, contextStatus, width, theme, state.focus === 'detail')
      }
      Component.displayName = displayName
      return Component
    }
    cachedCoreDetailComponents = {
      commit: make(renderCommitPanel, 'CommitPanel'),
      composeContext: make(renderComposeContextPanel, 'ComposeContextPanel'),
      branchPreview: make(renderBranchPreviewPanel, 'BranchPreviewPanel'),
      tagPreview: make(renderTagPreviewPanel, 'TagPreviewPanel'),
      stashPreview: make(renderStashPreviewPanel, 'StashPreviewPanel'),
      submodulePreview: make(renderSubmodulePreviewPanel, 'SubmodulePreviewPanel'),
      issuePreview: make(renderIssueTriagePreviewPanel, 'IssueTriagePreviewPanel'),
      prPreview: make(renderPullRequestTriagePreviewPanel, 'PullRequestTriagePreviewPanel'),
    }
  }
  return cachedCoreDetailComponents[key]
}

type CommitDiffProps = { detail: GitCommitDetail | undefined; loading: boolean }
let cachedCommitDiffComponent: ReactTypes.FC<CommitDiffProps> | null = null
function commitDiffDetailComponent(React: typeof ReactTypes): ReactTypes.FC<CommitDiffProps> {
  if (!cachedCommitDiffComponent) {
    const Component: ReactTypes.FC<CommitDiffProps> = ({ detail, loading }) => {
      const { h, components, state, width, theme } = useSurfaceRenderContext(React, 'detail')
      return renderCommitDiffDetail(h, components, state, detail, loading, width, theme, state.focus === 'detail')
    }
    Component.displayName = 'CommitDiffDetail'
    cachedCommitDiffComponent = Component
  }
  return cachedCommitDiffComponent
}

type HistoryInspectorProps = {
  detail: GitCommitDetail | undefined
  loading: boolean
  filePreview: GitCommitFilePreview | undefined
  filePreviewLoading: boolean
  tabbed: boolean
}
let cachedHistoryInspectorComponent: ReactTypes.FC<HistoryInspectorProps> | null = null
function historyInspectorComponent(React: typeof ReactTypes): ReactTypes.FC<HistoryInspectorProps> {
  if (!cachedHistoryInspectorComponent) {
    const Component: ReactTypes.FC<HistoryInspectorProps> = (props) => {
      const { h, components, state, context, contextStatus, width, theme } =
        useSurfaceRenderContext(React, 'detail')
      return renderHistoryInspector(
        h, components, state, context, contextStatus, props.detail, props.loading,
        props.filePreview, props.filePreviewLoading, width, props.tabbed, theme, state.focus === 'detail'
      )
    }
    Component.displayName = 'HistoryInspector'
    cachedHistoryInspectorComponent = Component
  }
  return cachedHistoryInspectorComponent
}

export function renderDetailPanel(
  React: typeof ReactTypes,
  surface: SurfaceRenderContext,
  extras: DetailPanelExtras
): ReactTypes.ReactElement {
  // Only the values the overlay branches still need positionally are
  // destructured here; the per-view detail surfaces self-serve the rest
  // from LogInkRuntimeContext via their components (#1237).
  const { h, components, state, bodyRows, width, theme } = surface
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

  if (state.pendingConfirmationId) {
    return renderConfirmationPanel(h, components, state, surface.context, width, theme, focused)
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
    return h(coreDetailComponent(React, 'composeContext')!)
  }

  // Status + worktree-sourced diff keep the staging compose panel — it's
  // the action surface for stage / hunk / commit. Commit-sourced diff (from
  // history → Enter) gets a dedicated explore panel: subject, body, and a
  // navigable file list whose selection swaps the center diff.
  if (state.activeView === 'status') {
    return h(coreDetailComponent(React, 'commit')!)
  }

  if (state.activeView === 'diff') {
    if (state.diffSource === 'commit') {
      return h(commitDiffDetailComponent(React), { detail, loading })
    }
    // PR-sourced diff (#1363): keep the triage preview pane alongside
    // the patch — the cursored triage row is the PR being viewed
    // (`navigateOpenDiffForPullRequest` syncs the index), so the panel
    // shows the PR's metadata / checks instead of a stale commit
    // inspector.
    if (state.diffSource === 'pr') {
      return h(coreDetailComponent(React, 'prPreview')!)
    }
    return h(coreDetailComponent(React, 'commit')!)
  }

  // Compose view: the right panel had been falling through to the inspector
  // and showing the last selected commit's data, which is wrong context for
  // an in-progress commit. Show the worktree summary instead.
  if (state.activeView === 'compose') {
    return h(coreDetailComponent(React, 'composeContext')!)
  }

  // Preview pane (P4.1) — fzf / yazi / lazygit style: branches, tags, and
  // stash views each get a tailored summary of the selected entry instead
  // of falling through to the (stale) history inspector.
  if (state.activeView === 'branches') {
    return h(coreDetailComponent(React, 'branchPreview')!)
  }
  if (state.activeView === 'tags') {
    return h(coreDetailComponent(React, 'tagPreview')!)
  }
  if (state.activeView === 'stash') {
    return h(coreDetailComponent(React, 'stashPreview')!)
  }

  if (state.activeView === 'submodules') {
    return h(coreDetailComponent(React, 'submodulePreview')!)
  }

  if (state.activeView === 'issues') {
    return h(coreDetailComponent(React, 'issuePreview')!)
  }

  if (state.activeView === 'pull-request-triage') {
    return h(coreDetailComponent(React, 'prPreview')!)
  }

  return h(historyInspectorComponent(React), {
    detail,
    loading,
    filePreview,
    filePreviewLoading,
    tabbed,
  })
}
