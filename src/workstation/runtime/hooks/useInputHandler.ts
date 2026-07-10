/**
 * The keyboard input handler (extracted in the 0.72 app.ts decomposition,
 * the final big cluster). This module lifts the single `useInput((inputValue,
 * key) => { … })` block out of `app.ts` wholesale — the largest reader in the
 * component: it derives the per-keystroke filtered-list snapshots, assembles
 * the ~60-field input-context object passed to `getLogInkInputEvents`, and
 * then dispatches the returned events into the extracted action callbacks
 * (`runWorkflowAction`, the stage/revert/yank/changelog/PR/compose/editor/
 * commit-split actions) and the reducer.
 *
 * Discipline: the handler body is reproduced byte-for-byte from `app.ts`.
 * `useInput` is passed NO options argument in the original (the call ends
 * `})` — arrow function close + call paren), so none is passed here. To keep
 * the body verbatim, the big objects (`context`, `state`) are passed WHOLE —
 * so reads like `state.selectedBranchIndex` and `context.bisect?.active` are
 * unchanged from the original.
 *
 * `useInput` is ink's hook, injected from `app.ts` (the workstation never
 * statically imports `ink`). Calling it unconditionally inside this hook —
 * which is itself called unconditionally at the input handler's original slot
 * in `app.ts` — preserves ink's hook order exactly.
 *
 * The six pure helpers the handler calls (`getLogInkInputEvents`,
 * `getInspectorActionsForState`, `findStashFileForOffset`,
 * `getBisectCompletion`, `resolveCommitDiffDrillInTarget`,
 * `resolveSubmoduleViewDrillInTarget`) are used ONLY by this handler, so they
 * are imported directly here rather than threaded — `app.ts` drops them.
 * `enrichFilterActionWithRectification` stays a module helper in `app.ts`
 * (it shares a chain of filter-prediction helpers with no other consumer
 * here), so it is threaded in via the deps bag.
 *
 * The keystroke → `getLogInkInputEvents` → event-dispatch flow is unchanged;
 * correctness is covered by the existing `inkInput` test suite plus the
 * tsc-enforced deps bag (the closure reads every threaded value).
 */

import {
    LogInkInputKey,
    getInspectorActionsForState,
    getLogInkInputEvents,
} from '../inkInput'
import { findStashFileForOffset } from '../../../git/stashData'
import { getBisectCompletion } from '../../../git/bisectData'
import { planReflogUndo } from '../../../git/reflogActions'
import {
    resolveCommitDiffDrillInTarget,
    resolveSubmoduleViewDrillInTarget,
} from '../repoFrameDrillIn'
import {
    LOG_INK_DEFAULT_COLUMNS,
    LAYOUT_SINGLE_PANE_BELOW,
} from '../../chrome/layout'
import type { LogInkThemePreset } from '../../chrome/theme'
import type { CocoConfigScope } from '../configFiles'
import {
    GitCommitDetail,
    GitCommitFilePreview,
} from '../../../commands/log/data'
import { WorktreeFileDiff } from '../../../git/worktreeDiffData'
import {
    LogInkAction,
    LogInkState,
    getSelectedInkCommit,
} from '../inkViewModel'
import type { FilteredLists } from './buildFilteredLists'
import type { StatusSurfaceData } from './buildStatusSurfaceData'
import type { LogInkContext } from '../types'
import { getLogInkWorkflowActionById } from '../inkWorkflows'

