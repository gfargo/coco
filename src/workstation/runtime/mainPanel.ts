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
import { renderFileHistorySurface, type FileHistorySurfaceData } from '../surfaces/fileHistory'
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
import { defineSurfaceComponent, useSurfaceRenderContext } from './runtimeContext'
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
 * Single-extra surfaces (#1237 surface migration) — their renderer needs
 * the base {@link SurfaceRenderContext} plus exactly one per-render async
 * slice (a spinner frame, diff data, blame data, a bisect candidate). The
 * slice stays a component **prop** rather than moving into context, so it
 * remains the per-surface boundary; the rest is read from
 * `LogInkRuntimeContext` via {@link useSurfaceRenderContext}. All cached
 * per process, like the zero-extra set.
 */

// Spinner-driven surfaces all share the `{ spinnerFrame }` prop shape, so
// they group like the zero-extra set (keyed by `state.activeView`).
let cachedSpinnerComponents: Partial<Record<string, ReactTypes.FC<{ spinnerFrame: number }>>> | null = null
function spinnerSurfaceComponent(
  React: typeof ReactTypes,
  view: string
): ReactTypes.FC<{ spinnerFrame: number }> | undefined {
  if (!cachedSpinnerComponents) {
    const make = (
      renderSurface: (ctx: SurfaceRenderContext, spinnerFrame: number) => ReactTypes.ReactElement,
      displayName: string
    ): ReactTypes.FC<{ spinnerFrame: number }> => {
      const Component: ReactTypes.FC<{ spinnerFrame: number }> = ({ spinnerFrame }) =>
        renderSurface(useSurfaceRenderContext(React, 'main'), spinnerFrame)
      Component.displayName = displayName
      return Component
    }
    cachedSpinnerComponents = {
      compose: make(renderComposeSurface, 'ComposeSurface'),
      branches: make(renderBranchesSurface, 'BranchesSurface'),
      tags: make(renderTagsSurface, 'TagsSurface'),
      stash: make(renderStashSurface, 'StashSurface'),
      worktrees: make(renderWorktreesSurface, 'WorktreesSurface'),
    }
  }
  return cachedSpinnerComponents[view]
}

let cachedDiffComponent: ReactTypes.FC<{ diff: DiffSurfaceData }> | null = null
function diffSurfaceComponent(React: typeof ReactTypes): ReactTypes.FC<{ diff: DiffSurfaceData }> {
  if (!cachedDiffComponent) {
    const Component: ReactTypes.FC<{ diff: DiffSurfaceData }> = ({ diff }) =>
      renderDiffSurface(useSurfaceRenderContext(React, 'main'), diff)
    Component.displayName = 'DiffSurface'
    cachedDiffComponent = Component
  }
  return cachedDiffComponent
}

type BisectComponentProps = {
  candidateDetail: GitCommitDetail | undefined
  candidateLoading: boolean
}
let cachedBisectComponent: ReactTypes.FC<BisectComponentProps> | null = null
function bisectSurfaceComponent(React: typeof ReactTypes): ReactTypes.FC<BisectComponentProps> {
  if (!cachedBisectComponent) {
    const Component: ReactTypes.FC<BisectComponentProps> = ({ candidateDetail, candidateLoading }) =>
      renderBisectSurface(useSurfaceRenderContext(React, 'main'), candidateDetail, candidateLoading)
    Component.displayName = 'BisectSurface'
    cachedBisectComponent = Component
  }
  return cachedBisectComponent
}

let cachedBlameComponent: ReactTypes.FC<{ data: BlameSurfaceData }> | null = null
function blameSurfaceComponent(React: typeof ReactTypes): ReactTypes.FC<{ data: BlameSurfaceData }> {
  if (!cachedBlameComponent) {
    const Component: ReactTypes.FC<{ data: BlameSurfaceData }> = ({ data }) =>
      renderBlameSurface(useSurfaceRenderContext(React, 'main'), data)
    Component.displayName = 'BlameSurface'
    cachedBlameComponent = Component
  }
  return cachedBlameComponent
}

let cachedFileHistoryComponent: ReactTypes.FC<{ data: FileHistorySurfaceData }> | null = null
function fileHistorySurfaceComponent(
  React: typeof ReactTypes,
): ReactTypes.FC<{ data: FileHistorySurfaceData }> {
  if (!cachedFileHistoryComponent) {
    const Component: ReactTypes.FC<{ data: FileHistorySurfaceData }> = ({ data }) =>
      renderFileHistorySurface(useSurfaceRenderContext(React, 'main'), data)
    Component.displayName = 'FileHistorySurface'
    cachedFileHistoryComponent = Component
  }
  return cachedFileHistoryComponent
}

/**
 * History surface (#1237) — the dispatcher's default view and its highest
 * fan-in: pagination flags, layout density / row mode, date-bucketing, and
 * the spinner frame. All ride as component props; the rest is read from
 * context. `now` keeps its render-time default (the component doesn't
 * thread it), matching the previous `undefined` positional arg.
 */
type HistoryComponentProps = {
  hasMoreCommits: boolean
  loadingMoreCommits: boolean
  density: LogInkLayoutDensity
  rowMode: 'single' | 'stacked'
  dateBucketingEnabled: boolean
  spinnerFrame: number
}
let cachedHistoryComponent: ReactTypes.FC<HistoryComponentProps> | null = null
function historySurfaceComponent(React: typeof ReactTypes): ReactTypes.FC<HistoryComponentProps> {
  if (!cachedHistoryComponent) {
    const Component: ReactTypes.FC<HistoryComponentProps> = (props) =>
      renderHistoryPanel(
        useSurfaceRenderContext(React, 'main'),
        props.hasMoreCommits,
        props.loadingMoreCommits,
        props.density,
        props.rowMode,
        props.dateBucketingEnabled,
        undefined,
        props.spinnerFrame
      )
    Component.displayName = 'HistorySurface'
    cachedHistoryComponent = Component
  }
  return cachedHistoryComponent
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
  /** Cached file history for `state.fileHistoryPath` (#COCO-14). Undefined on a cache miss. */
  fileHistory: FileHistorySurfaceData['history']
  /** True while the on-demand file-history hydration is in flight (#COCO-14). */
  fileHistoryLoading: boolean
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
    fileHistory,
    fileHistoryLoading,
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
    return h(diffSurfaceComponent(React), { diff: diffData })
  }

  if (state.activeView === 'compose') {
    return h(spinnerSurfaceComponent(React, 'compose')!, { spinnerFrame })
  }

  if (state.activeView === 'branches') {
    return h(spinnerSurfaceComponent(React, 'branches')!, { spinnerFrame })
  }

  if (state.activeView === 'tags') {
    return h(spinnerSurfaceComponent(React, 'tags')!, { spinnerFrame })
  }

  if (state.activeView === 'reflog') {
    return h(zeroExtraComponent(React, 'reflog')!)
  }

  if (state.activeView === 'bisect') {
    return h(bisectSurfaceComponent(React), {
      candidateDetail: bisectCandidateDetail,
      candidateLoading: bisectCandidateLoading,
    })
  }

  if (state.activeView === 'stash') {
    return h(spinnerSurfaceComponent(React, 'stash')!, { spinnerFrame })
  }

  if (state.activeView === 'worktrees') {
    return h(spinnerSurfaceComponent(React, 'worktrees')!, { spinnerFrame })
  }

  if (state.activeView === 'submodules') {
    return h(zeroExtraComponent(React, 'submodules')!)
  }

  if (state.activeView === 'remotes') {
    return h(zeroExtraComponent(React, 'remotes')!)
  }

  if (state.activeView === 'blame') {
    return h(blameSurfaceComponent(React), { data: { blame, loading: blameLoading } })
  }

  if (state.activeView === 'file-history') {
    return h(fileHistorySurfaceComponent(React), {
      data: { history: fileHistory, loading: fileHistoryLoading },
    })
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

  return h(historySurfaceComponent(React), {
    hasMoreCommits,
    loadingMoreCommits,
    density,
    rowMode,
    dateBucketingEnabled,
    spinnerFrame,
  })
}
