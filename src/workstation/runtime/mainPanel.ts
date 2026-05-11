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
import type { LogInkContextStatus } from '../chrome/context'
import type { LogInkTheme } from '../chrome/theme'
import type {
  GitCommitDetail,
  GitCommitFilePreview,
} from '../../commands/log/data'
import type { LogInkState } from '../../commands/log/inkViewModel'
import type { WorktreeHunkOverview } from '../../git/statusHunks'
import type { WorktreeFileDiff } from '../../git/worktreeDiffData'
import { renderBisectSurface } from '../surfaces/bisect'
import { renderBranchesSurface } from '../surfaces/branches'
import { renderChangelogSurface } from '../surfaces/changelog'
import { renderComposeSurface } from '../surfaces/compose'
import { renderConflictsSurface } from '../surfaces/conflicts'
import { renderDiffSurface } from '../surfaces/diff'
import { renderHistoryPanel } from '../surfaces/history'
import { renderPullRequestSurface } from '../surfaces/pullRequest'
import { renderReflogSurface } from '../surfaces/reflog'
import { renderStashSurface } from '../surfaces/stash'
import { renderStatusSurface } from '../surfaces/status'
import { renderTagsSurface } from '../surfaces/tags'
import { renderWorktreesSurface } from '../surfaces/worktrees'
import type { LogInkComponents, LogInkContext } from './types'

export function renderMainPanel(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  context: LogInkContext,
  contextStatus: LogInkContextStatus,
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
  bodyRows: number,
  width: number,
  theme: LogInkTheme,
  hasMoreCommits: boolean,
  loadingMoreCommits: boolean
): ReactTypes.ReactElement {
  if (state.activeView === 'status') {
    return renderStatusSurface(h, components, state, context, contextStatus, bodyRows, width, theme)
  }

  if (state.activeView === 'diff') {
    return renderDiffSurface(
      h,
      components,
      state,
      context,
      contextStatus,
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
      bodyRows,
      width,
      theme
    )
  }

  if (state.activeView === 'compose') {
    return renderComposeSurface(h, components, state, context, contextStatus, bodyRows, width, theme)
  }

  if (state.activeView === 'branches') {
    return renderBranchesSurface(h, components, state, context, contextStatus, bodyRows, width, theme)
  }

  if (state.activeView === 'tags') {
    return renderTagsSurface(h, components, state, context, contextStatus, bodyRows, width, theme)
  }

  if (state.activeView === 'reflog') {
    return renderReflogSurface(h, components, state, context, contextStatus, bodyRows, width, theme)
  }

  if (state.activeView === 'bisect') {
    return renderBisectSurface(h, components, state, context, contextStatus, bisectCandidateDetail, bisectCandidateLoading, bodyRows, width, theme)
  }

  if (state.activeView === 'stash') {
    return renderStashSurface(h, components, state, context, contextStatus, bodyRows, width, theme)
  }

  if (state.activeView === 'worktrees') {
    return renderWorktreesSurface(h, components, state, context, contextStatus, bodyRows, width, theme)
  }

  if (state.activeView === 'pull-request') {
    return renderPullRequestSurface(h, components, state, context, contextStatus, bodyRows, width, theme)
  }

  if (state.activeView === 'conflicts') {
    return renderConflictsSurface(h, components, state, context, contextStatus, bodyRows, width, theme)
  }

  if (state.activeView === 'changelog') {
    return renderChangelogSurface(h, components, state, context, contextStatus, bodyRows, width, theme)
  }

  return renderHistoryPanel(
    h,
    components,
    state,
    context,
    bodyRows,
    width,
    theme,
    hasMoreCommits,
    loadingMoreCommits
  )
}