export type UseInputHandlerDeps = {
  /** The reducer state — active view, selection indices, filter, diff source. */
  state: LogInkState
  /** The active frame's context — branch / tag / stash / submodule / etc. lists. */
  context: LogInkContext
  /** Reducer dispatch — drives the catch-all filter / navigation events. */
  dispatch: (action: LogInkAction) => void

  /** First-launch onboarding overlay flag + its dismiss (clears + persists). */
  showOnboarding: boolean
  dismissOnboarding: () => void

  /** Memoized filtered promoted-view lists (per-keystroke selection snapshots). */
  filteredBranchList: FilteredLists['filteredBranchList']
  filteredTagList: FilteredLists['filteredTagList']
  filteredStashList: FilteredLists['filteredStashList']
  filteredWorktreeList: FilteredLists['filteredWorktreeList']
  filteredReflogList: FilteredLists['filteredReflogList']
  filteredSubmoduleList: FilteredLists['filteredSubmoduleList']
  filteredRemoteList: FilteredLists['filteredRemoteList']
  filteredIssueList: FilteredLists['filteredIssueList']
  filteredPullRequestTriageList: FilteredLists['filteredPullRequestTriageList']

  /** Status-surface derived data (grouped worktree files + stash diff segmentation). */
  visibleWorktreeGroups: StatusSurfaceData['visibleWorktreeGroups']
  visibleWorktreeFilesGrouped: StatusSurfaceData['visibleWorktreeFilesGrouped']
  selectedWorktreeFile: StatusSurfaceData['selectedWorktreeFile']
  stashDiffParsedFiles: StatusSurfaceData['stashDiffParsedFiles']

  /** Active stash patch lines (drives the stash-diff preview path). */
  stashDiffLines: string[] | undefined
  /** Active PR patch lines (#1363 — drives the PR-diff preview path). */
  prDiffLines: string[] | undefined
  /** Per-file segmentation of the PR patch (#1363 — `[`/`]` file jump). */
  prDiffParsedFiles: StatusSurfaceData['stashDiffParsedFiles']
  /** Active commit-file diff preview (drives the commit-diff preview path). */
  filePreview: GitCommitFilePreview | undefined
  /** `@@`-header offsets within the commit-diff preview (hunk navigation). */
  commitDiffHunkOffsets: number[] | undefined
  /** Loaded commit detail (file list length / cursored file path). */
  detail: GitCommitDetail | undefined
  /** Cursored detail file (commit-diff target path resolution). */
  selectedDetailFile: GitCommitDetail['files'][number] | undefined
  /** Cursored history commit (commit-diff selected sha). */
  selected: ReturnType<typeof getSelectedInkCommit>
  /** Active worktree-file diff (line count / hunk offsets). */
  worktreeDiff: WorktreeFileDiff | undefined
  /** Absolute root of the active frame's repo (submodule drill-in resolution). */
  activeRepoRoot: string | undefined
  /** Whether the worktree has staged/unstaged/untracked changes. */
  worktreeDirty: boolean

  /** Terminal dimensions (single-pane gate). */
  windowSize: { columns: number; rows: number }

  /** ink app `exit()` (quit the TUI). */
  exit: () => void

  /** Loud / silent repository-context refresh. */
  refreshContext: (options?: { silent?: boolean }) => Promise<void>
  /** Re-fetch the history rows. */
  refreshHistoryRows: () => Promise<void>

  /** Worktree staging / revert callbacks (`useWorktreeStageActions`). */
  toggleSelectedFileStage: () => Promise<void>
  toggleSelectedHunkStage: () => Promise<void>
  revertSelectedFile: () => Promise<void>
  revertSelectedHunk: () => Promise<void>
  stageSelectedLines: () => Promise<void>
  revertSelectedLines: () => Promise<void>

  /** Commit compose callbacks (`useCommitComposeActions`). */
  createCommitFromCompose: () => Promise<void>
  openComposeInEditor: () => void

  /** AI commit draft callbacks (`useAiCommitDraftActions`). */
  runAiCommitDraft: () => Promise<void>
  cancelAiCommitDraft: () => void

  /** Pull-request callbacks (`usePullRequestActions`). */
  startCreatePullRequest: () => Promise<void>
  cancelPullRequestBodyDraft: () => void

  /** Changelog callbacks (`useChangelogActions`). */
  startChangelogView: (options?: { force?: boolean }) => Promise<void>
  cancelChangelog: () => void

  /** AI conflict-resolution callbacks (`useConflictResolutionActions`). */
  startConflictResolution: () => Promise<void>
  cancelConflictResolution: () => void
  acceptConflictProposal: () => Promise<void>
  acceptAllConflictProposals: () => Promise<void>
  editConflictProposal: () => Promise<void>
  startRebasePlan: () => Promise<void>
  regenerateChangelog: () => void
  yankChangelog: () => void
  openChangelogInEditor: () => void

  /** Clipboard callbacks (`useYankActions`). */
  yankText: (value: string, label: string) => Promise<void>
  yankFromActiveView: (short?: boolean) => Promise<void>

  /** Editor callbacks (`useEditorActions`). */
  openInEditor: (path: string) => void
  openConfigInEditor: (scope: CocoConfigScope) => void

  /** Commit-split callbacks (`useCommitSplitActions`). */
  startCommitSplit: () => Promise<void>
  applyCommitSplit: () => Promise<void>
  cancelCommitSplit: () => void

  /** The workflow-action dispatcher (`useWorkflowAction`). */
  runWorkflowAction: (id: string, payload?: string) => Promise<void>

  /** Theme session-preset setter (theme-picker apply). */
  setThemeSessionPreset: (preset: LogInkThemePreset | undefined) => void
  /** Best-effort global persist of a chosen theme preset. */
  saveThemePreset: (preset: LogInkThemePreset) => void

  /** Filter-action selection-rectification enricher (module helper in app.ts). */
  enrichFilterActionWithRectification: (
    action: LogInkAction,
    state: LogInkState,
    context: LogInkContext,
  ) => LogInkAction
}

