/**
 * Main-panel dispatcher. Routes to the right per-surface renderer
 * based on `state.activeView`. The dispatch is intentionally a flat
 * switch — every view is a peer here, no fall-through ordering matters
 * except the final `renderHistoryPanel` default.
 *
 * Extracted from `src/commands/log/inkRuntime.ts` as part of phase 5a.7
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
import { renderStashSurface } from '../surfaces/stash'
import { renderStatusSurface } from '../surfaces/status'
import { renderSubmodulesSurface } from '../surfaces/submodules'
import { renderTagsSurface } from '../surfaces/tags'
import { renderWorktreesSurface } from '../surfaces/worktrees'
import type { SurfaceRenderContext } from './types'

export function renderMainPanel(
  surface: SurfaceRenderContext,
  worktreeDiff: WorktreeFileDiff | undefined,
  worktreeDiffLoading: boolean,
  worktreeHunks: WorktreeHunkOverview | undefined,
  worktreeHunksLoading: boolean,
  filePreview: GitCommitFilePreview | undefined,
  filePreviewLoading: boolean,
  commitDiffHunkOffsets: number[] | undefined,
  selectedDetailFile: GitCommitDetail['files'][number] | undefined,
  stashDiffLines: string[] | undefined,
  stashDiffLoading: boolean,
  compareDiffLines: string[] | undefined,
  compareDiffLoading: boolean,
  bisectCandidateDetail: GitCommitDetail | undefined,
  bisectCandidateLoading: boolean,
  hasMoreCommits: boolean,
  loadingMoreCommits: boolean,
  spinnerFrame: number,
  density: LogInkLayoutDensity,
  rowMode: 'single' | 'stacked',
  dateBucketingEnabled: boolean,
  syntaxSpans?: Map<string, SyntaxSpan[]>
): ReactTypes.ReactElement {
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
    return renderStatusSurface(surface)
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
    return renderBranchesSurface(surface)
  }

  if (state.activeView === 'tags') {
    return renderTagsSurface(surface)
  }

  if (state.activeView === 'reflog') {
    return renderReflogSurface(surface)
  }

  if (state.activeView === 'bisect') {
    return renderBisectSurface(surface, bisectCandidateDetail, bisectCandidateLoading)
  }

  if (state.activeView === 'stash') {
    return renderStashSurface(surface)
  }

  if (state.activeView === 'worktrees') {
    return renderWorktreesSurface(surface)
  }

  if (state.activeView === 'submodules') {
    return renderSubmodulesSurface(surface)
  }

  if (state.activeView === 'pull-request') {
    return renderPullRequestSurface(surface)
  }

  if (state.activeView === 'pull-request-triage') {
    return renderPullRequestTriageSurface(surface)
  }

  if (state.activeView === 'issues') {
    return renderIssuesTriageSurface(surface)
  }

  if (state.activeView === 'conflicts') {
    return renderConflictsSurface(surface)
  }

  if (state.activeView === 'changelog') {
    return renderChangelogSurface(surface)
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
