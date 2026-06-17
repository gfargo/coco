/**
 * Main-panel dispatcher. Routes to the right per-surface renderer
 * based on `state.activeView`. The dispatch is intentionally a flat
 * switch — every view is a peer here, no fall-through ordering matters
 * except the final `renderHistoryPanel` default.
 *
 * Extracted from `src/workstation/runtime/inkRuntime.ts` as part of phase 5a.7
 * of #890. No behavior change.
 */

import type * as ReactTypes from 'react'
import type { LogInkLayoutDensity } from '../chrome/layout'
import type {
  GitCommitDetail,
  GitCommitFilePreview,
} from '../../commands/log/data'
import type { WorktreeHunkOverview } from '../../git/statusHunks'
import type { WorktreeFileDiff } from '../../git/worktreeDiffData'
import type { SyntaxSpan } from '../../lib/syntax/highlightEngine'
import { renderBisectSurface } from '../surfaces/bisect'
import { renderBlameSurface, type BlameSurfaceData } from '../surfaces/blame'
import { renderBranchesSurface } from '../surfaces/branches'
import { renderChangelogSurface } from '../surfaces/changelog'
import { renderComposeSurface } from '../surfaces/compose'
import { renderConflictsSurface } from '../surfaces/conflicts'
import { renderDiffSurface, type DiffSurfaceData } from '../surfaces/diff'
import { renderHistoryPanel } from '../surfaces/history'
import { renderSplitPlanOverlay } from './overlays'
import { renderIssuesTriageSurface } from '../surfaces/issuesTriage'
import { renderPullRequestSurface } from '../surfaces/pullRequest'
import { renderPullRequestTriageSurface } from '../surfaces/pullRequestTriage'
import { renderReflogSurface } from '../surfaces/reflog'
import { renderRemotesSurface } from '../surfaces/remotes'
import { renderStashSurface } from '../surfaces/stash'
import { renderStatusSurface } from '../surfaces/status'
import { renderSubmodulesSurface } from '../surfaces/submodules'
import { renderTagsSurface } from '../surfaces/tags'
import { renderWorktreesSurface } from '../surfaces/worktrees'
import { defineSurfaceComponent } from './runtimeContext'
import type { SurfaceRenderContext } from './types'

/**
 * Zero-extra surfaces (#1237 surface migration) — those whose renderer
 * needs only the base {@link SurfaceRenderContext}, no per-render async
 * slice. Each is wrapped once into a thin component that self-serves
 * state / theme / context from `LogInkRuntimeContext`, so the dispatcher
 * mounts `h(Component)` instead of calling the render fn inline and
 * threading `surface` down. Cached per process (one React instance), so
 * the component identity stays stable across renders.
 *
 * Keyed by `state.activeView`. Surfaces that also need an async slice
 * (diff data, spinner frames, pagination) are not here — they migrate to
 * bespoke components in later PRs and stay regular calls for now.
 */
let cachedZeroExtraComponents: Partial<Record<string, ReactTypes.FC>> | null = null
function zeroExtraComponent(
  React: typeof ReactTypes,
  view: string
): ReactTypes.FC | undefined {
  if (!cachedZeroExtraComponents) {
    const define = (
      renderSurface: (ctx: SurfaceRenderContext) => ReactTypes.ReactElement,
      displayName: string
    ): ReactTypes.FC => defineSurfaceComponent(React, renderSurface, { displayName })
    cachedZeroExtraComponents = {
      status: define(renderStatusSurface, 'StatusSurface'),
      reflog: define(renderReflogSurface, 'ReflogSurface'),
      submodules: define(renderSubmodulesSurface, 'SubmodulesSurface'),
      remotes: define(renderRemotesSurface, 'RemotesSurface'),
      'pull-request': define(renderPullRequestSurface, 'PullRequestSurface'),
      'pull-request-triage': define(renderPullRequestTriageSurface, 'PullRequestTriageSurface'),
      issues: define(renderIssuesTriageSurface, 'IssuesTriageSurface'),
      conflicts: define(renderConflictsSurface, 'ConflictsSurface'),
      changelog: define(renderChangelogSurface, 'ChangelogSurface'),
    }
  }
  return cachedZeroExtraComponents[view]
}

/**
 * The per-surface render slices the main-panel dispatcher threads through to
 * the active surface. Bundled into one object (#0.68) so `renderMainPanel` is a
 * two-argument call (`surface` + `extras`) instead of 22 positional params — the
 * old signature made call-site edits error-prone and obscured which value fed
 * which surface.
 */