/**
 * Install the keyboard input handler. `useInput` is ink's hook value,
 * injected from `app.ts`; this hook calls it unconditionally with the
 * verbatim handler body so ink's hook order is preserved.
 */
export function useInputHandler(
  useInput: (
    handler: (inputValue: string, key: LogInkInputKey) => void,
  ) => void,
  deps: UseInputHandlerDeps,
): void {
  const {
    state,
    context,
    dispatch,
    showOnboarding,
    dismissOnboarding,
    filteredBranchList,
    filteredTagList,
    filteredStashList,
    filteredWorktreeList,
    filteredReflogList,
    filteredSubmoduleList,
    filteredRemoteList,
    filteredIssueList,
    filteredPullRequestTriageList,
    visibleWorktreeGroups,
    visibleWorktreeFilesGrouped,
    selectedWorktreeFile,
    stashDiffParsedFiles,
    stashDiffLines,
    prDiffLines,
    prDiffParsedFiles,
    filePreview,
    commitDiffHunkOffsets,
    detail,
    selectedDetailFile,
    selected,
    worktreeDiff,
    activeRepoRoot,
    worktreeDirty,
    windowSize,
    exit,
    refreshContext,
    refreshHistoryRows,
    toggleSelectedFileStage,
    toggleSelectedHunkStage,
    revertSelectedFile,
    revertSelectedHunk,
    stageSelectedLines,
    revertSelectedLines,
    createCommitFromCompose,
    openComposeInEditor,
    runAiCommitDraft,
    cancelAiCommitDraft,
    startCreatePullRequest,
    cancelPullRequestBodyDraft,
    startChangelogView,
    cancelChangelog,
    startConflictResolution,
    cancelConflictResolution,
    acceptConflictProposal,
    acceptAllConflictProposals,
    editConflictProposal,
    startRebasePlan,
    regenerateChangelog,
    yankChangelog,
    openChangelogInEditor,
    yankText,
    yankFromActiveView,
    openInEditor,
    openConfigInEditor,
    startCommitSplit,
    applyCommitSplit,
    cancelCommitSplit,
    runWorkflowAction,
    setThemeSessionPreset,
    saveThemePreset,
    enrichFilterActionWithRectification,
  } = deps

  useInput((inputValue: string, key: LogInkInputKey) => {
    // First-launch onboarding (P1.3): any keystroke dismisses the overlay
    // and writes the seen-marker. Swallow the keystroke so the same key
    // doesn't also trigger normal input dispatch.
    if (showOnboarding) {
      dismissOnboarding()
      return
    }

    // P4.5: navigation in branches/tags/stash uses the FILTERED list
    // length when a filter is active so j/k stay live instead of getting
    // stuck against a full-list count that no longer matches what's on
    // screen. The filtered lists are memoized at LogInkApp scope (#808
    // perf pass) — reading them here is O(1) instead of O(branches +
    // tags + stashes + worktrees) per keystroke.
    const branchVisibleCount = filteredBranchList.length
    const branchSelectedShortName = filteredBranchList[
      Math.min(state.selectedBranchIndex, Math.max(0, filteredBranchList.length - 1))
    ]?.shortName
    // #1452 dual-write — id list in render order so moveBranch can
    // resolve the post-move target's id without re-sorting/re-filtering.
    const branchIds = filteredBranchList.map((b) => b.shortName)
    const tagVisibleCount = filteredTagList.length
    const tagSelectedName = filteredTagList[
      Math.min(state.selectedTagIndex, Math.max(0, filteredTagList.length - 1))
    ]?.name
    const tagIds = filteredTagList.map((t) => t.name)
    const stashVisibleCount = filteredStashList.length
    const stashSelectedRef = filteredStashList[
      Math.min(state.selectedStashIndex, Math.max(0, filteredStashList.length - 1))
    ]?.ref
    const stashIds = filteredStashList.map((s) => s.ref)
    const reflogVisibleCount = filteredReflogList.length
    const reflogSelectedHash = filteredReflogList[
      Math.min(state.selectedReflogIndex, Math.max(0, filteredReflogList.length - 1))
    ]?.hash
    // #1361 global undo — reads the RAW reflog (not filteredReflogList),
    // since undo always targets the actual last operation regardless of
    // what's filtered/cursored on the reflog view.
    const reflogUndoDescription = planReflogUndo(context.reflog?.entries || [])?.description
    const submoduleVisibleCount = filteredSubmoduleList.length
    const submoduleSelectedPath = filteredSubmoduleList[
      Math.min(state.selectedSubmoduleIndex, Math.max(0, filteredSubmoduleList.length - 1))
    ]?.path
    const remoteVisibleCount = filteredRemoteList.length
    const remoteSelectedName = filteredRemoteList[
      Math.min(state.selectedRemoteIndex, Math.max(0, filteredRemoteList.length - 1))
    ]?.name
    const issueVisibleCount = filteredIssueList.length
    const issueSelectedUrl = filteredIssueList[
      Math.min(state.selectedIssueIndex, Math.max(0, filteredIssueList.length - 1))
    ]?.url
    const pullRequestTriageVisibleCount = filteredPullRequestTriageList.length
    const pullRequestTriageSelected = filteredPullRequestTriageList[
      Math.min(state.selectedPullRequestTriageIndex, Math.max(0, filteredPullRequestTriageList.length - 1))
    ]
    const pullRequestTriageSelectedUrl = pullRequestTriageSelected?.url
    const pullRequestTriageSelectedNumber = pullRequestTriageSelected?.number
    const worktreeVisibleCount = filteredWorktreeList.length

    // When the diff view is showing a stash or PR patch, swap the
    // previewLineCount to that patch's length so the existing
    // pageDetailPreview path (j/k, PgUp/PgDn) scrolls through it
    // without a parallel pipeline.
    const diffPreviewLineCount = state.diffSource === 'stash'
      ? stashDiffLines?.length
      : state.diffSource === 'pr'
        ? prDiffLines?.length
        : filePreview?.hunks.length

    // Per-file segmentation for stash diffs reads the LogInkApp-scoped
    // memo so navigation keys + the input-context derivation share a
    // single parse pass per stash patch instead of re-walking the
    // entire patch text on every keystroke.
    const stashDiffFiles = state.diffSource === 'stash' ? stashDiffParsedFiles : []
    const stashDiffFileOffsets = stashDiffFiles.map((file) => file.startLine)
    const stashDiffSelectedPath = state.diffSource === 'stash'
      ? findStashFileForOffset(stashDiffFiles, state.diffPreviewOffset)?.path
      : undefined
    // #1363 — same segmentation for the PR patch, feeding the `[`/`]`
    // per-file jump on the PR diff. Distinct field (not overloading the
    // stash one) so the stash-only verbs (`c` cherry-pick, `o` open)
    // can't acquire a PR-diff target by accident.
    const prDiffFileOffsets = state.diffSource === 'pr'
      ? prDiffParsedFiles.map((file) => file.startLine)
      : []

    getLogInkInputEvents(state, inputValue, key, {
      // Narrow terminals show one pane at a time (#1135) — gates the `v`
      // peek key. Derived the same way the layout does, since `layout`
      // is computed later in the render path (not in this callback).
      singlePane:
        (windowSize.columns || process.stdout.columns || LOG_INK_DEFAULT_COLUMNS) <
        LAYOUT_SINGLE_PANE_BELOW,
      detailFileCount: detail?.files.length,
      previewLineCount: diffPreviewLineCount,
      worktreeDiffLineCount: worktreeDiff?.lines.length,
      worktreeFileCount: visibleWorktreeFilesGrouped.length,
      worktreeHunkOffsets: worktreeDiff?.hunkOffsets,
      commitDiffHunkOffsets,
      branchCount: branchVisibleCount,
      branchSelectedShortName,
      branchIds,
      // Current branch for the `r` rebase-onto guard + warning (#0.71).
      // Undefined on a detached HEAD, which the handler treats as "no
      // branch to rebase".
      currentBranch: context.branches?.currentBranch,
      tagCount: tagVisibleCount,
      tagSelectedName,
      tagIds,
      stashCount: stashVisibleCount,
      stashIds,
      reflogCount: reflogVisibleCount,
      reflogSelectedHash,
      reflogUndoDescription,
      submoduleCount: submoduleVisibleCount,
      submoduleSelectedPath,
      remoteCount: remoteVisibleCount,
      remoteSelectedName,
      // Drive j/k on the blame view off the cached line count for the
      // active path (#0.71); 0 while hydrating or on a failed blame, so
      // the nav handlers no-op until lines exist.
      blameLineCount: (() => {
        const blame = state.blamePath ? context.blameByPath?.get(state.blamePath) : undefined
        return blame && blame.ok ? blame.lines.length : 0
      })(),
      // File-history navigation context (#COCO-14). Commit count drives
      // j/k bounds; selectedHash carries the cursored commit's sha to
      // the Enter handler so it can call `navigateOpenDiffForCommit`.
      fileHistoryCommitCount: (() => {
        const fh = state.fileHistoryPath
          ? context.fileHistoryByPath?.get(state.fileHistoryPath)
          : undefined
        return fh && fh.ok ? fh.commits.length : 0
      })(),
      fileHistorySelectedHash: (() => {
        const fh = state.fileHistoryPath
          ? context.fileHistoryByPath?.get(state.fileHistoryPath)
          : undefined
        if (!fh || !fh.ok || fh.commits.length === 0) return undefined
        const idx = Math.max(0, Math.min(state.selectedFileHistoryIndex, fh.commits.length - 1))
        return fh.commits[idx]?.hash
      })(),
      issueCount: issueVisibleCount,
      issueSelectedUrl,
      pullRequestTriageCount: pullRequestTriageVisibleCount,
      pullRequestTriageSelectedUrl,
      pullRequestTriageSelectedNumber,
      stashSelectedRef,
      stashDiffFileOffsets: stashDiffFileOffsets.length ? stashDiffFileOffsets : undefined,
      stashDiffSelectedPath,
      prDiffFileOffsets: prDiffFileOffsets.length ? prDiffFileOffsets : undefined,
      worktreeListCount: worktreeVisibleCount,
      worktreeSelectedPath: visibleWorktreeFilesGrouped[state.selectedWorktreeFileIndex]?.path,
      statusGroups: visibleWorktreeGroups.map((group) => ({
        state: group.state as 'staged' | 'unstaged' | 'untracked',
        count: group.files.length,
        startIndex: group.startIndex,
      })),
      inspectorActionCount: getInspectorActionsForState(state).length,
      commitDiffSelectedPath: state.diffSource === 'commit'
        ? selectedDetailFile?.path
        : undefined,
      commitDiffSelectedSha: state.diffSource === 'commit'
        ? selected?.hash
        : undefined,
      // #931 PR 3b — Submodule drill-in target for the cursored file
      // in a commit diff. Resolved per-render so the Enter handler in
      // `inkInput.ts` doesn't have to re-walk the submodule overview;
      // undefined whenever the cursored file isn't a registered
      // submodule (or the overview / repo root haven't loaded yet).
      commitDiffSubmoduleDrillIn: state.diffSource === 'commit' && selectedDetailFile
        ? resolveCommitDiffDrillInTarget({
            selectedFile: {
              path: selectedDetailFile.path,
              submoduleChange: filePreview?.path === selectedDetailFile.path
                ? filePreview.submoduleChange
                : undefined,
            },
            submodules: context.submodules,
            activeRepoRoot,
          })
        : undefined,
      // #931 PR 4 / #932 — Submodule drill-in target for the cursored
      // row in the dedicated submodules view. Resolved per-render so
      // the Enter handler in `inkInput.ts` doesn't have to re-walk the
      // submodule overview. Gated on `activeView === 'submodules'` so
      // a stale resolution from a different view can't accidentally
      // fire — the runtime only ever populates it when the user is
      // actually on the view.
      submoduleViewDrillIn: state.activeView === 'submodules'
        ? resolveSubmoduleViewDrillInTarget({
            selectedIndex: state.selectedSubmoduleIndex,
            submodules: context.submodules,
            activeRepoRoot,
          })
        : undefined,
      worktreeDirty,
      conflictFileCount: context.operation?.conflictedFiles.length,
      conflictSelectedPath: (() => {
        const files = context.operation?.conflictedFiles
        if (!files || files.length === 0) return undefined
        const clamped = Math.min(state.selectedConflictFileIndex, files.length - 1)
        return files[clamped]?.path
      })(),
      // H / gH need the actual diff text (not just hunk offsets) to
      // slice the cursored hunk into a `git apply` patch. Stash uses
      // the full `git stash show -p` output; commit-diff uses the
      // per-file `filePreview.hunks` array. Either way, extractDiffHunk
      // walks `@@` headers and synthesizes a fresh diff --git / --- /
      // +++ header set using the path the caller already resolved.
      diffLinesForHunkApply: state.diffSource === 'stash'
        ? stashDiffLines
        : state.diffSource === 'commit'
          ? filePreview?.hunks
          : undefined,
      // Line count of the changelog text, used by the changelog view's
      // j/k/PgUp/PgDn scroll bindings to clamp `pageChangelog` deltas.
      // Computed from view state rather than threaded through context
      // because the surface owns its own content — no external loader.
      changelogLineCount: state.changelogView.text?.split('\n').length,
      // Approximate line count for the split-plan overlay. Each group
      // renders as a header + (body if any) + files block + (rationale
      // if any) + blank separator. Used by j/k/PgUp/PgDn to clamp the
      // scroll offset. The exact render math lives in the overlay
      // module — this is a close-enough heuristic for clamping.
      // #879 item 3 — short sha of the bisect terminator (if any).
      // Gates `y`/`Y` yank on the completion panel and lets the
      // runtime resolve the value without re-parsing the log.
      bisectCompletionSha: context.bisect?.active
        ? getBisectCompletion(context.bisect.log)?.sha
        : undefined,
      // #879 item 4 — disambiguates the bisect view's `s` keystroke
      // (skip current candidate vs. start the wizard).
      bisectActive: Boolean(context.bisect?.active),
      splitPlanLineCount: state.splitPlan?.plan
        ? state.splitPlan.plan.groups.reduce((sum, group) => {
          let lines = 2 // title + separator
          if (group.body) lines += group.body.split('\n').length + 1
          if (group.rationale) lines += 2
          lines += (group.files?.length || 0) + 1
          const hunkCount = group.hunks?.length || 0
          if (hunkCount > 0) lines += hunkCount + 1
          return sum + lines
        }, 0)
        : undefined,
    }).forEach((event) => {
      if (event.type === 'exit') {
        exit()
      } else if (event.type === 'refreshContext') {
        // The user-initiated refresh (`r`) refreshes BOTH the metadata
        // context (branches/tags/worktree) AND the commit rows. Without
        // the row re-fetch the history graph stays pinned to whatever
        // commits existed at boot — new commits (made in another
        // terminal, or remote commits brought in by a fetch) never
        // appear until relaunch, which reads as "the history is stuck."
        void refreshContext()
        void refreshHistoryRows()
      } else if (event.type === 'toggleSelectedFileStage') {
        void toggleSelectedFileStage()
      } else if (event.type === 'toggleSelectedHunkStage') {
        void toggleSelectedHunkStage()
      } else if (event.type === 'revertSelectedFile') {
        void revertSelectedFile()
      } else if (event.type === 'revertSelectedHunk') {
        void revertSelectedHunk()
      } else if (event.type === 'stageSelectedLines') {
        void stageSelectedLines()
      } else if (event.type === 'revertSelectedLines') {
        void revertSelectedLines()
      } else if (event.type === 'createManualCommit') {
        void createCommitFromCompose()
      } else if (event.type === 'runAiCommitDraft') {
        void runAiCommitDraft()
      } else if (event.type === 'cancelAiCommitDraft') {
        cancelAiCommitDraft()
      } else if (event.type === 'startCreatePullRequest') {
        void startCreatePullRequest()
      } else if (event.type === 'cancelPullRequestBodyDraft') {
        cancelPullRequestBodyDraft()
      } else if (event.type === 'startChangelogView') {
        void startChangelogView()
      } else if (event.type === 'cancelChangelog') {
        cancelChangelog()
      } else if (event.type === 'runAiConflictResolution') {
        void startConflictResolution()
      } else if (event.type === 'cancelConflictResolution') {
        cancelConflictResolution()
      } else if (event.type === 'acceptConflictProposal') {
        void acceptConflictProposal()
      } else if (event.type === 'acceptAllConflictProposals') {
        void acceptAllConflictProposals()
      } else if (event.type === 'editConflictProposal') {
        void editConflictProposal()
      } else if (event.type === 'startRebasePlan') {
        void startRebasePlan()
      } else if (event.type === 'regenerateChangelog') {
        regenerateChangelog()
      } else if (event.type === 'yankChangelog') {
        yankChangelog()
      } else if (event.type === 'openChangelogInEditor') {
        openChangelogInEditor()
      } else if (event.type === 'openComposeInEditor') {
        openComposeInEditor()
      } else if (event.type === 'startCommitSplit') {
        void startCommitSplit()
      } else if (event.type === 'applyCommitSplit') {
        void applyCommitSplit()
      } else if (event.type === 'cancelCommitSplit') {
        cancelCommitSplit()
      } else if (event.type === 'yankText') {
        void yankText(event.value, event.label)
      } else if (event.type === 'runWorkflowAction') {
        // Centralized confirmation gate (#1445): if the registry declares
        // requiresConfirmation and the user hasn't already consented
        // (via y-confirm overlay, choice selection, or input-prompt
        // submission), redirect to the confirmation overlay. Consent is
        // detected by: (a) the event carries `confirmed: true`, OR
        // (b) there's an active pendingConfirmationId matching this id
        // (meaning the y-press handler emitted us), OR (c) a choice
        // prompt was just active (meaning an option was picked).
        const workflow = getLogInkWorkflowActionById(event.id)
        const alreadyConfirmed =
          event.confirmed ||
          state.pendingConfirmationId === event.id ||
          Boolean(state.pendingChoice)
        if (workflow?.requiresConfirmation && !alreadyConfirmed) {
          dispatch({ type: 'setPendingConfirmation', value: event.id, payload: event.payload })
        } else {
          void runWorkflowAction(event.id, event.payload)
        }
      } else if (event.type === 'openFileInEditor') {
        openInEditor(event.path)
      } else if (event.type === 'openConfigInEditor') {
        openConfigInEditor(event.scope)
      } else if (event.type === 'yankFromActiveView') {
        void yankFromActiveView(event.short)
      } else if (event.type === 'openGitignorePicker') {
        // Resolve the cursored worktree file here (the runtime owns the
        // selection→file mapping) and open the picker over its path.
        if (selectedWorktreeFile?.path) {
          dispatch({ type: 'openGitignorePicker', file: selectedWorktreeFile.path })
        } else {
          dispatch({ type: 'setStatus', value: 'No file under the cursor to ignore.', kind: 'warning' })
        }
      } else if (event.type === 'applyThemePreset') {
        // Apply for the session immediately, and best-effort persist to the
        // global config so it sticks across launches. The picker has already
        // dispatched `toggleThemePicker` (closing it), which clears the
        // preview via the sync effect below — the session preset takes over.
        const preset = event.preset as LogInkThemePreset
        setThemeSessionPreset(preset)
        saveThemePreset(preset)
      } else {
        // P4.5: enrich filter-mutating actions with a precomputed
        // selection snapshot so the reducer can preserve the cursor on
        // the same item when it's still in the filtered result, only
        // snapping to result[0] when the previously selected item drops
        // out. The snapshot lives in the action so the reducer never
        // needs context items.
        const enriched = enrichFilterActionWithRectification(event.action, state, context)
        dispatch(enriched)
      }
    })
  })
}