export type MainPanelExtras = {
  worktreeDiff: WorktreeFileDiff | undefined
  worktreeDiffLoading: boolean
  worktreeHunks: WorktreeHunkOverview | undefined
  worktreeHunksLoading: boolean
  filePreview: GitCommitFilePreview | undefined
  filePreviewLoading: boolean
  commitDiffHunkOffsets: number[] | undefined
  selectedDetailFile: GitCommitDetail['files'][number] | undefined
  stashDiffLines: string[] | undefined
  stashDiffLoading: boolean
  compareDiffLines: string[] | undefined
  compareDiffLoading: boolean
  bisectCandidateDetail: GitCommitDetail | undefined
  bisectCandidateLoading: boolean
  /** Cached blame for `state.blamePath` (#0.71). Undefined on a cache miss. */
  blame: BlameSurfaceData['blame']
  /** True while the on-demand blame hydration is in flight (#0.71). */
  blameLoading: boolean
  hasMoreCommits: boolean
  loadingMoreCommits: boolean
  spinnerFrame: number
  density: LogInkLayoutDensity
  rowMode: 'single' | 'stacked'
  dateBucketingEnabled: boolean
  syntaxSpans?: Map<string, SyntaxSpan[]>
}

export function renderMainPanel(
  React: typeof ReactTypes,
  surface: SurfaceRenderContext,
  extras: MainPanelExtras
): ReactTypes.ReactElement {
  const {
    worktreeDiff,
    worktreeDiffLoading,
    worktreeHunks,
    worktreeHunksLoading,
    filePreview,
    filePreviewLoading,
    commitDiffHunkOffsets,
    selectedDetailFile,
    stashDiffLines,
    stashDiffLoading,
    compareDiffLines,
    compareDiffLoading,
    bisectCandidateDetail,
    bisectCandidateLoading,
    blame,
    blameLoading,
    hasMoreCommits,
    loadingMoreCommits,
    spinnerFrame,
    density,
    rowMode,
    dateBucketingEnabled,
    syntaxSpans,
  } = extras
  // The universal render values now arrive bundled (#1136); only the
  // few raw values the dispatcher itself touches (split-plan overlay,
  // activeView switch) are destructured here. Surfaces receive `surface`
  // directly plus their own slices.
  const { h, components, state, bodyRows, width, theme } = surface

  // Split-plan overlay (#907 polish): renders in the MAIN panel (not
  // detail) when active, because the content — multiple commit groups
  // with file lists, rationale, hunks — needs the full center width
  // to be readable. The detail panel is too narrow for prose lists.
  // Overlay sits at the top of dispatch so it pre-empts every regular
  // view; the input handler already intercepts all keystrokes while
  // `state.splitPlan` is set, so the underlying view is dormant.
  if (state.splitPlan) {
    return renderSplitPlanOverlay(h, components, state, width, bodyRows, theme, true, spinnerFrame)
  }

  if (state.activeView === 'status') {
    return h(zeroExtraComponent(React, 'status')!)
  }

  if (state.activeView === 'diff') {
    const diffData: DiffSurfaceData = {
      worktreeDiff,
      worktreeDiffLoading,
      worktreeHunks,
      worktreeHunksLoading,
      filePreview,
      filePreviewLoading,
      commitDiffHunkOffsets,
      selectedDetailFile,
      stashDiffLines,
      stashDiffLoading,
      compareDiffLines,
      compareDiffLoading,
      syntaxSpans,
    }
    return renderDiffSurface(surface, diffData)
  }

  if (state.activeView === 'compose') {
    return renderComposeSurface(surface, spinnerFrame)
  }

  if (state.activeView === 'branches') {
    return renderBranchesSurface(surface, spinnerFrame)
  }

  if (state.activeView === 'tags') {
    return renderTagsSurface(surface, spinnerFrame)
  }

  if (state.activeView === 'reflog') {
    return h(zeroExtraComponent(React, 'reflog')!)
  }

  if (state.activeView === 'bisect') {
    return renderBisectSurface(surface, bisectCandidateDetail, bisectCandidateLoading)
  }

  if (state.activeView === 'stash') {
    return renderStashSurface(surface, spinnerFrame)
  }

  if (state.activeView === 'worktrees') {
    return renderWorktreesSurface(surface, spinnerFrame)
  }

  if (state.activeView === 'submodules') {
    return h(zeroExtraComponent(React, 'submodules')!)
  }

  if (state.activeView === 'remotes') {
    return h(zeroExtraComponent(React, 'remotes')!)
  }

  if (state.activeView === 'blame') {
    return renderBlameSurface(surface, { blame, loading: blameLoading })
  }

  if (state.activeView === 'pull-request') {
    return h(zeroExtraComponent(React, 'pull-request')!)
  }

  if (state.activeView === 'pull-request-triage') {
    return h(zeroExtraComponent(React, 'pull-request-triage')!)
  }

  if (state.activeView === 'issues') {
    return h(zeroExtraComponent(React, 'issues')!)
  }

  if (state.activeView === 'conflicts') {
    return h(zeroExtraComponent(React, 'conflicts')!)
  }

  if (state.activeView === 'changelog') {
    return h(zeroExtraComponent(React, 'changelog')!)
  }

  return renderHistoryPanel(
    surface,
    hasMoreCommits,
    loadingMoreCommits,
    density,
    rowMode,
    dateBucketingEnabled,
    undefined,
    spinnerFrame
  )
}
