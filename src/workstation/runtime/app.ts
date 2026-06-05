/**
 * `LogInkApp` — the workstation's root React component. Hosts all state
 * via `useState`/`useEffect`/`useMemo`/`useCallback` hooks; wires up the
 * input handler, refresh watcher, persistence layers, idle-tip cycle,
 * and per-context loaders; assembles the header / sidebar / main /
 * detail / footer chrome from the runtime modules.
 *
 * The entry point (`startInkInteractiveLog`) and the orchestration
 * helpers (`loadLogInkContext`, `loadInkRuntime`, `safe`) stay in
 * `src/commands/log/inkRuntime.ts` — they're the boot sequence, not the
 * component itself.
 *
 * Extracted from `src/commands/log/inkRuntime.ts` as part of phase 5b
 * of #890. No behavior change.
 */

/**
 * Ink runtime for `coco log -i` and `coco ui`.
 *
 * # Accessibility & terminal compatibility
 *
 * The TUI is keyboard-only by design — every action is reachable from the
 * keymap (see inkKeymap.ts) and the command palette (`:`). No mouse input
 * is consumed.
 *
 * Color and decorations:
 *   - `NO_COLOR` is honored end-to-end via `LogInkTheme.noColor` (see
 *     inkTheme.ts). When set, `focusBorderColor` returns undefined so
 *     borders fall back to the terminal default and color emphasis is
 *     dropped without changing layout.
 *   - The chrome and surfaces use a small set of unicode glyphs (›, ↑/↓,
 *     ·) that render in any modern UTF-8 terminal. Layout is ASCII-only,
 *     so a missing glyph never affects column widths.
 *
 * Empty / loading / error states:
 *   - Empty-state copy lives in inkSurfaceStates.ts so every surface
 *     speaks with the same voice and points users at the next sensible
 *     action.
 *   - Loading state uses `formatLogInkLoading` for a uniform leading
 *     glyph + text.
 *   - Error state for git command failures is surfaced through the
 *     existing `compose.message` / `compose.details` pipeline (commit /
 *     revert hooks) and the footer status message (transient
 *     operations). Context-load failures fall through to empty-state
 *     copy via `safe()` — surfacing them as a richer "this view failed
 *     to load" panel is a future polish.
 *
 * Themes:
 *   - Four presets (`default`, `monochrome`, `catppuccin`, `gruvbox`).
 *   - `monochrome` is the canary: the layout must read correctly when
 *     every text decoration is dropped.
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as nodePath from 'node:path'
import type * as ReactTypes from 'react'
import { SimpleGit } from 'simple-git'
import { getBranchOverview } from '../../git/branchData'
import { hashesMatchAny } from '../../git/hashes'
import { getLfsAttributeStatus } from '../../git/lfsAttributes'
import { getSubmoduleOverview } from '../../git/submoduleData'
import { createManualCommit, formatCommitComposeMessage } from '../../commands/log/commitCompose'
import {
    runCommitDraftWorkflow,
    runCommitSplitApplyWorkflow,
    runCommitSplitPlanWorkflow,
} from '../../git/commitWorkflowActions'
import { runChangelogTextWorkflow } from '../../git/aiActions'
import {
    GitCommitDetail,
    GitCommitFilePreview,
    LOG_INTERACTIVE_DEFAULT_LIMIT,
    buildToggleGraphArgs,
    getCommitDetail,
    getCommitFilePreview,
    getCommitRows,
    getLogRows,
    getLogRowsAnchoredOn,
} from '../../commands/log/data'
import {
    LogInkContextKey,
    LogInkContextStatus,
    createLogInkContextStatus,
    updateLogInkContextStatus,
} from '../chrome/context'
import {
    LogInkInputKey,
    getInspectorActionsForState,
    getLogInkInputEvents,
} from '../../commands/log/inkInput'
import { hasSeenOnboarding, markOnboardingSeen } from '../chrome/onboarding'
import { createLogInkTheme, type LogInkThemePreset } from '../chrome/theme'
import { saveThemePreset } from '../chrome/themePersistence'
import { formatSplitApplySuccess } from '../chrome/postApplyHints'
import { SPINNER_TICK_MS } from '../chrome/spinner'
import { createInitialContextStatus, createRepoFrameRuntime } from './repoFrameFactory'
import {
    resolveCommitDiffDrillInTarget,
    resolveSubmoduleViewDrillInTarget,
} from './repoFrameDrillIn'
import {
    getActiveRepoFrameRuntime,
    syncRepoStackRuntimes,
    updateRepoFrameRuntime,
    type RepoFrameRuntime,
    type RepoStackRuntimes,
} from './repoStackRuntime'
import { getSavedDiffViewMode, saveDiffViewMode } from '../chrome/diffViewModePersistence'
import { getSavedSidebarTab, saveSidebarTab } from '../chrome/sidebarPersistence'
import {
    PromotedSelectionsSnapshot,
    rectifyPromotedSelectionIndex,
} from '../chrome/selectionRectify'
import {
    LogInkRefreshWatcher,
    createRefreshWatcher,
} from '../chrome/refreshWatcher'
import {
    LOG_INK_DEFAULT_COLUMNS,
    LOG_INK_DEFAULT_ROWS,
    LOG_INK_MIN_COLUMNS,
    LAYOUT_SINGLE_PANE_BELOW,
    LOG_INK_MIN_ROWS,
    getLogInkLayout,
} from '../chrome/layout'
import type { LogInkVisiblePane } from '../chrome/layout'
import { sortBranches, sortTags } from '../chrome/sorting'
import { IDLE_TIPS_GRACE_MS, IDLE_TIPS_INTERVAL_MS, pickIdleTip } from '../chrome/idleTips'
import {
    LogInkPendingItemAction,
    LogInkState,
    RemoteOpState,
    applyLogInkAction,
    createLogInkState,
    getSelectedInkCommit,
    getThemePickerSelection,
} from '../../commands/log/inkViewModel'
import { getGitOperationOverview } from '../../git/operationData'
import { openProviderUrl } from '../../git/providerActions'
import { getProviderOverview } from '../../git/providerData'
import {
    checkoutBranch,
    createBranch,
    deleteBranch,
    isBranchCheckedOutElsewhereError,
    isBranchNotFullyMergedError,
    parseCheckedOutWorktreePath,
    fetchBranch,
    fetchRemotes,
    pullBranch,
    pullCurrentBranch,
    pushBranch,
    pushCurrentBranch,
    renameBranch,
    setUpstream,
} from '../../git/branchActions'
import { addToGitignore } from '../../git/gitignore'
import { highlightDiffCode, type SyntaxSpan } from '../../lib/syntax/highlightEngine'
import { humanizeAiError } from '../chrome/aiErrors'
import { createLightweightTag, deleteLocalTag, deleteRemoteTag, pushTag } from '../../git/tagActions'
import {
    ClipboardRunner,
    ResetMode,
    checkoutFileFromCommit,
    cherryPickCommit,
    createBranchFromCommit,
    createTagAtCommit,
    defaultClipboardRunner,
    defaultOpenUrlRunner,
    isResetMode,
    resetToCommit,
    revertCommit,
    startInteractiveRebase,
} from '../../git/historyActions'
import { applyStash, applyStashKeepIndex, checkoutFileFromStash, createStash, dropStash, popStash, renameStash, restoreStash, stashBranch } from '../../git/stashActions'
import { ApplyHunkTarget, applyHunkPatch } from '../../git/hunkActions'
import { removeWorktree, removeWorktreeAndBranch } from '../../git/worktreeActions'
import { abortOperation, continueOperation, resolveConflictOurs, resolveConflictTheirs, stageConflictResolved } from '../../git/operationActions'
import { getIssueDetail } from '../../git/issueDetailData'
import { getIssueList } from '../../git/issuesListData'
import {
    addIssueAssignee,
    addIssueLabel,
    closeIssue,
    commentIssue,
    reopenIssue,
} from '../../git/issueActions'
import { getPullRequestDetail } from '../../git/pullRequestDetailData'
import { getPullRequestOverview } from '../../git/pullRequestData'
import { getPullRequestList } from '../../git/pullRequestListData'
import { clearGitHubListCache } from '../../git/githubListCache'
import {
    issueFilterForPreset,
    pullRequestFilterForPreset,
} from '../../git/triageFilterPresets'
import {
    addPullRequestAssignee,
    addPullRequestLabel,
    approvePullRequest,
    approvePullRequestByNumber,
    closePullRequest,
    closePullRequestByNumber,
    commentPullRequest,
    commentPullRequestByNumber,
    createPullRequest,
    isPullRequestMergeStrategy,
    mergePullRequest,
    mergePullRequestByNumber,
    requestChangesPullRequest,
    requestChangesPullRequestByNumber,
} from '../../git/pullRequestActions'
import { runPullRequestBodyWorkflow } from '../../git/aiActions'
import {
    findStashFileForOffset,
    getStashCommitHashes,
    getStashDiff,
    getStashOverview,
    parseStashDiffFiles,
} from '../../git/stashData'
import {
    revertFile,
    stageAll,
    stageAllFiles,
    stageFile,
    stagePathspec,
    unstageAllFiles,
    unstageFile,
} from '../../git/statusActions'
import {
    applyStatusFilterMask,
    flattenWorktreeGroups,
    getWorktreeOverview,
    groupWorktreeFiles,
} from '../../git/statusData'
import {
    WorktreeHunkOverview,
    getWorktreeHunks,
    revertHunk,
    stageHunk,
    unstageHunk,
} from '../../git/statusHunks'
import { getBisectCompletion, getBisectStatus } from '../../git/bisectData'
import { bisectBad, bisectGood, bisectReset, bisectRun, bisectSkip, bisectStart, extractBisectRemainingHint } from '../../git/bisectActions'
import { getCompareDiff } from '../../git/compareData'
import { getReflogOverview } from '../../git/reflogData'
import { getTagOverview } from '../../git/tagData'
import { getWorktreeListOverview } from '../../git/worktreeData'
import { WorktreeFileDiff, getWorktreeFileDiff } from '../../git/worktreeDiffData'


async function safe<T>(promise: Promise<T>): Promise<T | undefined> {
  try {
    return await promise
  } catch {
    return undefined
  }
}

async function loadLogInkContext(git: SimpleGit): Promise<LogInkContext> {
  const [branches, pullRequest, tags, worktree, stashes, worktreeList, operation, provider, reflog, bisect, lfs, submodules] =
    await Promise.all([
      safe(getBranchOverview(git)),
      safe(getPullRequestOverview(git)),
      safe(getTagOverview(git)),
      safe(getWorktreeOverview(git)),
      safe(getStashOverview(git)),
      safe(getWorktreeListOverview(git)),
      safe(getGitOperationOverview(git)),
      safe(getProviderOverview(git)),
      safe(getReflogOverview(git)),
      safe(getBisectStatus(git)),
      safe(getLfsAttributeStatus(git)),
      safe(getSubmoduleOverview(git)),
    ])

  return {
    bisect,
    branches,
    lfs,
    operation,
    provider,
    pullRequest,
    reflog,
    stashes,
    submodules,
    tags,
    worktree,
    worktreeList,
  }
}

function loadLogInkContextEntries(git: SimpleGit): Array<{
  key: LogInkContextKey
  load: () => Promise<LogInkContext[LogInkContextKey] | undefined>
}> {
  // Boot-time per-key fetches. Each load() runs in parallel from
  // `LogInkApp`'s mount effect. `pullRequest` is intentionally
  // omitted (#808) — its `gh pr view --json` call duplicates the
  // slim PR fetch already happening inside `getProviderOverview`,
  // and the only consumer that needs the *full* enriched response is
  // the dedicated PR view (`g p`). Lazy-loaded by a separate effect
  // when the user actually navigates there. Header / yank / workflow
  // paths read the slim version off `provider.currentPullRequest` so
  // the chrome stays populated immediately on boot.
  return [
    {
      key: 'branches',
      load: () => safe(getBranchOverview(git)),
    },
    {
      key: 'tags',
      load: () => safe(getTagOverview(git)),
    },
    {
      key: 'reflog',
      load: () => safe(getReflogOverview(git)),
    },
    {
      key: 'bisect',
      load: () => safe(getBisectStatus(git)),
    },
    {
      key: 'lfs',
      load: () => safe(getLfsAttributeStatus(git)),
    },
    {
      key: 'submodules',
      load: () => safe(getSubmoduleOverview(git)),
    },
    {
      key: 'worktree',
      load: () => safe(getWorktreeOverview(git)),
    },
    {
      key: 'stashes',
      load: () => safe(getStashOverview(git)),
    },
    {
      key: 'worktreeList',
      load: () => safe(getWorktreeListOverview(git)),
    },
    {
      key: 'operation',
      load: () => safe(getGitOperationOverview(git)),
    },
    {
      key: 'provider',
      load: () => safe(getProviderOverview(git)),
    },
  ]
}
// Entry-point types (LogInkStreams, LogInkOptions) and the orchestration
// types (DynamicImport, LogInkRuntime) stay in inkRuntime.ts since they're
// only needed by startInkInteractiveLog.

import type { LogInkComponentDeps, LogInkContext, SurfaceRenderContext } from './types'
import type { LogArgv } from '../../commands/log/config'

// Promoted-list filter helpers shared by every promoted surface. Live in
// runtime/ rather than chrome/ because they're tightly coupled to the
// LogInkState filter-mode shape.
import { matchesPromotedFilter } from '../runtime/promotedFilter'
import {
    buildLoadedHashSet,
    resolveCursorSyncDecision,
} from './cursorSyncResolver'

// Chrome + overlay + dispatcher renderers extracted in phase 5a.7. The
// per-surface and detail renderers are consumed internally by mainPanel /
// detailPanel; LogInkApp just calls these top-level pieces.
import { renderFooter } from '../runtime/footer'
import { renderHeader } from '../runtime/header'
import { renderSidebar } from '../runtime/sidebar'
import { renderMainPanel } from '../runtime/mainPanel'
import { renderDetailPanel } from '../runtime/detailPanel'
import { renderOnboardingOverlay } from '../runtime/overlays'
import { getLogInkRuntimeContext, type LogInkRuntimeContextValue } from '../runtime/runtimeContext'
import { ensureConfigFile, resolveConfigPath, type CocoConfigScope } from './configFiles'



// Workflow action ids that hit the network (fetch / pull / push) →
// the loader copy shown over the history surface while they run. Any
// id NOT in this map runs without the full-screen loader (local-only
// mutations repaint fast enough that a loader would just flicker).
const REMOTE_OP_LOADERS: Record<string, RemoteOpState> = {
  'fetch-remotes': { kind: 'fetch', label: 'Fetching all remotes…' },
  'pull-current-branch': { kind: 'pull', label: 'Pulling from origin…' },
  'push-current-branch': { kind: 'push', label: 'Pushing to origin…' },
  'fetch-selected-branch': { kind: 'fetch', label: 'Fetching branch from remote…' },
  'pull-selected-branch': { kind: 'pull', label: 'Pulling branch from remote…' },
  'push-selected-branch': { kind: 'push', label: 'Pushing branch to remote…' },
}

/**
 * Resolve which list row a delete workflow is about to act on, so the
 * runner can mark it pending (inline spinner) for the duration of the
 * git call. Mirrors the cursored-target resolution inside each delete
 * handler exactly — same sort, same promoted-filter, same selection
 * index — so the spinner lands on the row that actually gets deleted.
 * Returns `undefined` for non-delete workflows (and when nothing is
 * selected), which the runner treats as "no pending marker".
 */
function resolvePendingItemAction(
  id: string,
  state: LogInkState,
  context: LogInkContext
): LogInkPendingItemAction | undefined {
  const { filter } = state
  // Checking out a branch gets the same inline spinner on its row as a
  // delete does — the action just runs `git checkout` instead of
  // `git branch -d`. Resolved the same way as the delete branch case
  // (and identically to the checkout-branch handler) so the spinner
  // lands on exactly the row the user pressed enter on.
  if (id === 'checkout-branch') {
    const all = sortBranches(context.branches?.localBranches || [], state.branchSort)
    const visible = filter
      ? all.filter((b) => matchesPromotedFilter([b.shortName, b.upstream || ''], filter))
      : all
    const branch = visible[Math.min(state.selectedBranchIndex, visible.length - 1)]
    return branch ? { kind: 'branch', id: branch.shortName, action: 'checkout' } : undefined
  }
  if (id === 'delete-branch' || id === 'force-delete-branch') {
    const all = sortBranches(context.branches?.localBranches || [], state.branchSort)
    const visible = filter
      ? all.filter((b) => matchesPromotedFilter([b.shortName, b.upstream || ''], filter))
      : all
    const branch = visible[Math.min(state.selectedBranchIndex, visible.length - 1)]
    return branch ? { kind: 'branch', id: branch.shortName, action: 'delete' } : undefined
  }
  if (id === 'delete-tag') {
    const all = sortTags(context.tags?.tags || [], state.tagSort)
    const visible = filter
      ? all.filter((t) => matchesPromotedFilter([t.name, t.subject], filter))
      : all
    const tag = visible[Math.min(state.selectedTagIndex, visible.length - 1)]
    return tag ? { kind: 'tag', id: tag.name, action: 'delete' } : undefined
  }
  if (id === 'drop-stash') {
    const all = context.stashes?.stashes || []
    const visible = filter
      ? all.filter((s) => matchesPromotedFilter([s.ref, s.message], filter))
      : all
    const stash = visible[Math.min(state.selectedStashIndex, visible.length - 1)]
    return stash ? { kind: 'stash', id: stash.ref, action: 'delete' } : undefined
  }
  if (id === 'remove-worktree') {
    const all = context.worktreeList?.worktrees || []
    const visible = filter
      ? all.filter((w) => matchesPromotedFilter([w.path, w.branch || ''], filter))
      : all
    const wt = visible.length
      ? visible[Math.min(state.selectedWorktreeListIndex, visible.length - 1)]
      : all[Math.min(state.selectedWorktreeListIndex, Math.max(0, all.length - 1))]
    return wt ? { kind: 'worktree', id: wt.path, action: 'delete' } : undefined
  }
  return undefined
}

function predictNextFilter(
  action: Parameters<typeof applyLogInkAction>[1],
  currentFilter: string
): string | undefined {
  switch (action.type) {
    case 'appendFilter':
      return `${currentFilter}${action.value}`
    case 'backspaceFilter':
      return currentFilter.slice(0, -1)
    case 'clearFilter':
    case 'clearFilterText':
      return ''
    case 'setFilter':
      return action.value
    default:
      return undefined
  }
}

/**
 * Build the post-filter selection snapshot for branches / tags / stash so
 * the reducer can preserve the cursor when the previously-selected item is
 * still in the filtered result. Identifies items by a single key per view
 * (branch shortName, tag name, stash ref) — the same matchesPromotedFilter
 * the surfaces use covers the multi-field haystacks.
 */
function computePromotedSelectionsSnapshot(
  state: LogInkState,
  context: LogInkContext,
  nextFilter: string
): PromotedSelectionsSnapshot {
  const allBranches = context.branches?.localBranches || []
  const filteredBranches = nextFilter
    ? allBranches.filter((branch) =>
      matchesPromotedFilter([branch.shortName, branch.upstream || ''], nextFilter))
    : allBranches
  const currentBranches = state.filter
    ? allBranches.filter((branch) =>
      matchesPromotedFilter([branch.shortName, branch.upstream || ''], state.filter))
    : allBranches
  const previousBranchKey = currentBranches[state.selectedBranchIndex]?.shortName
  const branchIndex = rectifyPromotedSelectionIndex(
    filteredBranches.map((branch) => branch.shortName),
    previousBranchKey
  )

  const allTags = context.tags?.tags || []
  const filteredTags = nextFilter
    ? allTags.filter((tag) => matchesPromotedFilter([tag.name, tag.subject], nextFilter))
    : allTags
  const currentTags = state.filter
    ? allTags.filter((tag) => matchesPromotedFilter([tag.name, tag.subject], state.filter))
    : allTags
  const previousTagKey = currentTags[state.selectedTagIndex]?.name
  const tagIndex = rectifyPromotedSelectionIndex(
    filteredTags.map((tag) => tag.name),
    previousTagKey
  )

  const allStashes = context.stashes?.stashes || []
  const filteredStashes = nextFilter
    ? allStashes.filter((stash) => matchesPromotedFilter([stash.ref, stash.message], nextFilter))
    : allStashes
  const currentStashes = state.filter
    ? allStashes.filter((stash) => matchesPromotedFilter([stash.ref, stash.message], state.filter))
    : allStashes
  const previousStashKey = currentStashes[state.selectedStashIndex]?.ref
  const stashIndex = rectifyPromotedSelectionIndex(
    filteredStashes.map((stash) => stash.ref),
    previousStashKey
  )

  return { branchIndex, tagIndex, stashIndex }
}

function enrichFilterActionWithRectification(
  action: Parameters<typeof applyLogInkAction>[1],
  state: LogInkState,
  context: LogInkContext
): Parameters<typeof applyLogInkAction>[1] {
  const nextFilter = predictNextFilter(action, state.filter)
  if (nextFilter === undefined) {
    return action
  }
  const promotedSelections = computePromotedSelectionsSnapshot(state, context, nextFilter)
  switch (action.type) {
    case 'appendFilter':
    case 'setFilter':
      return { ...action, promotedSelections }
    case 'backspaceFilter':
    case 'clearFilter':
    case 'clearFilterText':
      return { ...action, promotedSelections }
    default:
      return action
  }
}

export function LogInkApp(deps: LogInkComponentDeps): ReactTypes.ReactElement {
  const { appLabel, clipboardRunner, dateBucketingEnabled, git: rootGit, idleTipsEnabled, ink, initialView, loadRows, logArgv, React, resumeRef, rows, syntaxHighlightEnabled, theme: baseTheme, themeConfig } = deps
  const { Box, Text, useApp, useInput, useWindowSize } = ink
  const h = React.createElement

  // Theme picker (gC) — live preview + apply. `themePreviewPreset` follows
  // the picker cursor while the overlay is open; `themeSessionPreset` is the
  // applied choice that survives close. The effective theme is rebuilt from
  // the original `themeConfig` so ascii/border/noColor + truecolor-downgrade
  // semantics are preserved; when neither override is set we use the static
  // `baseTheme` unchanged (so behavior is identical until the picker is used).
  const [themePreviewPreset, setThemePreviewPreset] = React.useState<LogInkThemePreset | undefined>(undefined)
  const [themeSessionPreset, setThemeSessionPreset] = React.useState<LogInkThemePreset | undefined>(undefined)
  const effectiveThemePreset = themePreviewPreset ?? themeSessionPreset
  const theme = React.useMemo(
    () =>
      effectiveThemePreset
        ? createLogInkTheme({ ...themeConfig, preset: effectiveThemePreset })
        : baseTheme,
    [effectiveThemePreset, themeConfig, baseTheme]
  )
  const { exit } = useApp()
  const windowSize = useWindowSize()
  // Bumping this on SIGCONT forces the existing tree to repaint so users
  // land on a drawn screen after `fg` instead of an empty alt buffer.
  const [, setResumeTick] = React.useState(0)
  React.useEffect(() => {
    if (!resumeRef) {
      return
    }
    resumeRef.current = () => setResumeTick((tick) => tick + 1)
    return () => {
      resumeRef.current = null
    }
  }, [resumeRef])
  // First-launch onboarding (P1.3). Persisted via a marker file in the
  // user's cache dir so the tip never reappears once dismissed. Lazy
  // initializer so the fs check only runs on mount, not every render.
  const [showOnboarding, setShowOnboarding] = React.useState<boolean>(() => !hasSeenOnboarding())
  const [state, setState] = React.useState<LogInkState>(() =>
    createLogInkState(rows, {
      activeView: initialView,
      // Boot loader is in flight whenever the caller passed
      // `loadRows`, regardless of whether `rows` was empty or
      // pre-populated from the disk cache (#808). The history
      // surface only shows the "Loading commits…" placeholder when
      // there are zero visible commits, so cached data renders
      // immediately while the chrome still flags the refresh.
      bootLoading: Boolean(loadRows),
    })
  )

  // Theme picker live preview: keep `themePreviewPreset` in sync with the
  // preset under the picker cursor while the overlay is open; clear it when
  // the overlay closes so the theme reverts to the applied session preset
  // (or the original config theme). The derived-theme `useMemo` above does
  // the actual re-render from this state.
  const themePickerSelection = state.showThemePicker
    ? getThemePickerSelection(state)
    : undefined
  React.useEffect(() => {
    setThemePreviewPreset(state.showThemePicker ? themePickerSelection : undefined)
  }, [state.showThemePicker, themePickerSelection])

  // Nested-repo runtime stack (#931). Each frame holds the live
  // `SimpleGit`, the loaded `LogInkContext`, and the per-key load
  // status the chrome reads. The active (top-of-stack) entry drives
  // every loader and surface; popping a frame restores the parent's
  // cached entry so a drill-in / drill-out round trip doesn't re-pay
  // the context load cost. Seeded with a single root runtime against
  // the cwd `coco ui` was launched in.
  const [runtimes, setRuntimes] = React.useState<RepoStackRuntimes>(() => [{
    git: rootGit,
    context: {},
    contextStatus: createInitialContextStatus(),
  }])
  // Sync `runtimes` against the view-model stack on every push / pop.
  // The sync is monotone — push appends a new runtime via the factory,
  // pop slices off the top runtime; the parent's cached state survives.
  // The factory is wrapped to capture `rootGit` so a defensively-pushed
  // frame without a workdir still has a working `SimpleGit` bound.
  React.useEffect(() => {
    setRuntimes((prev) => {
      const { runtimes: next } = syncRepoStackRuntimes(
        prev,
        state.repoStack,
        (frame) => createRepoFrameRuntime(frame, rootGit),
      )
      return next
    })
  }, [state.repoStack, rootGit])
  // Active-frame projection (#931). `git`, `context`, `contextStatus`
  // — every existing closure / effect / surface reads these names; the
  // only thing this PR changes is where they come from. When the user
  // drills into a submodule, the top-of-stack runtime swaps, every
  // dep array that lists `git` re-fires, and the loaders refetch
  // against the submodule's working tree.
  const activeRuntime: RepoFrameRuntime = getActiveRepoFrameRuntime(runtimes) ?? {
    git: rootGit,
    context: {},
    contextStatus: createInitialContextStatus(),
  }
  const git = activeRuntime.git
  const context = activeRuntime.context
  const contextStatus = activeRuntime.contextStatus
  // Wrappers that delegate to the active frame's runtime entry so the
  // existing call sites stay byte-identical. Support both function-
  // updater and value-updater forms (the codebase uses both).
  //
  // `targetDepth` (#994) routes the write to a specific frame instead
  // of the currently-active one. Loaders that capture the depth at
  // issue-time and pass it here are robust against frame-stack
  // mutations (push / pop) that happen while the load is in flight —
  // the write lands on the frame that issued it, or silently drops
  // if that frame has been popped (`updateRepoFrameRuntime` no-ops on
  // out-of-range indices). Without the tag, an in-flight refresh on
  // the parent would clobber a freshly-pushed submodule frame.
  const setContext = React.useCallback(
    (
      arg: LogInkContext | ((prev: LogInkContext) => LogInkContext),
      targetDepth?: number,
    ) => {
      setRuntimes((prev) => {
        const depth = targetDepth ?? prev.length - 1
        if (depth < 0) return prev
        return updateRepoFrameRuntime(prev, depth, (frame) => ({
          ...frame,
          context: typeof arg === 'function'
            ? (arg as (p: LogInkContext) => LogInkContext)(frame.context)
            : arg,
        }))
      })
    },
    [],
  )
  const setContextStatus = React.useCallback(
    (
      arg: LogInkContextStatus | ((prev: LogInkContextStatus) => LogInkContextStatus),
      targetDepth?: number,
    ) => {
      setRuntimes((prev) => {
        const depth = targetDepth ?? prev.length - 1
        if (depth < 0) return prev
        return updateRepoFrameRuntime(prev, depth, (frame) => ({
          ...frame,
          contextStatus: typeof arg === 'function'
            ? (arg as (p: LogInkContextStatus) => LogInkContextStatus)(frame.contextStatus)
            : arg,
        }))
      })
    },
    [],
  )
  // #931 PR 3b — Absolute repo root for the active frame's `git`.
  // Resolved asynchronously after every `git` swap (push / pop /
  // boot) so the commit-diff drill-in helper can construct absolute
  // workdirs for submodule paths recorded in `.gitmodules` (which
  // are repo-relative). Undefined during the brief moment between
  // git swap and the revparse callback resolving.
  //
  // Audit finding #10: rapid frame push/pop races are prevented by
  // the per-effect `cancelled` flag — React fires the cleanup
  // synchronously BEFORE running the next effect body, so any
  // pending revparse from the old `git` sees `cancelled === true`
  // and skips its write. The `git` reference itself is captured by
  // closure, so each effect run resolves against the right binding.
  // No additional depth tagging is needed.
  const [activeRepoRoot, setActiveRepoRoot] = React.useState<string | undefined>(undefined)
  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const root = (await git.revparse(['--show-toplevel'])).trim()
        if (!cancelled && root) {
          setActiveRepoRoot(root)
        }
      } catch {
        if (!cancelled) {
          setActiveRepoRoot(undefined)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [git])
  const [detail, setDetail] = React.useState<GitCommitDetail | undefined>(undefined)
  const [detailLoading, setDetailLoading] = React.useState(false)
  const [filePreview, setFilePreview] = React.useState<GitCommitFilePreview | undefined>(undefined)
  const [filePreviewLoading, setFilePreviewLoading] = React.useState(false)
  const [worktreeDiff, setWorktreeDiff] = React.useState<WorktreeFileDiff | undefined>(undefined)
  const [worktreeDiffLoading, setWorktreeDiffLoading] = React.useState(false)
  const [worktreeHunks, setWorktreeHunks] = React.useState<WorktreeHunkOverview | undefined>(
    undefined
  )
  const [worktreeHunksLoading, setWorktreeHunksLoading] = React.useState(false)
  // Syntax-highlight spans for the diff currently in view (#1117
  // follow-up). Computed off the render path by the effect below;
  // keyed by marker-stripped code line so the diff renderer looks
  // spans up directly. `undefined` = no highlighting (renders plain).
  const [diffSyntaxSpans, setDiffSyntaxSpans] = React.useState<
    Map<string, SyntaxSpan[]> | undefined
  >(undefined)
  // Stash diff explorer (Enter on a stash row): the runtime fetches
  // `git stash show -p <ref>` lazily once the diff view becomes active
  // with diffSource='stash'. Lines are stored as a flat string[] —
  // renderDiffSurface paints each line through diffLineProps so +/-
  // colors match the commit-diff path.
  const [stashDiffLines, setStashDiffLines] = React.useState<string[] | undefined>(undefined)
  const [stashDiffLoading, setStashDiffLoading] = React.useState(false)
  // #779 — compare-two-refs diff state. Loaded lazily when the diff
  // view becomes active with `diffSource === 'compare'`.
  const [compareDiffLines, setCompareDiffLines] = React.useState<string[] | undefined>(undefined)
  const [compareDiffLoading, setCompareDiffLoading] = React.useState(false)
  const [hasMoreCommits, setHasMoreCommits] = React.useState(() => (
    Boolean(logArgv?.interactive && !logArgv.limit) &&
    getCommitRows(rows).length >= LOG_INTERACTIVE_DEFAULT_LIMIT
  ))
  const [loadingMoreCommits, setLoadingMoreCommits] = React.useState(false)
  const loadingMoreCommitsRef = React.useRef(false)
  const loadMoreRequestRef = React.useRef(0)
  const mountedRef = React.useRef(true)
  // Last dropped stash {hash, message}, captured before `drop-stash` runs
  // so `undo-drop-stash` can re-store it. The dropped commit survives in
  // the object DB until gc, so the hash is enough to bring it back.
  const lastDroppedStashRef = React.useRef<{ hash: string; message: string } | null>(null)

  // P4.3 — idle tip rotation. tickIndex 0 ⇒ no tip; the hook bumps it after
  // a grace window of empty statusMessage and then on a steady cadence, so
  // the footer surfaces a different hint every interval until the user does
  // anything that sets statusMessage.
  const [idleTipIndex, setIdleTipIndex] = React.useState(0)
  React.useEffect(() => {
    if (!idleTipsEnabled) return
    if (state.statusMessage) {
      // Any explicit message resets the cycle; next idle stretch starts
      // from the grace window again.
      setIdleTipIndex(0)
      return
    }
    let interval: NodeJS.Timeout | undefined
    // Both timer callbacks are function literals (never strings) and the
    // delays are our own `IDLE_TIPS_*_MS` constants — no caller-supplied
    // data flows in, so the eval-injection vector that drives
    // DevSkim DS172411 doesn't apply here.
    // DevSkim: ignore DS172411
    const grace = setTimeout(() => {
      setIdleTipIndex(1)
      // DevSkim: ignore DS172411
      interval = setInterval(() => setIdleTipIndex((tick) => tick + 1), IDLE_TIPS_INTERVAL_MS)
    }, IDLE_TIPS_GRACE_MS)
    return () => {
      clearTimeout(grace)
      if (interval) clearInterval(interval)
    }
  }, [idleTipsEnabled, state.statusMessage])
  const idleTip = idleTipsEnabled && !state.statusMessage ? pickIdleTip(idleTipIndex) : undefined

  // Animation tick driver for loading states. Increments every 80ms
  // while any overlay/surface is in a loading state — the renderer
  // derives a spinner frame from `spinnerFrame % FRAMES.length` so
  // the user sees motion instead of static "generating…" copy.
  //
  // Driven by a single shared tick rather than per-surface intervals
  // because the cost of an Ink re-render is the whole app; one
  // interval is the same cost as N. We pause the tick entirely when
  // nothing is loading so an idle workstation doesn't waste cycles
  // re-rendering the same frame.
  const [spinnerFrame, setSpinnerFrame] = React.useState(0)
  const anyLoading =
    state.splitPlan?.status === 'loading' ||
    state.splitPlan?.status === 'applying' ||
    state.changelogView.status === 'loading' ||
    state.commitCompose.loading ||
    Boolean(state.remoteOp) ||
    Boolean(state.statusLoading) ||
    // Keep the shared spinner ticking while a list-item action (delete
    // or checkout) is in flight so its inline pending glyph animates
    // instead of freezing.
    Boolean(state.pendingItemAction)
  React.useEffect(() => {
    if (!anyLoading) {
      // Reset to 0 so the next loading state starts from a known
      // frame instead of wherever the last animation left off.
      setSpinnerFrame(0)
      return
    }
    // DevSkim: ignore DS172411 — callback is a function literal, delay
    // is our own constant, no caller-supplied data flows through.
    const id = setInterval(() => setSpinnerFrame((tick) => tick + 1), SPINNER_TICK_MS)
    return () => clearInterval(id)
  }, [anyLoading])

  const selected = getSelectedInkCommit(state)
  const selectedDetailFile = detail?.files[state.selectedFileIndex]
  // Status surface visibility mask (#776). `visibleWorktreeFiles` is the
  // single source of truth for staged/unstaged/untracked filtering: file
  // count, selected-file resolution, and the rendered list all key off
  // it so toggles never desync the cursor from the rendered rows.
  const visibleWorktreeFiles = React.useMemo(
    () => applyStatusFilterMask(context.worktree?.files || [], state.statusFilterMask),
    [context.worktree?.files, state.statusFilterMask]
  )
  // Sectioned view of the visible files (#791 follow-up). Drives the
  // status surface's three-tier cursor model: ←/→ jumps between
  // groups, ↑ at index 0 promotes to the group header, Enter on the
  // header fires the group's batch action. The renderer also consumes
  // this so the visible file list stays in canonical group order
  // regardless of whatever order `git status --porcelain` happens to
  // emit.
  const visibleWorktreeGroups = React.useMemo(
    () => groupWorktreeFiles(visibleWorktreeFiles),
    [visibleWorktreeFiles]
  )
  const visibleWorktreeFilesGrouped = React.useMemo(
    () => flattenWorktreeGroups(visibleWorktreeGroups),
    [visibleWorktreeGroups]
  )
  const selectedWorktreeFile = visibleWorktreeFilesGrouped[state.selectedWorktreeFileIndex]

  // Stash patch per-file segmentation (#808). Hoisted out of the
  // useInput callback (was running on every keystroke), the yank
  // handler (was running per `y` press), and renderDiffSurface (was
  // running per paint) into a single LogInkApp-scoped memo. When the
  // active stash diff has hundreds of files, the prior fan-out was
  // re-walking the entire patch text 2-3x per keystroke for no
  // observable reason — the parsed list is purely a function of the
  // line array, which only changes when the user opens a different
  // stash.
  const stashDiffParsedFiles = React.useMemo(
    () => stashDiffLines ? parseStashDiffFiles(stashDiffLines) : [],
    [stashDiffLines]
  )

  // Filtered promoted-view lists (#808). These were recomputed inline
  // inside useInput on every keystroke — for a repo with hundreds of
  // branches / tags and an active filter, that's hundreds of regex
  // matches per arrow-key press. Memoizing on (raw list, filter)
  // collapses the work to one pass per filter / data change.
  const filteredBranchList = React.useMemo(() => {
    const all = context.branches?.localBranches || []
    if (!state.filter) return all
    return all.filter((branch) =>
      matchesPromotedFilter([branch.shortName, branch.upstream || ''], state.filter)
    )
  }, [context.branches?.localBranches, state.filter])
  const filteredTagList = React.useMemo(() => {
    const all = context.tags?.tags || []
    if (!state.filter) return all
    return all.filter((tag) =>
      matchesPromotedFilter([tag.name, tag.subject], state.filter)
    )
  }, [context.tags?.tags, state.filter])
  const filteredStashList = React.useMemo(() => {
    const all = context.stashes?.stashes || []
    if (!state.filter) return all
    return all.filter((stash) =>
      matchesPromotedFilter([stash.ref, stash.message], state.filter)
    )
  }, [context.stashes?.stashes, state.filter])
  const filteredWorktreeList = React.useMemo(() => {
    const all = context.worktreeList?.worktrees || []
    if (!state.filter) return all
    return all.filter((entry) =>
      matchesPromotedFilter([entry.path, entry.branch || ''], state.filter)
    )
  }, [context.worktreeList?.worktrees, state.filter])
  const filteredReflogList = React.useMemo(() => {
    const all = context.reflog?.entries || []
    if (!state.filter) return all
    return all.filter((entry) =>
      matchesPromotedFilter(
        [entry.selector, entry.hash, entry.relativeDate, entry.subject],
        state.filter
      )
    )
  }, [context.reflog?.entries, state.filter])
  const filteredSubmoduleList = React.useMemo(() => {
    const all = context.submodules?.entries || []
    if (!state.filter) return all
    return all.filter((entry) =>
      matchesPromotedFilter(
        [entry.name, entry.path, entry.trackingBranch || '', entry.url || ''],
        state.filter,
      )
    )
  }, [context.submodules?.entries, state.filter])
  // Issues + PR triage filtered lists (#882 phase 3). Same memo
  // pattern as the other promoted views — collapses per-keystroke
  // filter work to one pass per (data, filter) change.
  const filteredIssueList = React.useMemo(() => {
    const all = context.issueList?.issues || []
    if (!state.filter) return all
    return all.filter((issue) =>
      matchesPromotedFilter(
        [
          `#${issue.number}`,
          issue.title,
          issue.author || '',
          ...(issue.labels || []),
          ...(issue.assignees || []),
        ],
        state.filter,
      )
    )
  }, [context.issueList?.issues, state.filter])
  const filteredPullRequestTriageList = React.useMemo(() => {
    const all = context.pullRequestList?.pullRequests || []
    if (!state.filter) return all
    return all.filter((pr) =>
      matchesPromotedFilter(
        [
          `#${pr.number}`,
          pr.title,
          pr.author || '',
          pr.headRefName,
          pr.baseRefName,
          ...(pr.labels || []),
          ...(pr.assignees || []),
        ],
        state.filter,
      )
    )
  }, [context.pullRequestList?.pullRequests, state.filter])

  const dispatch = React.useCallback((action: Parameters<typeof applyLogInkAction>[1]) => {
    setState((current) => applyLogInkAction(current, action))
  }, [])

  // Deferred commit-log loader (#808). Runs once on mount when the
  // caller opted into the lazy boot path. The Ink tree is already on
  // screen at this point — without this the user stares at a black
  // terminal during the synchronous git log pre-mount fetch. The
  // mounted-ref guard prevents a late-resolving promise from
  // dispatching after the user `q` quits before rows arrive.
  React.useEffect(() => {
    if (!loadRows) return
    let cancelled = false
    void loadRows()
      .then((nextRows) => {
        if (cancelled || !mountedRef.current) return
        dispatch({ type: 'replaceRows', rows: nextRows })
      })
      .catch((error: unknown) => {
        if (cancelled || !mountedRef.current) return
        const message = error instanceof Error ? error.message : String(error)
        dispatch({ type: 'setStatus', value: `Failed to load commits: ${message}`, kind: 'error' })
        dispatch({ type: 'setBootLoading', value: false })
      })
    return () => {
      cancelled = true
    }
    // Intentionally one-shot — re-running the boot load on hot
    // dispatch / loader changes would refetch the entire log on every
    // re-render. The loader fires once per app mount and that's it.
  }, [])

  // Auto-dismiss status messages after a short window so transient
  // confirmations ("Pulled current branch", "Edited foo.ts") don't
  // linger forever. Each new message resets the timer; clearing the
  // message via setStatus(undefined) cancels it. Doesn't fire while a
  // modal (input prompt, confirmation, palette) is open — those flows
  // use the status line as live feedback for the open task.
  React.useEffect(() => {
    if (!state.statusMessage) return
    if (state.inputPrompt || state.pendingConfirmationId || state.pendingMutationConfirmation || state.showCommandPalette) {
      return
    }
    // The `setTimeout` callback is a literal arrow function (not a
    // string), and the delay is a hard-coded constant, so the
    // eval-injection vector behind DevSkim DS172411 doesn't apply here.
    // DevSkim: ignore DS172411
    const handle = setTimeout(() => {
      if (mountedRef.current) {
        dispatch({ type: 'setStatus', value: undefined })
      }
    }, 4000)
    return () => clearTimeout(handle)
  }, [
    dispatch,
    state.inputPrompt,
    state.pendingConfirmationId,
    state.pendingMutationConfirmation,
    state.showCommandPalette,
    state.statusMessage,
  ])

  /**
   * Re-fetch the head of the commit log and replace `state.rows`.
   *
   * The boot loader fires `replaceRows` once on app mount. After
   * that, NOTHING in the workstation refreshes `state.rows` —
   * `refreshContext` updates the metadata context (branches, tags,
   * worktree) but not the commits themselves. The result is that
   * workstation-side operations that create commits (split-apply,
   * regular commit, future amend / rebase flows) leave the history
   * view showing a stale log. The user navigates to `gh`, sees the
   * pre-operation commits, and concludes the operation didn't run.
   *
   * Call this after any operation that creates or rewrites history
   * locally so the history view reflects reality.
   *
   * Best-effort — a failed re-fetch keeps the existing rows on
   * screen (stale but better than blank). Silent: doesn't surface
   * a "refreshing…" status message since the caller already owns
   * the user-facing status copy for whatever just happened.
   */
  const refreshHistoryRows = React.useCallback(async () => {
    try {
      const fetchArgs = state.historyFetchArgs
      const mergedArgv: LogArgv = {
        ...logArgv,
        ...(fetchArgs?.author ? { author: fetchArgs.author } : {}),
        ...(fetchArgs?.path ? { path: fetchArgs.path } : {}),
      } as LogArgv
      // Stash commits as graph roots so post-operation refreshes
      // keep the same rich graph the boot loader assembled. Without
      // this, every commit / split-apply / etc. would drop stash
      // anchors and the cursor-syncs-history effect would degrade
      // back to "tip not in loaded window" for older stashes.
      const stashHashes = await getStashCommitHashes(git).catch(() => [])
      const fresh = await getLogRows(git, mergedArgv, {
        limit: LOG_INTERACTIVE_DEFAULT_LIMIT,
        extraRefs: stashHashes,
      })
      if (mountedRef.current && fresh) {
        dispatch({ type: 'replaceRows', rows: fresh })
      }
    } catch { /* ignore — stale rows beat blank rows */ }
  }, [dispatch, git, logArgv, state.historyFetchArgs])

  const refreshContext = React.useCallback(async (options: { silent?: boolean } = {}) => {
    // Loud refresh (manual `r`): flip everything to 'loading' so the user
    // sees the surfaces clear, then settle to 'ready' on completion.
    // Silent refresh (fs.watch trigger): keep the existing data on screen
    // (stale-while-revalidate) and quietly swap it in once the new fetch
    // resolves — avoids the every-second flicker the watcher would
    // otherwise produce on busy repos.
    //
    // #994 — capture the depth this refresh was issued from BEFORE
    // the await. The callback closure also captured `git` from the
    // same render, so they're consistent: when the user drills into
    // a submodule mid-await, the resolved data still lands on the
    // parent frame (the one whose `git` was used for the fetch),
    // not on the freshly-pushed submodule frame.
    const issuedAtDepth = runtimes.length - 1
    if (!options.silent) {
      dispatch({ type: 'setStatus', value: 'refreshing repository context' })
      setContextStatus(createLogInkContextStatus('loading'), issuedAtDepth)
    }
    const next = await loadLogInkContext(git)
    setContext(next, issuedAtDepth)
    setContextStatus(createLogInkContextStatus('ready'), issuedAtDepth)
    if (!options.silent) {
      dispatch({ type: 'setStatus', value: 'repository context refreshed' })
    }
  }, [dispatch, git, runtimes.length, setContext, setContextStatus])

  const refreshWorktreeContext = React.useCallback(async (options: { silent?: boolean } = {}) => {
    // #994 — same frame-tagging as refreshContext above. Worktree
    // loads are usually fast but still race-prone on slow disks.
    const issuedAtDepth = runtimes.length - 1
    if (!options.silent) {
      setContextStatus(
        (current) => updateLogInkContextStatus(current, 'worktree', 'loading'),
        issuedAtDepth,
      )
    }
    const worktree = await safe(getWorktreeOverview(git))

    setContext(
      (current) => ({
        ...current,
        worktree,
      }),
      issuedAtDepth,
    )
    setContextStatus(
      (current) => updateLogInkContextStatus(current, 'worktree', 'ready'),
      issuedAtDepth,
    )
    // Returned so callers needing the *fresh* overview (e.g. post-commit
    // navigation) can read it directly instead of racing the async
    // `setContext` update, which won't be visible in their closure.
    return worktree
  }, [git, runtimes.length, setContext, setContextStatus])

  // Live refresh: watch .git metadata + the working tree root and reload
  // context when something changes outside the TUI (editor save, external
  // git commands, branch switch in another terminal). Best-effort — the
  // watcher quietly skips paths that don't exist or platforms where
  // fs.watch fails. Subdirectory unstaged edits don't fire; users can
  // press `r` for those.
  React.useEffect(() => {
    let cancelled = false
    let watcher: LogInkRefreshWatcher | null = null

    void (async () => {
      try {
        const [repoRoot, gitDir] = await Promise.all([
          git.revparse(['--show-toplevel']),
          git.revparse(['--absolute-git-dir']),
        ])
        if (cancelled) {
          return
        }
        watcher = createRefreshWatcher({
          repoRoot: repoRoot.trim(),
          gitDir: gitDir.trim(),
          // Editor saves and git background processes can produce a steady
          // drip of fs events on busy repos. The default 250ms debounce
          // was tight enough that the watcher fired ~once per second; 750
          // batches the steady-state better without delaying the user's
          // perception of an actual change.
          debounceMs: 750,
          onChange: (kind) => {
            if (!mountedRef.current) {
              return
            }
            if (kind === 'full') {
              void refreshContext({ silent: true })
            } else {
              void refreshWorktreeContext({ silent: true })
            }
          },
        })
      } catch {
        // Not in a git worktree, or revparse failed. Skip — manual `r`
        // refresh still works.
      }
    })()

    return () => {
      cancelled = true
      watcher?.close()
    }
  }, [git, refreshContext, refreshWorktreeContext])

  // Per-repo sidebar tab persistence (#21). Resolve the repo root, look
  // up the cached tab, and dispatch `restoreSidebarTab` once on mount so
  // the user lands on whichever tab they were last on for this project.
  // `restoreSidebarTab` (vs `setSidebarTab`) intentionally does not pull
  // focus into the sidebar — the user lands on commits, the saved tab
  // is just visible in the gutter.
  //
  // The save effect listens to `userSidebarTab` (the user's explicit
  // choice mirror), not `sidebarTab`. That way the auto-switch to
  // Branches when entering compose / status doesn't overwrite the saved
  // preference.
  const repoRootRef = React.useRef<string | undefined>(undefined)
  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const repoRoot = (await git.revparse(['--show-toplevel'])).trim()
        if (cancelled || !repoRoot) return
        repoRootRef.current = repoRoot
        const saved = getSavedSidebarTab(repoRoot)
        if (saved && saved !== state.userSidebarTab) {
          dispatch({ type: 'restoreSidebarTab', value: saved })
        }
        // Diff view mode persistence (#785). Same per-repo cache pattern
        // as the sidebar tab — restore the user's last preference if
        // they had one. New repos / fresh installs default to unified.
        const savedDiffMode = getSavedDiffViewMode(repoRoot)
        if (savedDiffMode && savedDiffMode !== state.diffViewMode) {
          dispatch({ type: 'setDiffViewMode', value: savedDiffMode })
        }
      } catch {
        // Not in a worktree, or revparse failed; nothing to restore.
      }
    })()
    return () => { cancelled = true }
  }, [git, dispatch])

  // Audit finding #2: re-resolve the repo root inline on every save
  // and key the deps off `git` + the saved value. The original
  // implementation read from `repoRootRef.current`, which is async-
  // populated by the resolver effect above and can lag behind a git
  // swap. After #995's synchronous pop-restore, the parent's freshly
  // restored sidebar tab was being written into the submodule's
  // cache because the ref still held the submodule root during the
  // brief window before the resolver settled.
  //
  // The extra `revparse` cost per save is negligible (saves fire
  // once per user-initiated tab change, not per render) and the
  // cancellation flag prevents a stale resolution from racing a
  // newer one in flight.
  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const root = (await git.revparse(['--show-toplevel'])).trim()
        if (cancelled || !root) return
        saveSidebarTab(root, state.userSidebarTab)
      } catch {
        // Not in a worktree, or revparse failed — silently skip.
        // The next save attempt will retry.
      }
    })()
    return () => { cancelled = true }
  }, [state.userSidebarTab, git])

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const root = (await git.revparse(['--show-toplevel'])).trim()
        if (cancelled || !root) return
        saveDiffViewMode(root, state.diffViewMode)
      } catch {
        // Same as above.
      }
    })()
    return () => { cancelled = true }
  }, [state.diffViewMode, git])

  // P-stash-explorer: load `git stash show -p <ref>` once the diff view
  // becomes active with diffSource='stash'. Best-effort — empty stashes
  // or read errors fall through to a "no diff" hint at the render site.
  React.useEffect(() => {
    if (state.activeView !== 'diff' || state.diffSource !== 'stash' || !state.stashDiffRef) {
      return
    }
    let active = true
    setStashDiffLoading(true)
    void (async () => {
      const lines = await safe(getStashDiff(git, state.stashDiffRef!))
      if (active) {
        setStashDiffLines(lines || [])
        setStashDiffLoading(false)
      }
    })()
    return () => { active = false }
  }, [git, state.activeView, state.diffSource, state.stashDiffRef])

  // #879 (item 2) — load commit detail for the active bisect's
  // current candidate so the bisect surface can show "what changed
  // here" alongside the decision keys. Mirrors the history-detail
  // loader's shape but keyed on `bisect.currentSha` and only fires
  // when the bisect view is active. Best-effort: any failure leaves
  // the surface in its non-detail mode (decision log only) — never
  // crash the workstation because git couldn't resolve a sha.
  const [bisectCandidateDetail, setBisectCandidateDetail] = React.useState<GitCommitDetail | undefined>(undefined)
  const [bisectCandidateLoading, setBisectCandidateLoading] = React.useState(false)
  const bisectCandidateSha = state.activeView === 'bisect' && context.bisect?.active
    ? context.bisect.currentSha
    : ''
  React.useEffect(() => {
    if (!bisectCandidateSha) {
      setBisectCandidateDetail(undefined)
      setBisectCandidateLoading(false)
      return
    }
    let active = true
    setBisectCandidateLoading(true)
    void (async () => {
      const next = await safe(getCommitDetail(git, bisectCandidateSha))
      if (active) {
        setBisectCandidateDetail(next)
        setBisectCandidateLoading(false)
      }
    })()
    return () => { active = false }
  }, [git, bisectCandidateSha])

  // #779 — load `git diff <base>..<head>` once the diff view becomes
  // active with diffSource='compare'. Mirrors the stash loader's
  // shape; the surface renders the lines via the same +/-/@@ coloring
  // path. On unknown ref / git error, `safe()` swallows and the
  // surface falls back to a "no diff" hint.
  const compareBaseRef = state.compareBase?.ref
  const compareHeadRef = state.compareHead?.ref
  React.useEffect(() => {
    if (
      state.activeView !== 'diff' ||
      state.diffSource !== 'compare' ||
      !compareBaseRef ||
      !compareHeadRef
    ) {
      return
    }
    let active = true
    setCompareDiffLoading(true)
    void (async () => {
      const lines = await safe(getCompareDiff(git, compareBaseRef, compareHeadRef))
      if (active) {
        setCompareDiffLines(lines || [])
        setCompareDiffLoading(false)
      }
    })()
    return () => { active = false }
  }, [git, state.activeView, state.diffSource, compareBaseRef, compareHeadRef])

  // Reset compare-diff state whenever the diff view exits. Without
  // this, opening a new compare immediately after closing one would
  // briefly show the previous comparison's lines while the new
  // loader runs.
  React.useEffect(() => {
    if (state.diffSource !== 'compare') {
      setCompareDiffLines(undefined)
      setCompareDiffLoading(false)
    }
  }, [state.diffSource])

  React.useEffect(() => {
    let active = true

    async function loadWorktreeHunks(): Promise<void> {
      if (state.activeView !== 'diff' || !selectedWorktreeFile) {
        setWorktreeHunks(undefined)
        setWorktreeHunksLoading(false)
        return
      }

      setWorktreeHunksLoading(true)
      const nextHunks = await safe(getWorktreeHunks(git, selectedWorktreeFile))

      if (active) {
        setWorktreeHunks(nextHunks)
        setWorktreeHunksLoading(false)
      }
    }

    void loadWorktreeHunks()

    return () => {
      active = false
    }
  }, [
    git,
    selectedWorktreeFile?.indexStatus,
    selectedWorktreeFile?.path,
    selectedWorktreeFile?.worktreeStatus,
    state.activeView,
  ])

  // #931 PR 5 — Cache-aware boot load. The frame's `git` instance is
  // the dep that drives this effect; on push, the new frame's runtime
  // starts every key in `'loading'` and we fetch fresh. On pop, the
  // parent's runtime carries cached context across the drill-out cycle
  // (`'ready'` for already-loaded keys), and the per-key gate below
  // skips the fetch so the user's drill-out is instant + flicker-free.
  //
  // `contextStatusRef` reads the latest status without putting
  // `contextStatus` in the effect deps — including it would re-fire
  // the effect on every per-key 'ready' write the effect itself
  // produces, causing duplicate in-flight fetches for not-yet-completed
  // keys. The ref pattern gives us "read latest" semantics with the
  // effect still gated on git swaps only.
  const contextStatusRef = React.useRef(contextStatus)
  contextStatusRef.current = contextStatus
  React.useEffect(() => {
    // #994 — capture the depth this boot load is being issued for.
    // The git instance in the closure is bound to this frame; tagged
    // writes ensure resolved values land on the correct runtime entry
    // even if a subsequent push/pop changes the active frame mid-load.
    const issuedAtDepth = runtimes.length - 1
    let active = true

    loadLogInkContextEntries(git).forEach(({ key, load }) => {
      if (contextStatusRef.current[key] === 'ready') return
      void load().then((value) => {
        if (!active) {
          return
        }

        setContext(
          (current) => ({
            ...current,
            [key]: value,
          }),
          issuedAtDepth,
        )
        setContextStatus(
          (current) => updateLogInkContextStatus(current, key, 'ready'),
          issuedAtDepth,
        )
      })
    })

    return () => {
      active = false
    }
  }, [git, runtimes.length, setContext, setContextStatus])

  // Lazy-load the full pullRequest overview (#808). Only fires when
  // the user actually navigates to the PR view, and only when we
  // don't already have data (so a workflow-triggered refresh that
  // hydrated `pullRequest` doesn't re-fetch on view entry). The
  // dedicated PR view shows its own loading state while this is in
  // flight; everywhere else (header glyph, yank, workflow runner)
  // already falls through to the slim `provider.currentPullRequest`
  // so the chrome stays populated immediately on boot.
  React.useEffect(() => {
    if (state.activeView !== 'pull-request') return
    if (context.pullRequest) return
    const issuedAtDepth = runtimes.length - 1
    let active = true
    setContextStatus(
      (current) => updateLogInkContextStatus(current, 'pullRequest', 'loading'),
      issuedAtDepth,
    )
    void safe(getPullRequestOverview(git)).then((value) => {
      if (!active) return
      setContext(
        (current) => ({
          ...current,
          pullRequest: value,
        }),
        issuedAtDepth,
      )
      setContextStatus(
        (current) => updateLogInkContextStatus(current, 'pullRequest', 'ready'),
        issuedAtDepth,
      )
    })
    return () => {
      active = false
    }
  }, [git, runtimes.length, state.activeView, context.pullRequest, setContext, setContextStatus])

  // Lazy-load the issue triage list (#882 phase 3, filter-aware
  // since phase 6). Fires on entry to the view AND on filter
  // preset changes (`f` cycles the preset; the dep on
  // `state.selectedIssueFilter` triggers the refetch). The
  // existing `context.issueList` guard collapses to a no-op when
  // the preset hasn't changed and data is already loaded.
  React.useEffect(() => {
    if (state.activeView !== 'issues') return
    if (context.issueList) return
    const issuedAtDepth = runtimes.length - 1
    let active = true
    setContextStatus(
      (current) => updateLogInkContextStatus(current, 'issueList', 'loading'),
      issuedAtDepth,
    )
    const filter = issueFilterForPreset(state.selectedIssueFilter)
    void safe(getIssueList(git, filter)).then((value) => {
      if (!active) return
      setContext(
        (current) => ({
          ...current,
          issueList: value,
        }),
        issuedAtDepth,
      )
      setContextStatus(
        (current) => updateLogInkContextStatus(current, 'issueList', 'ready'),
        issuedAtDepth,
      )
    })
    return () => {
      active = false
    }
  }, [
    git,
    runtimes.length,
    state.activeView,
    context.issueList,
    state.selectedIssueFilter,
    setContext,
    setContextStatus,
  ])

  // Filter cycling: when the preset changes, drop the cached list
  // so the effect above re-fires with the new filter. Done as a
  // separate effect (rather than folded into the cycle reducer)
  // because the reducer is pure — fs / network side-effects live
  // in `useEffect`.
  React.useEffect(() => {
    if (state.activeView !== 'issues') return
    setContext((current) => (current.issueList ? { ...current, issueList: undefined } : current))
    setContextStatus((current) => updateLogInkContextStatus(current, 'issueList', 'idle'))
    // We deliberately depend ONLY on the preset — not on
    // activeView — so re-entering the view doesn't re-fire and
    // discard the just-loaded data. The activeView guard above
    // keeps us from clearing data while the user is on a
    // different surface.
  }, [state.selectedIssueFilter])

  // Lazy-load the PR triage list (#882 phase 3, filter-aware
  // since phase 6). Same pattern as the issue effect above.
  React.useEffect(() => {
    if (state.activeView !== 'pull-request-triage') return
    if (context.pullRequestList) return
    const issuedAtDepth = runtimes.length - 1
    let active = true
    setContextStatus(
      (current) => updateLogInkContextStatus(current, 'pullRequestList', 'loading'),
      issuedAtDepth,
    )
    const filter = pullRequestFilterForPreset(state.selectedPullRequestFilter)
    void safe(getPullRequestList(git, filter)).then((value) => {
      if (!active) return
      setContext(
        (current) => ({
          ...current,
          pullRequestList: value,
        }),
        issuedAtDepth,
      )
      setContextStatus(
        (current) => updateLogInkContextStatus(current, 'pullRequestList', 'ready'),
        issuedAtDepth,
      )
    })
    return () => {
      active = false
    }
  }, [
    git,
    runtimes.length,
    state.activeView,
    context.pullRequestList,
    state.selectedPullRequestFilter,
    setContext,
    setContextStatus,
  ])

  React.useEffect(() => {
    if (state.activeView !== 'pull-request-triage') return
    setContext((current) =>
      current.pullRequestList ? { ...current, pullRequestList: undefined } : current
    )
    setContextStatus((current) => updateLogInkContextStatus(current, 'pullRequestList', 'idle'))
  }, [state.selectedPullRequestFilter])

  // Per-item inspector hydration (#882 follow-up to phase 6). When
  // the user rests the cursor on an issue / PR row for ~250ms, fetch
  // the body + comments (+ reviews + status checks for PRs) and
  // cache the result keyed by number. Cursoring back to a previously-
  // fetched item shows the cached entry instantly; rapid j/k
  // navigation never fires a `gh` call because the debounce timer
  // resets on every cursor move.
  //
  // The cache lives on `context.{issueDetailByNumber,
  // pullRequestDetailByNumber}` so it survives the per-keystroke
  // re-renders. It's intentionally Maps — `new Map(prev).set(k, v)`
  // keeps the immutable update story simple, and entries persist
  // until either the list is invalidated (post-mutation) or the
  // process exits.
  const DETAIL_HYDRATION_DELAY_MS = 250

  React.useEffect(() => {
    if (state.activeView !== 'issues') return
    const cursored = filteredIssueList[
      Math.min(state.selectedIssueIndex, Math.max(0, filteredIssueList.length - 1))
    ]
    if (!cursored) return
    if (context.issueDetailByNumber?.has(cursored.number)) return

    const issuedAtDepth = runtimes.length - 1
    let active = true
    const timer = setTimeout(async () => {
      const result = await getIssueDetail(cursored.number)
      if (!active || !result.ok) return
      setContext(
        (current) => ({
          ...current,
          issueDetailByNumber: new Map(current.issueDetailByNumber || []).set(
            result.detail.number,
            result.detail
          ),
        }),
        issuedAtDepth,
      )
    }, DETAIL_HYDRATION_DELAY_MS)

    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [
    runtimes.length,
    state.activeView,
    state.selectedIssueIndex,
    filteredIssueList,
    context.issueDetailByNumber,
    setContext,
  ])

  React.useEffect(() => {
    if (state.activeView !== 'pull-request-triage') return
    const cursored = filteredPullRequestTriageList[
      Math.min(
        state.selectedPullRequestTriageIndex,
        Math.max(0, filteredPullRequestTriageList.length - 1)
      )
    ]
    if (!cursored) return
    if (context.pullRequestDetailByNumber?.has(cursored.number)) return

    const issuedAtDepth = runtimes.length - 1
    let active = true
    const timer = setTimeout(async () => {
      const result = await getPullRequestDetail(cursored.number)
      if (!active || !result.ok) return
      setContext(
        (current) => ({
          ...current,
          pullRequestDetailByNumber: new Map(current.pullRequestDetailByNumber || []).set(
            result.detail.number,
            result.detail
          ),
        }),
        issuedAtDepth,
      )
    }, DETAIL_HYDRATION_DELAY_MS)

    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [
    runtimes.length,
    state.activeView,
    state.selectedPullRequestTriageIndex,
    filteredPullRequestTriageList,
    context.pullRequestDetailByNumber,
    setContext,
  ])

  React.useEffect(() => {
    let active = true

    async function loadDetail(): Promise<void> {
      if (!selected) {
        setDetail(undefined)
        return
      }

      setDetailLoading(true)
      const nextDetail = await safe(getCommitDetail(git, selected.hash))

      if (active) {
        setDetail(nextDetail)
        setDetailLoading(false)
      }
    }

    void loadDetail()

    return () => {
      active = false
    }
  }, [git, selected?.hash])

  // #806 follow-up — auto-jump the history view to whichever branch /
  // tag the user is currently cursoring in the sidebar (or the
  // dedicated branches / tags view).
  //
  // Originally this fired on a 150ms trailing-edge debounce. The user
  // reported the sync feeling inconsistent (#839) — the trailing
  // pattern means a fast scroll through a long branch list cancels
  // the timer on every keystroke and only fires once on release; the
  // user never sees the cursor follow their navigation. Switched to
  // synchronous fire-on-effect so each cursor move snaps the history
  // graph immediately. The dispatch is cheap (O(n) findIndex on the
  // filtered commits + a state spread); React batches the re-renders
  // so even rapid scroll only paints the final position. Tracks the
  // last-dispatched hash via a ref so we don't fire setStatus
  // repeatedly when several adjacent branches all point at the same
  // commit (very common with squash-merged feature branches that all
  // converge on `main`'s tip).
  //
  // No-op when the cursored ref's tip isn't in the loaded commit
  // window (under compact mode the cursored branch's tip may not be
  // fetched yet); a status hint surfaces in that case so the user
  // knows to toggle full graph or load older commits.
  const lastSyncedHashRef = React.useRef<string | undefined>(undefined)
  // Tracks which target hashes we've already anchored a `git log`
  // fetch on (#1034 follow-up). When the cursor-syncs-history effect
  // sees a target whose hash isn't in the loaded window AND isn't in
  // this set, it kicks off `getLogRowsAnchoredOn` and adds the hash
  // here. After the fetch resolves and rows are appended, the effect
  // re-fires; if the target STILL isn't loaded the resolver sees the
  // hash in this set and returns `unreachable` instead of looping.
  //
  // Stored as a ref because (a) the resolver only ever reads it and
  // (b) component re-renders on state.filteredCommits change are the
  // re-fire trigger; storing here in state would add a redundant
  // render per attempt.
  const attemptedContextHashesRef = React.useRef<Set<string>>(new Set())
  // Forward-reference for the targeted context loader. Defined later
  // in the component body — see the load-more refactor for why this
  // forward-ref pattern is needed and why the implementation is stable
  // so the race that bit the previous auto-load chain doesn't recur.
  type LoadCommitContextFn = (target: { hash: string; label: string }) => Promise<void>
  const loadCommitContextRef = React.useRef<LoadCommitContextFn | null>(null)
  React.useEffect(() => {
    const onBranchTab = state.activeView === 'branches' ||
      (state.focus === 'sidebar' && state.sidebarTab === 'branches')
    const onTagTab = state.activeView === 'tags' ||
      (state.focus === 'sidebar' && state.sidebarTab === 'tags')
    // User-reported gap: cursoring a stash didn't sync the history
    // cursor the way cursoring a branch / tag did. Same auto-jump
    // affordance now extends to stashes; the stash's commit hash IS
    // the row to land on (stashes are commits living off the
    // `refs/stash` tree, visible under `--all` / fullGraph).
    const onStashTab = state.activeView === 'stash' ||
      (state.focus === 'sidebar' && state.sidebarTab === 'stashes')
    if (!onBranchTab && !onTagTab && !onStashTab) return

    let targetHash: string | undefined
    let targetLabel: string | undefined

    if (onBranchTab) {
      const all = sortBranches(context.branches?.localBranches || [], state.branchSort)
      const visible = state.filter
        ? all.filter((b) => matchesPromotedFilter([b.shortName, b.upstream || ''], state.filter))
        : all
      const branch = visible[Math.min(state.selectedBranchIndex, Math.max(0, visible.length - 1))]
      if (branch) {
        targetHash = branch.hash
        targetLabel = `branch ${branch.shortName}`
      }
    } else if (onTagTab) {
      const all = sortTags(context.tags?.tags || [], state.tagSort)
      const visible = state.filter
        ? all.filter((t) => matchesPromotedFilter([t.name, t.subject], state.filter))
        : all
      const tag = visible[Math.min(state.selectedTagIndex, Math.max(0, visible.length - 1))]
      if (tag) {
        targetHash = tag.hash
        targetLabel = `tag ${tag.name}`
      }
    } else if (onStashTab) {
      const all = context.stashes?.stashes || []
      const visible = state.filter
        ? all.filter((s) => matchesPromotedFilter([s.ref, s.message], state.filter))
        : all
      const stash = visible[Math.min(state.selectedStashIndex, Math.max(0, visible.length - 1))]
      if (stash) {
        // Two-step fallback chain for stash cursor sync:
        //
        //   1. Try `baseHash` (the branch tip the stash was created
        //      from). This answers the user-visible question "where
        //      in larger git history was this stash made?" — that's
        //      the branch origin point, not the stash's own merge-
        //      commit row off in `refs/stash`. Base commits live on
        //      regular branches so they're almost always in the
        //      loaded window.
        //
        //   2. If `baseHash` isn't in the loaded window (the stash's
        //      base branch was deleted, or the base is older than
        //      the 1000-commit cap), fall back to `stash.hash`
        //      itself. The stash commit was added as an extraRef so
        //      it's reachable from the graph if it fits the window.
        //
        // Only after BOTH miss does the effect report "tip not in
        // loaded window." The label flips to mention "base" vs the
        // stash commit so the user knows what they're looking at.
        // hashesMatchAny handles the short-hash auto-extension
        // mismatch between `git stash list --format=%h` (stash hash)
        // and `git log --pretty=format:%h` (history row). Same
        // hazard as the branch/tag cursor sync — see src/git/hashes.ts.
        const baseLoaded = Boolean(stash.baseHash) && state.filteredCommits.some((c) =>
          hashesMatchAny(stash.baseHash, [c.hash, c.shortHash])
        )
        const hashLoaded = state.filteredCommits.some((c) =>
          hashesMatchAny(stash.hash, [c.hash, c.shortHash])
        )
        if (baseLoaded) {
          targetHash = stash.baseHash
          targetLabel = `${stash.ref}'s base`
        } else if (hashLoaded) {
          targetHash = stash.hash
          targetLabel = stash.ref
        } else {
          // Neither in window — set to baseHash so the standard
          // "not in loaded window" message fires with a meaningful
          // label (the base is what the user actually wants to see).
          targetHash = stash.baseHash || stash.hash
          targetLabel = stash.ref
        }
      }
    }

    // Delegate the actual decision to the pure resolver so the
    // logic is testable in isolation. The effect just performs the
    // resolver's chosen action.
    const decision = resolveCursorSyncDecision({
      target: targetHash ? { hash: targetHash, label: targetLabel || targetHash } : undefined,
      loadedHashes: buildLoadedHashSet(state.filteredCommits),
      lastSyncedHash: lastSyncedHashRef.current,
      attemptedContextHashes: attemptedContextHashesRef.current,
    })

    switch (decision.type) {
      case 'noop':
        return
      case 'jump':
        lastSyncedHashRef.current = decision.hash
        dispatch({ type: 'selectCommitByHash', hash: decision.hash })
        dispatch({
          type: 'setStatus',
          value: `Synced history to ${decision.label} tip`,
        })
        return
      case 'load-context':
        // Mark the hash as attempted BEFORE firing the load so a
        // re-fire of this effect (state.filteredCommits change while
        // the load is in flight) doesn't kick off a duplicate
        // request. The resolver sees the hash in the set and
        // returns `noop` until the load completes; on completion the
        // appendRows triggers a final re-fire that either jumps or
        // returns `unreachable`.
        attemptedContextHashesRef.current.add(decision.target.hash)
        void loadCommitContextRef.current?.(decision.target)
        return
      case 'unreachable':
        dispatch({
          type: 'setStatus',
          value: `${decision.target.label} target commit is unreachable — not in any walked ref's history.`,
          kind: 'warning',
        })
        return
    }
  }, [
    dispatch, context.branches, context.tags, context.stashes,
    state.activeView, state.focus, state.sidebarTab,
    state.selectedBranchIndex, state.selectedTagIndex, state.selectedStashIndex,
    state.branchSort, state.tagSort, state.filter,
    state.filteredCommits,
  ])

  // Reset the dedup ref when the user moves focus away from the
  // sidebar branches / tags / stashes tab so re-entering re-fires the
  // sync even if the cursored row is the same as before.
  React.useEffect(() => {
    const onBranchTab = state.activeView === 'branches' ||
      (state.focus === 'sidebar' && state.sidebarTab === 'branches')
    const onTagTab = state.activeView === 'tags' ||
      (state.focus === 'sidebar' && state.sidebarTab === 'tags')
    const onStashTab = state.activeView === 'stash' ||
      (state.focus === 'sidebar' && state.sidebarTab === 'stashes')
    if (!onBranchTab && !onTagTab && !onStashTab) {
      lastSyncedHashRef.current = undefined
      // Drop any context-load attempt tracking too. If the user
      // navigates back later we want to retry rather than show
      // "unreachable" based on a stale attempted-set.
      attemptedContextHashesRef.current = new Set()
    }
  }, [state.activeView, state.focus, state.sidebarTab])

  React.useEffect(() => {
    let active = true

    async function loadWorktreeDiff(): Promise<void> {
      if (state.activeView !== 'diff' || !selectedWorktreeFile) {
        setWorktreeDiff(undefined)
        setWorktreeDiffLoading(false)
        return
      }

      setWorktreeDiffLoading(true)
      const nextDiff = await safe(getWorktreeFileDiff(git, selectedWorktreeFile))

      if (active) {
        setWorktreeDiff(nextDiff)
        setWorktreeDiffLoading(false)
      }
    }

    void loadWorktreeDiff()

    return () => {
      active = false
    }
  }, [
    git,
    selectedWorktreeFile?.indexStatus,
    selectedWorktreeFile?.path,
    selectedWorktreeFile?.worktreeStatus,
    state.activeView,
  ])

  // Syntax-highlight the diff currently in view, off the render path
  // (#1117 follow-up). Mirrors the worktree-diff effect: detect the
  // active file + its diff lines (worktree or commit source), tokenize
  // via tree-sitter, and store the per-line spans for the renderer.
  // Stash / compare sources aren't highlighted yet (multi-file patch /
  // no single path). Gated on the config flag + a color terminal.
  React.useEffect(() => {
    if (!syntaxHighlightEnabled || theme.noColor || state.activeView !== 'diff') {
      setDiffSyntaxSpans(undefined)
      return
    }
    let filePath: string | undefined
    let lines: string[] | undefined
    if (state.diffSource === 'commit') {
      filePath = selectedDetailFile?.path
      lines = filePreview?.hunks
    } else if (worktreeDiff && !worktreeDiff.untracked) {
      filePath = worktreeDiff.filePath
      lines = worktreeDiff.lines
    }
    if (!filePath || !lines || lines.length === 0) {
      setDiffSyntaxSpans(undefined)
      return
    }
    let active = true
    void highlightDiffCode(filePath, lines)
      .then((map) => {
        if (active) setDiffSyntaxSpans(map.size > 0 ? map : undefined)
      })
      .catch(() => {
        if (active) setDiffSyntaxSpans(undefined)
      })
    return () => {
      active = false
    }
  }, [
    syntaxHighlightEnabled,
    theme.noColor,
    state.activeView,
    state.diffSource,
    selectedDetailFile?.path,
    filePreview,
    worktreeDiff,
  ])

  const toggleSelectedFileStage = React.useCallback(async () => {
    if (!selectedWorktreeFile) {
      dispatch({ type: 'setStatus', value: 'no worktree file selected', kind: 'warning' })
      return
    }

    dispatch({ type: 'setStatus', value: 'updating file stage state' })
    const result = selectedWorktreeFile.state === 'staged'
      ? await unstageFile(git, selectedWorktreeFile)
      : await stageFile(git, selectedWorktreeFile)

    dispatch({ type: 'setStatus', value: result.message })
    await refreshWorktreeContext()
    setWorktreeDiff(undefined)
    setWorktreeHunks(undefined)
  }, [dispatch, git, refreshWorktreeContext, selectedWorktreeFile])

  const toggleSelectedHunkStage = React.useCallback(async () => {
    const selectedHunk = worktreeHunks?.hunks[state.selectedWorktreeHunkIndex]

    if (!selectedHunk) {
      dispatch({ type: 'setStatus', value: 'no hunk selected', kind: 'warning' })
      return
    }

    dispatch({ type: 'setStatus', value: 'updating hunk stage state' })
    try {
      if (selectedHunk.state === 'staged') {
        await unstageHunk(git, selectedHunk)
      } else {
        await stageHunk(git, selectedHunk)
      }

      dispatch({
        type: 'setStatus',
        value: `${selectedHunk.state === 'staged' ? 'Unstaged' : 'Staged'} hunk`,
        kind: 'success',
      })
      await refreshWorktreeContext()
      setWorktreeDiff(undefined)
      setWorktreeHunks(undefined)
    } catch (error) {
      dispatch({
        type: 'setStatus',
        value: (error as Error).message || 'failed to update hunk stage state',
        kind: 'error',
      })
    }
  }, [dispatch, git, refreshWorktreeContext, state.selectedWorktreeHunkIndex, worktreeHunks])

  const revertSelectedFile = React.useCallback(async () => {
    if (!selectedWorktreeFile) {
      dispatch({ type: 'setStatus', value: 'no worktree file selected', kind: 'warning' })
      return
    }

    dispatch({ type: 'setStatus', value: 'reverting selected file' })
    const result = await revertFile(git, selectedWorktreeFile)

    dispatch({ type: 'setStatus', value: result.message })
    await refreshWorktreeContext()
    setWorktreeDiff(undefined)
    setWorktreeHunks(undefined)
  }, [dispatch, git, refreshWorktreeContext, selectedWorktreeFile])

  const revertSelectedHunk = React.useCallback(async () => {
    const selectedHunk = worktreeHunks?.hunks[state.selectedWorktreeHunkIndex]

    if (!selectedHunk) {
      dispatch({ type: 'setStatus', value: 'no hunk selected', kind: 'warning' })
      return
    }

    dispatch({ type: 'setStatus', value: 'reverting selected hunk' })
    try {
      await revertHunk(git, selectedHunk)
      dispatch({ type: 'setStatus', value: `Reverted hunk in ${selectedHunk.filePath}`, kind: 'success' })
      await refreshWorktreeContext()
      setWorktreeDiff(undefined)
      setWorktreeHunks(undefined)
    } catch (error) {
      dispatch({
        type: 'setStatus',
        value: (error as Error).message || 'failed to revert hunk',
        kind: 'error',
      })
    }
  }, [dispatch, git, refreshWorktreeContext, state.selectedWorktreeHunkIndex, worktreeHunks])

  const createCommitFromCompose = React.useCallback(async () => {
    const stagedCount = context.worktree?.stagedCount || 0

    if (!stagedCount) {
      dispatch({ type: 'setStatus', value: 'stage changes before committing', kind: 'warning' })
      return
    }

    dispatch({ type: 'commitCompose', action: { type: 'setLoading', value: true } })
    dispatch({ type: 'setStatus', value: 'creating commit' })
    const result = await createManualCommit({
      git,
      summary: state.commitCompose.summary,
      body: state.commitCompose.body,
    })

    dispatch({
      type: 'commitCompose',
      action: { type: 'setResult', message: result.message, details: result.details },
    })
    dispatch({ type: 'setStatus', value: result.message })

    if (result.ok) {
      dispatch({ type: 'commitCompose', action: { type: 'reset' } })
      // Refresh BOTH worktree AND history rows — the new commit
      // needs to show up in the history view, not just the staged
      // counts. Without refreshHistoryRows the user would press `gh`
      // and see the pre-commit log (same silent-failure shape as
      // the split-apply case caught in this PR).
      await refreshHistoryRows()
      const worktree = await refreshWorktreeContext()
      // Leave the compose view automatically: a still-dirty tree returns
      // to Status (so the user can keep staging), an otherwise-complete
      // commit returns to History (where the new commit now shows). The
      // reducer inspects the live viewStack to pick the destination.
      const stillDirty = Boolean(
        worktree &&
          worktree.stagedCount + worktree.unstagedCount + worktree.untrackedCount > 0,
      )
      dispatch({ type: 'returnFromCommit', stillDirty })
    }
  }, [
    context.worktree?.stagedCount,
    dispatch,
    git,
    refreshHistoryRows,
    refreshWorktreeContext,
    state.commitCompose.body,
    state.commitCompose.summary,
  ])

  // AbortController for the in-flight AI draft (#881 phase 3). Kept in
  // a ref rather than state because cancel is a side-effect: the input
  // handler reads `controllerRef.current?.abort()` synchronously when
  // Esc fires during a loading draft. Storing it in state would force
  // a re-render on every set, and React doesn't need to know — only
  // the imperative cancel path does. Cleared after each call settles
  // so a stale controller can't cancel a future draft.
  const aiDraftAbortRef = React.useRef<AbortController | null>(null)

  const runAiCommitDraft = React.useCallback(async () => {
    // Tear down any controller from a previous draft (defensive — a
    // settled call should have cleared it in the finally block, but
    // double-running would otherwise leave the first orphaned).
    aiDraftAbortRef.current?.abort()
    const controller = new AbortController()
    aiDraftAbortRef.current = controller

    dispatch({ type: 'commitCompose', action: { type: 'setLoading', value: true } })
    dispatch({ type: 'setStatus', value: 'generating AI commit draft', loading: true })
    // Streaming preview (#881 phase 2). The workflow forwards this to
    // `generateCommitDraft`, which only actually streams when the
    // user opted in via `service.streaming.enabled`. The callback
    // updates `commitCompose.streamingPreview` so the compose surface
    // renders a live last-N-lines preview below the loader. The
    // reducer clears `streamingPreview` whenever loading flips off
    // (success or failure), so we don't need an explicit teardown
    // dispatch here.
    try {
      const result = await runCommitDraftWorkflow({
        git,
        signal: controller.signal,
        onStreamChunk: (_text, accumulated) => {
          // Audit finding #4: skip dispatching into a torn-down
          // tree. If the user quit (or otherwise unmounted the
          // workstation) mid-stream, React warns about updates on
          // an unmounted component. Drop the chunk silently.
          if (!mountedRef.current) return
          // Dispatch the full accumulated text — the preview chrome
          // helper does the last-N-lines slicing at render time, so
          // re-doing the slice here would be wasted work. Per-chunk
          // dispatches are cheap; React batches them and Ink redraws
          // at its own frame cadence.
          dispatch({
            type: 'commitCompose',
            action: { type: 'setStreamingPreview', value: accumulated },
          })
        },
      })

      // Audit finding #4 (unmount race): bail out before any
      // post-await dispatch if the user quit while the LLM call was
      // in flight. Same pattern as `refreshHistoryRows` upstream.
      if (!mountedRef.current) return

      // Cancel path (#881 phase 3). User pressed Esc during the
      // stream; reducer drops loading + preview, status line shows
      // a neutral "cancelled" message. Skip the result / failure
      // dispatches because the user already knows what happened.
      if (result.cancelled) {
        dispatch({ type: 'commitCompose', action: { type: 'setLoading', value: false } })
        dispatch({ type: 'setStatus', value: 'AI draft cancelled.', kind: 'info' })
        return
      }

      if (result.ok && result.draft) {
        dispatch({ type: 'commitCompose', action: { type: 'setDraft', value: result.draft } })
        dispatch({ type: 'setStatus', value: 'AI draft ready for editing', kind: 'success' })
        return
      }

      // Humanize provider errors (rate limit / auth / context / network)
      // into a short actionable line; success-but-no-draft keeps its
      // message as-is.
      const composeMessage = result.ok ? result.message : humanizeAiError(result.message)
      dispatch({
        type: 'commitCompose',
        action: { type: 'setResult', message: composeMessage, details: result.details },
      })
      dispatch({ type: 'setStatus', value: composeMessage, kind: result.ok ? undefined : 'error' })
    } catch (error) {
      // Audit finding #3: defensive recovery for unexpected throws
      // from the workflow. The workflow catches its own errors
      // today, so this catch is latent — but any future refactor
      // that lets an error escape would otherwise strand the
      // spinner permanently with no user-facing recovery short of
      // quitting. Surface a generic failure and clear the loading
      // state so the user can re-try.
      if (mountedRef.current) {
        dispatch({ type: 'commitCompose', action: { type: 'setLoading', value: false } })
        dispatch({
          type: 'setStatus',
          value: `AI draft failed unexpectedly: ${
            error instanceof Error ? error.message : String(error)
          }`,
          kind: 'error',
        })
      }
    } finally {
      // Clear the ref only if it still points at OUR controller — a
      // rapid second invocation could have already replaced it, in
      // which case the new controller is the one that owns cancel
      // duty now.
      if (aiDraftAbortRef.current === controller) {
        aiDraftAbortRef.current = null
      }
    }
  }, [dispatch, git])

  /**
   * Cancel an in-flight AI draft (#881 phase 3). Called by the input
   * handler when the user presses Esc while `commitCompose.loading`
   * is true. Idempotent — calling without an active controller is a
   * no-op rather than an error so the keystroke handler can fire
   * unconditionally during the loading window.
   *
   * `controller.abort()` propagates through
   * `executeChainStreaming`, which throws `LangChainCancelledError`,
   * which becomes `cancelled: true` on the workflow result. The
   * runAiCommitDraft promise's finally block clears the ref. The
   * resulting cleanup dispatches (clearing loading + status) happen
   * back in `runAiCommitDraft`, not here, so this function stays
   * pure-imperative and the React state updates flow through a
   * single code path.
   */
  const cancelAiCommitDraft = React.useCallback(() => {
    aiDraftAbortRef.current?.abort()
  }, [])

  // `C` keystroke handler — start the create-pull-request flow. Resolves
  // the head + base branches from the live context, runs
  // `coco changelog --branch <base>` (via `runPullRequestBodyWorkflow`)
  // to seed a title + body, then opens a multi-line input prompt
  // pre-filled with that content for the user to edit before submission.
  //
  // On submit, the workflow handler `'create-pr'` parses the prompt
  // value (line 1 = title, lines 2+ = body) and runs
  // `createPullRequest({ base, head, title, body })`. If anything in the
  // pre-flight goes sideways (no current branch, no provider, gh CLI
  // missing) we surface the failure on the status line and skip the
  // prompt entirely — better than opening a prompt the user can't
  // actually submit successfully.
  // Soft-cancel handle for the PR body draft (#881 phase 4). A mutable
  // ref rather than state because the cancel decision needs to be
  // visible synchronously inside the async workflow without forcing
  // re-renders. Owned by the in-flight invocation: the cancel callback
  // mutates `.cancelled` on the live ref; the workflow checks it after
  // `await` resolves and decides whether to open the follow-up prompt.
  //
  // The LLM call itself keeps running (no AbortSignal threaded through
  // `changelogHandler` today). The user-visible outcome — "PR draft
  // cancelled, no prompt opens" — is identical to a hard cancel, at
  // the cost of paying for the in-flight tokens. Deeper threading
  // lands in a follow-up if hard cancel becomes a request.
  const pullRequestBodyCancelRef = React.useRef<{ cancelled: boolean } | null>(null)
  const startCreatePullRequest = React.useCallback(async () => {
    const head = context.branches?.currentBranch || context.provider?.currentBranch
    if (!head) {
      dispatch({ type: 'setStatus', value: 'No current branch to create a PR from.', kind: 'warning' })
      return
    }
    const defaultBranch = context.provider?.repository.defaultBranch
    if (!defaultBranch) {
      dispatch({
        type: 'setStatus',
        value: 'No default branch detected. Set origin/HEAD or ensure main/master exists locally.',
        kind: 'warning',
      })
      return
    }
    if (head === defaultBranch) {
      dispatch({ type: 'setStatus', value: `Current branch is ${defaultBranch}; check out a feature branch first.`, kind: 'warning' })
      return
    }
    if (context.pullRequest?.currentPullRequest || context.provider?.currentPullRequest) {
      const existing = context.pullRequest?.currentPullRequest || context.provider?.currentPullRequest
      dispatch({
        type: 'setStatus',
        value: existing
          ? `PR #${existing.number} already open for ${head}. Use the PR view to manage it.`
          : `A pull request is already open for ${head}.`,
        kind: 'warning',
      })
      return
    }

    // Set up the cancel handle BEFORE flipping the pending flag so a
    // race between the flag-set and a synchronous Esc keystroke can't
    // leave the input handler dispatching cancel without a ref to
    // mutate. The cancel callback no-ops cleanly when the ref is null
    // (call already settled).
    const cancelHandle = { cancelled: false }
    pullRequestBodyCancelRef.current = cancelHandle

    dispatch({ type: 'setPendingPullRequestBodyDraft', value: true })
    // Audit finding #6: soft cancel today — Esc skips opening the
    // follow-up prompt, but the LLM call itself keeps running to
    // completion (no AbortSignal threaded through the changelog CLI
    // chain). Status copy reflects that honestly so the user isn't
    // misled into thinking they're saving tokens.
    dispatch({
      type: 'setStatus',
      value: `generating PR body from changelog (vs ${defaultBranch}) — Esc to skip prompt`,
      loading: true,
    })

    try {
      const body = await runPullRequestBodyWorkflow({ baseBranch: defaultBranch })

      // Soft-cancel check (#881 phase 4). If the user pressed Esc
      // while the workflow was awaiting, skip opening the prompt and
      // surface a neutral status. The underlying LLM call has
      // already settled — its result is discarded. Hard cancel
      // (aborting the HTTP request mid-flight) is a follow-up.
      if (cancelHandle.cancelled) {
        dispatch({ type: 'setStatus', value: 'PR draft cancelled.' })
        return
      }

      // Fallback shape when the changelog generation fails — open the
      // prompt with empty title + body rather than aborting, so the user
      // can still author the PR manually. The status line surfaces why
      // we couldn't pre-fill.
      const initialTitle = body.title || head.replace(/^(feat|fix|chore|docs|refactor|test)\//, '').replace(/[-_]/g, ' ')
      const initialBody = body.body || ''
      const initial = initialBody ? `${initialTitle}\n\n${initialBody}` : initialTitle

      if (!body.ok) {
        dispatch({ type: 'setStatus', value: `PR body generation failed: ${body.message}. Edit manually.`, kind: 'error' })
      } else {
        dispatch({ type: 'setStatus', value: 'PR body drafted — review and Ctrl+D to submit.', kind: 'success' })
      }

      // Audit finding #11: clear the pending flag BEFORE opening the
      // prompt. If a future refactor adds an `await` between the flag
      // clear (currently in `finally`) and the `openInputPrompt`
      // dispatch, an Esc keystroke in the gap would dispatch
      // `cancelPullRequestBodyDraft` AFTER the prompt opens, leaving
      // the prompt visible with a stale "cancelled" message. Clearing
      // here moves the flag teardown into the same React batch as the
      // prompt open, eliminating the race.
      dispatch({ type: 'setPendingPullRequestBodyDraft', value: false })

      dispatch({
        type: 'openInputPrompt',
        kind: 'create-pr',
        label: `Create PR: ${head} → ${defaultBranch}  (line 1 title · rest body · Enter newline · Ctrl+D submit)`,
        initial,
        multiline: true,
      })
    } finally {
      // Belt-and-suspenders: the `try` block clears the flag on the
      // success path (audit finding #11). This duplicate clear handles
      // the error / cancel paths where the early-returns skip the
      // success-path dispatch. Safe to no-op when already false.
      dispatch({ type: 'setPendingPullRequestBodyDraft', value: false })
      // Only clear the ref if we still own it — a second invocation
      // would have already taken ownership in which case the cancel
      // duty has rolled over.
      if (pullRequestBodyCancelRef.current === cancelHandle) {
        pullRequestBodyCancelRef.current = null
      }
    }
  }, [
    context.branches?.currentBranch,
    context.provider?.currentBranch,
    context.provider?.currentPullRequest,
    context.provider?.repository.defaultBranch,
    context.pullRequest?.currentPullRequest,
    dispatch,
  ])

  /**
   * Soft-cancel the in-flight PR body draft (#881 phase 4). The
   * cancel ref's `.cancelled` flag is checked after the workflow's
   * await resolves; setting it true causes the workflow to skip the
   * prompt-open and surface a neutral "cancelled" status. The LLM
   * call itself isn't aborted (no signal threaded through the
   * `changelogHandler` chain) so the user still pays for the in-flight
   * tokens. Acceptable for a 5-15s draft; hard cancel lands in a
   * follow-up if it becomes a real ask.
   *
   * Idempotent — calling without an active draft is a no-op.
   */
  const cancelPullRequestBodyDraft = React.useCallback(() => {
    const handle = pullRequestBodyCancelRef.current
    if (!handle) return
    handle.cancelled = true
  }, [])

  // Copy an arbitrary string to the system clipboard. Distinct from
  // `yankFromActiveView` which derives the value from the current view
  // — this one takes the value as an explicit event payload, used by
  // the changelog view's `y` keystroke (and a candidate for future
  // "copy this" surfaces). Surfaces a status confirming what landed
  // in clipboard.
  const yankText = React.useCallback(async (value: string, label: string) => {
    const clipboard: ClipboardRunner = clipboardRunner || defaultClipboardRunner
    if (!value) {
      dispatch({ type: 'setStatus', value: `Nothing to copy — ${label} is empty.`, kind: 'warning' })
      return
    }
    try {
      await clipboard(value)
      dispatch({ type: 'setStatus', value: `Copied ${label} to clipboard.`, kind: 'success' })
    } catch (error) {
      dispatch({
        type: 'setStatus',
        value: `Copy failed (${label}): ${(error as Error).message}`,
        kind: 'error',
      })
    }
  }, [clipboardRunner, dispatch])

  // `L` keystroke handler — generate (or recall from cache) a changelog
  // for the current branch and push the dedicated `changelog` surface
  // to display it. The view renders the full text in the main panel
  // (not cramped into an input prompt), with its own keymap for scroll,
  // yank, $EDITOR, create-PR, and regenerate.
  //
  // Caching: `state.changelogCache` is keyed by branch name. On `L`,
  // we check the cache first and reuse if hit (no LLM call); the user
  // presses `r` from inside the view to force a regenerate. Switching
  // branches naturally produces a fresh generation since the cache key
  // changes.
  //
  // Surface lifecycle: we push the `changelog` view BEFORE awaiting the
  // workflow, so the user sees a loading state instead of a blank
  // history view while the LLM runs. On error, we keep the view pushed
  // and render the error there (with `r` to retry) instead of bailing
  // back to history with a status-line message that may scroll past.
  const startChangelogView = React.useCallback(async (options: { force?: boolean } = {}) => {
    const head = context.branches?.currentBranch || context.provider?.currentBranch
    if (!head) {
      dispatch({ type: 'setStatus', value: 'No current branch — check out a branch first.', kind: 'warning' })
      return
    }
    const defaultBranch = context.provider?.repository.defaultBranch
    // The changelog command will fall back to its own defaults when no
    // branch arg is passed, but being explicit about the base is more
    // honest about what the user is seeing. With the local default-
    // branch fallback in providerData (#912), `defaultBranch` is
    // populated even for non-GitHub / offline scenarios — we only fall
    // through to `--since-last-tag` when truly nothing resolves.
    const argv = defaultBranch && head !== defaultBranch
      ? { branch: defaultBranch }
      : { sinceLastTag: true }
    const baseLabel = defaultBranch && head !== defaultBranch
      ? `vs ${defaultBranch}`
      : 'since last tag'

    // Cache hit — skip the LLM, push view with ready content. The
    // generated-at timestamp on the cache entry drives the "(cached, N
    // ago)" hint in the header, so the user knows whether to press `r`.
    const cached = !options.force ? state.changelogCache[head] : undefined
    if (cached) {
      dispatch({ type: 'pushView', value: 'changelog' })
      dispatch({
        type: 'setChangelogReady',
        branch: head,
        baseLabel: cached.baseLabel,
        text: cached.text,
        // Audit finding #9: cache-hit path preserves the original
        // generation timestamp rather than minting a fresh one — the
        // "X ago" header should reflect when the LLM ran, not when
        // the cached entry was re-displayed.
        generatedAt: cached.generatedAt,
      })
      dispatch({
        type: 'setStatus',
        value: `Changelog loaded from cache (${cached.baseLabel}). r to regenerate.`,
      })
      return
    }

    // No cache (or force=true via `r`) — push view with loading state,
    // then run the workflow.
    dispatch({ type: 'pushView', value: 'changelog' })
    dispatch({ type: 'setChangelogLoading', branch: head, baseLabel })
    dispatch({ type: 'setStatus', value: `generating changelog (${baseLabel})…`, loading: true })

    const result = await runChangelogTextWorkflow(argv)

    if (!result.ok || !result.text) {
      dispatch({
        type: 'setChangelogError',
        branch: head,
        baseLabel,
        error: result.message,
      })
      dispatch({ type: 'setStatus', value: `Changelog failed: ${result.message}`, kind: 'error' })
      return
    }

    dispatch({
      type: 'setChangelogReady',
      branch: head,
      baseLabel,
      text: result.text,
      // Audit finding #9: timestamp captured at dispatch time, not
      // inside the reducer.
      generatedAt: Date.now(),
    })
    dispatch({
      type: 'setStatus',
      value: 'Changelog ready — y yank · E $EDITOR · c PR · r regen · < back.',
      kind: 'success',
    })
  }, [
    context.branches?.currentBranch,
    context.provider?.currentBranch,
    context.provider?.repository.defaultBranch,
    dispatch,
    state.changelogCache,
  ])

  // `r` keystroke inside the changelog view — re-run generation
  // ignoring any cached result. Thin wrapper since the underlying
  // logic in `startChangelogView` already supports the force path.
  const regenerateChangelog = React.useCallback(() => {
    void startChangelogView({ force: true })
  }, [startChangelogView])

  // `y` keystroke inside the changelog view — yank the current text
  // to the system clipboard. Pulled from view state rather than from
  // wherever the cursor is (no per-row selection on this surface).
  const yankChangelog = React.useCallback(() => {
    const text = state.changelogView.text
    if (!text) {
      dispatch({ type: 'setStatus', value: 'No changelog text to copy.', kind: 'warning' })
      return
    }
    void yankText(text, 'changelog')
  }, [dispatch, state.changelogView.text, yankText])

  // `E` keystroke inside the changelog view — open the current text in
  // $EDITOR / $VISUAL, read it back, update view + cache. Mirrors the
  // compose `E` flow (#913) but on the changelog-view state slice.
  // After save, `setChangelogText` updates both view and cache so the
  // edits persist across view re-entry.
  const openChangelogInEditor = React.useCallback(() => {
    const current = state.changelogView.text
    if (current === undefined) {
      dispatch({ type: 'setStatus', value: 'Changelog not loaded yet — wait for generation.', kind: 'warning' })
      return
    }

    let dir: string | undefined
    try {
      dir = mkdtempSync(nodePath.join(tmpdir(), 'coco-changelog-'))
    } catch (error) {
      dispatch({
        type: 'setStatus',
        value: `Failed to create temp file for editor: ${(error as Error).message}`,
        kind: 'error',
      })
      return
    }
    const file = nodePath.join(dir, 'CHANGELOG.md')
    try {
      writeFileSync(file, current, 'utf8')
    } catch (error) {
      dispatch({
        type: 'setStatus',
        value: `Failed to seed temp file: ${(error as Error).message}`,
        kind: 'error',
      })
      try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
      return
    }

    const editorEnv = process.env.VISUAL || process.env.EDITOR || 'vi'
    const editorArgs = editorEnv.trim().split(/\s+/).filter(Boolean)
    const editor = editorArgs[0] || 'vi'
    const editorPrefixArgs = editorArgs.slice(1)
    const out = process.stdout
    const stdin = process.stdin
    const ENTER_ALT = '\x1b[?1049h'
    const EXIT_ALT = '\x1b[?1049l'
    const SHOW_CURSOR = '\x1b[?25h'
    const HIDE_CURSOR = '\x1b[?25l'

    let editorOk = false
    try {
      stdin.setRawMode?.(false)
      out.write(`${SHOW_CURSOR}${EXIT_ALT}`)
      const result = spawnSync(editor, [...editorPrefixArgs, file], { stdio: 'inherit' })
      if (result.error) {
        dispatch({ type: 'setStatus', value: `Failed to launch ${editor}: ${result.error.message}`, kind: 'error' })
      } else if (result.signal) {
        dispatch({ type: 'setStatus', value: `${editor} interrupted by ${result.signal}`, kind: 'warning' })
      } else if (typeof result.status === 'number' && result.status !== 0) {
        dispatch({ type: 'setStatus', value: `${editor} exited with status ${result.status}`, kind: 'warning' })
      } else {
        editorOk = true
      }
    } finally {
      out.write(`${ENTER_ALT}${HIDE_CURSOR}`)
      stdin.setRawMode?.(true)
      resumeRef?.current?.()
    }

    if (editorOk) {
      try {
        const content = readFileSync(file, 'utf8')
        dispatch({ type: 'setChangelogText', text: content, generatedAt: Date.now() })
        dispatch({ type: 'setStatus', value: 'Changelog updated from editor.', kind: 'success' })
      } catch (error) {
        dispatch({
          type: 'setStatus',
          value: `Failed to read back edited changelog: ${(error as Error).message}`,
          kind: 'error',
        })
      }
    }

    try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  }, [dispatch, resumeRef, state.changelogView.text])

  // Open a file in $EDITOR (or $VISUAL) by suspending Ink's hold on the
  // terminal, spawning the editor synchronously inheriting stdio, then
  // restoring the alt screen + raw mode and forcing a re-render. The
  // dance mirrors the SIGTSTP / SIGCONT path in inkTerminalLifecycle.
  // Falls back to vi when neither env var is set; surfaces a status
  // message on missing-binary / non-zero exit so the user isn't left
  // wondering.
  const openInEditor = React.useCallback((path: string) => {
    if (!path) return
    const editorEnv = process.env.VISUAL || process.env.EDITOR || 'vi'
    // $VISUAL / $EDITOR commonly include flags (`code -w`, `vim -f`,
    // `emacs -nw`). Tokenize on whitespace so the leading word is the
    // executable and the rest are passed as arguments — passing the
    // full string to spawnSync as the executable would fail with
    // ENOENT for any of those configurations.
    const editorArgs = editorEnv.trim().split(/\s+/).filter(Boolean)
    const editor = editorArgs[0] || 'vi'
    const editorPrefixArgs = editorArgs.slice(1)
    const out = process.stdout
    const stdin = process.stdin
    const ENTER_ALT = '\x1b[?1049h'
    const EXIT_ALT = '\x1b[?1049l'
    const SHOW_CURSOR = '\x1b[?25h'
    const HIDE_CURSOR = '\x1b[?25l'
    try {
      // Drop into the primary buffer + cooked mode so the editor
      // doesn't inherit our raw-mode keystrokes.
      stdin.setRawMode?.(false)
      out.write(`${SHOW_CURSOR}${EXIT_ALT}`)
      const result = spawnSync(editor, [...editorPrefixArgs, path], { stdio: 'inherit' })
      if (result.error) {
        dispatch({ type: 'setStatus', value: `Failed to launch ${editor}: ${result.error.message}`, kind: 'error' })
      } else if (result.signal) {
        // Editor was killed by a signal (e.g. ^C, SIGTERM). status is
        // null in this case, so the old `status !== 0` check would
        // mistakenly fall through to the success branch.
        dispatch({ type: 'setStatus', value: `${editor} interrupted by ${result.signal}`, kind: 'warning' })
      } else if (typeof result.status === 'number' && result.status !== 0) {
        dispatch({ type: 'setStatus', value: `${editor} exited with status ${result.status}`, kind: 'warning' })
      } else {
        dispatch({ type: 'setStatus', value: `Edited ${path}`, kind: 'success' })
      }
    } finally {
      // Re-enter the alt screen + raw mode + hidden cursor; nudge React
      // so the freshly-restored screen actually paints.
      out.write(`${ENTER_ALT}${HIDE_CURSOR}`)
      stdin.setRawMode?.(true)
      resumeRef?.current?.()
    }
    // Worktree status may have changed (e.g. user saved an edit) — silent
    // refresh so the file row reflects the new staged/unstaged state.
    void refreshWorktreeContext({ silent: true })
  }, [dispatch, refreshWorktreeContext, resumeRef])

  // Open the global or project coco config in $EDITOR (gk / gK + their
  // command-palette entries). Scaffolds a templated starter when the file
  // doesn't exist yet so the user never lands in an empty buffer or hits
  // a "no such file" error.
  const openConfigInEditor = React.useCallback((scope: CocoConfigScope) => {
    // `repoRootRef` is populated async from `git rev-parse --show-toplevel`;
    // fall back to cwd so a freshly-launched session can still scaffold +
    // open the project config before that resolves.
    const repoRoot = repoRootRef.current || process.cwd()
    const filePath = resolveConfigPath(scope, repoRoot)
    try {
      const { created } = ensureConfigFile(filePath)
      if (created) {
        dispatch({ type: 'setStatus', value: `Created ${scope} config at ${filePath}`, kind: 'success' })
      }
    } catch (error) {
      dispatch({ type: 'setStatus', value: `Could not create config: ${(error as Error).message}`, kind: 'error' })
      return
    }
    openInEditor(filePath)
  }, [dispatch, openInEditor])

  // `E` keystroke handler — open the current commit draft in $EDITOR
  // (or $VISUAL), then read the file back and update the compose state
  // with the saved content. Mirrors the suspend → spawn → resume
  // terminal dance of `openInEditor` but operates on an in-memory
  // draft (round-tripped through a temp file) rather than a worktree
  // file. Useful when the inline compose editor isn't enough — long
  // bodies, markdown highlighting, paste from elsewhere, etc.
  //
  // Empty drafts are still written to the temp file so the user gets
  // a blank canvas; the read-back uses `setDraft` which splits content
  // into summary + body via `splitCommitDraft`, so the new content
  // re-populates both fields correctly regardless of which one was
  // active before.
  const openComposeInEditor = React.useCallback(() => {
    // Build the current draft text the same way `createManualCommit`
    // would — single string, blank line between summary and body.
    // Round-tripping through this format keeps the parse symmetric:
    // the editor sees what a real commit message would look like, and
    // `splitCommitDraft` on the way back reverses it cleanly.
    const composeState = state.commitCompose
    const draft = formatCommitComposeMessage(composeState.summary, composeState.body)

    // Temp dir + file. mkdtemp is cleaned up at the end regardless of
    // editor success/failure (`finally` block below). `.md` extension
    // helps editors pick up markdown highlighting — most commit-
    // message workflows treat the body as markdown-ish.
    let dir: string | undefined
    try {
      dir = mkdtempSync(nodePath.join(tmpdir(), 'coco-compose-'))
    } catch (error) {
      dispatch({
        type: 'setStatus',
        value: `Failed to create temp file for editor: ${(error as Error).message}`,
        kind: 'error',
      })
      return
    }
    const file = nodePath.join(dir, 'COMMIT_EDITMSG.md')
    try {
      writeFileSync(file, draft, 'utf8')
    } catch (error) {
      dispatch({
        type: 'setStatus',
        value: `Failed to seed temp file: ${(error as Error).message}`,
        kind: 'error',
      })
      try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
      return
    }

    const editorEnv = process.env.VISUAL || process.env.EDITOR || 'vi'
    const editorArgs = editorEnv.trim().split(/\s+/).filter(Boolean)
    const editor = editorArgs[0] || 'vi'
    const editorPrefixArgs = editorArgs.slice(1)
    const out = process.stdout
    const stdin = process.stdin
    const ENTER_ALT = '\x1b[?1049h'
    const EXIT_ALT = '\x1b[?1049l'
    const SHOW_CURSOR = '\x1b[?25h'
    const HIDE_CURSOR = '\x1b[?25l'

    let editorOk = false
    try {
      stdin.setRawMode?.(false)
      out.write(`${SHOW_CURSOR}${EXIT_ALT}`)
      const result = spawnSync(editor, [...editorPrefixArgs, file], { stdio: 'inherit' })
      if (result.error) {
        dispatch({ type: 'setStatus', value: `Failed to launch ${editor}: ${result.error.message}`, kind: 'error' })
      } else if (result.signal) {
        dispatch({ type: 'setStatus', value: `${editor} interrupted by ${result.signal}`, kind: 'warning' })
      } else if (typeof result.status === 'number' && result.status !== 0) {
        dispatch({ type: 'setStatus', value: `${editor} exited with status ${result.status}`, kind: 'warning' })
      } else {
        editorOk = true
      }
    } finally {
      out.write(`${ENTER_ALT}${HIDE_CURSOR}`)
      stdin.setRawMode?.(true)
      resumeRef?.current?.()
    }

    // Read the (possibly edited) file back and update compose state.
    // We only do this when the editor exited cleanly — a crash / kill
    // shouldn't blow away the user's draft. The setDraft action
    // re-splits into summary + body via splitCommitDraft.
    if (editorOk) {
      try {
        const content = readFileSync(file, 'utf8')
        dispatch({ type: 'commitCompose', action: { type: 'setDraft', value: content } })
        dispatch({ type: 'setStatus', value: 'Commit draft updated from editor.', kind: 'success' })
      } catch (error) {
        dispatch({
          type: 'setStatus',
          value: `Failed to read back edited draft: ${(error as Error).message}`,
          kind: 'error',
        })
      }
    }

    // Always clean up the temp dir — even on failure paths above. We
    // don't want abandoned coco-compose-* directories accumulating in
    // /tmp across sessions. Best-effort; ignore errors (e.g. file
    // already removed by the user from inside their editor).
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  }, [dispatch, resumeRef, state.commitCompose])

  // `S` keystroke — start the `coco commit --split` flow (#907).
  // Pre-flight refuses cleanly when:
  //   - Nothing is staged (suggests `g s` to pick files)
  //   - A bisect / merge / rebase is in progress (split would be confusing)
  // Then opens the overlay in 'loading' state, kicks off the plan
  // workflow, and dispatches setSplitPlanReady (or setSplitPlanError)
  // when it resolves. The overlay handles the rest from there.
  const startCommitSplit = React.useCallback(async () => {
    const stagedCount = context.worktree?.stagedCount || 0
    if (stagedCount === 0) {
      dispatch({
        type: 'setStatus',
        value: 'Nothing staged to split. Stage some files first (`g s` to pick).',
        kind: 'error',
      })
      return
    }
    const operation = context.operation
    if (operation?.operation && operation.operation !== 'none') {
      dispatch({
        type: 'setStatus',
        value: `A ${operation.operation} is in progress — finish or abort it before splitting.`,
        kind: 'error',
      })
      return
    }

    dispatch({ type: 'startSplitPlanLoad' })
    dispatch({ type: 'setStatus', value: 'Generating split plan (this can take a minute)…', loading: true })

    const result = await runCommitSplitPlanWorkflow({ git })

    if (!result.ok) {
      dispatch({ type: 'setSplitPlanError', error: result.message })
      dispatch({
        type: 'setStatus',
        value: `Split plan failed: ${result.message}`,
        kind: 'error',
      })
      return
    }

    dispatch({
      type: 'setSplitPlanReady',
      plan: result.plan,
      planContext: result.planContext,
      fallback: result.fallback,
    })
    const readyMessage = result.fallback
      ? `Split planner exhausted retries — showing single-commit fallback. y/Enter to apply as one commit, r to re-roll, Esc to cancel.`
      : `Split plan ready: ${result.plan.groups.length} commit(s). y/Enter to apply, Esc to cancel.`
    // Use 'info' kind for the fallback path (still actionable, just
    // not a clean win). The reducer's "warning" is the absence of
    // `success` framing — the message text itself carries the cue.
    dispatch({
      type: 'setStatus',
      value: readyMessage,
      kind: result.fallback ? 'info' : 'success',
    })
  }, [context.operation, context.worktree?.stagedCount, dispatch, git])

  // `y`/Enter inside the overlay — apply the previewed plan. Uses the
  // plan + planContext from state (set by setSplitPlanReady) so the
  // executed split matches what the user reviewed exactly. No LLM
  // re-roll, no plan drift.
  const applyCommitSplit = React.useCallback(async () => {
    const splitPlan = state.splitPlan
    if (!splitPlan?.plan || !splitPlan.planContext) {
      dispatch({ type: 'setStatus', value: 'No split plan loaded yet — wait for generation.', kind: 'warning' })
      return
    }

    // Diagnostic dump for the silent-failure bug surfaced in #944
    // manual testing. Writes a per-step record to a file in /tmp so
    // we have ground truth when the workstation's view of the world
    // disagrees with the underlying git state. Path is printed in
    // the post-apply status so the user can paste it back in an
    // issue / PR comment.
    const dumpPath = nodePath.join(
      tmpdir(),
      `coco-split-apply-${Date.now()}.log`
    )
    const dump: string[] = [
      `[${new Date().toISOString()}] split apply diagnostic dump`,
      `plan: ${splitPlan.plan.groups.length} group(s)`,
      ...splitPlan.plan.groups.map((g, i) =>
        `  group ${i + 1}: ${g.title} — files=[${(g.files || []).join(', ')}] hunks=[${(g.hunks || []).join(', ')}]`
      ),
    ]
    try {
      const headBefore = (await git.revparse(['HEAD'])).trim()
      dump.push(`HEAD before apply: ${headBefore}`)
      const statusBefore = await git.status()
      dump.push(`staged before apply: ${[...statusBefore.staged, ...statusBefore.created, ...statusBefore.renamed].length}`)
      dump.push(`unstaged before apply: ${statusBefore.modified.length + statusBefore.deleted.length}`)
      dump.push(`untracked before apply: ${statusBefore.not_added.length}`)
    } catch (error) {
      dump.push(`pre-apply git probe failed: ${(error as Error).message}`)
    }

    dispatch({ type: 'setSplitPlanApplying' })
    dispatch({ type: 'setStatus', value: 'Applying split plan…', loading: true })

    const result = await runCommitSplitApplyWorkflow({
      plan: splitPlan.plan,
      planContext: splitPlan.planContext,
      git,
      fallback: splitPlan.fallback,
    })

    dump.push(`workflow returned: ok=${result.ok} message="${result.message}" commitHashes=[${(result.commitHashes || []).join(', ')}]`)

    try {
      const headAfter = (await git.revparse(['HEAD'])).trim()
      dump.push(`HEAD after apply: ${headAfter}`)
      const statusAfter = await git.status()
      dump.push(`staged after apply: ${[...statusAfter.staged, ...statusAfter.created, ...statusAfter.renamed].length}`)
      dump.push(`unstaged after apply: ${statusAfter.modified.length + statusAfter.deleted.length}`)
      dump.push(`untracked after apply: ${statusAfter.not_added.length}`)
      const recentLog = await git.raw(['log', '--oneline', '-n', '10'])
      dump.push(`git log -n 10:`)
      dump.push(...recentLog.split('\n').map((line) => `  ${line}`))
    } catch (error) {
      dump.push(`post-apply git probe failed: ${(error as Error).message}`)
    }

    try {
      writeFileSync(dumpPath, dump.join('\n'), 'utf8')
    } catch { /* ignore — diagnostic is best-effort */ }

    if (!result.ok) {
      // Keep the overlay open so the user can see what happened and
      // try again. setSplitPlanError preserves the existing plan in
      // 'ready' state with the error annotation.
      dispatch({ type: 'setSplitPlanError', error: result.message })
      dispatch({
        type: 'setStatus',
        value: `Split apply failed: ${result.message} · diagnostic log: ${dumpPath}`,
        kind: 'error',
      })
      return
    }

    // Success — close the overlay, reset compose (the staged set is
    // now empty since the plan committed everything), and route the
    // user to the history view so they see the just-landed commits
    // with the recent-commit marker firing on each row that was
    // created. Previous behavior popped compose to whatever was
    // beneath (often status — which now reads "clean worktree" and
    // gives the user no signal that anything just happened);
    // history is the natural follow-on surface.
    //
    // navigateHome nukes the rest of the stack so `<` after apply
    // doesn't walk back into the now-empty compose / status state
    // the user just left behind.
    dispatch({ type: 'clearSplitPlan' })
    dispatch({ type: 'commitCompose', action: { type: 'reset' } })
    dispatch({ type: 'navigateHome' })

    // Refresh BEFORE setting the final status so we can peek at the
    // post-apply worktree state and craft a directive next-step hint
    // ("X unstaged + Y untracked remaining — press gs to stage / I
    // to draft / …"). An empty success message reads as a dead end;
    // a next-step hint keeps momentum.
    //
    // Critical: refreshHistoryRows is the one that re-fetches the
    // commit log. Without this, `gh` would show the pre-apply log —
    // exactly the "spinner runs, no commits visible" silent-failure
    // report from #942 manual testing. The actual commits DO land;
    // `state.rows` just never gets re-fetched after boot.
    await refreshHistoryRows()
    await refreshWorktreeContext()
    await refreshContext()

    // Best-effort peek at the fresh worktree counts. If the second
    // load fails we just fall back to the bare success message — no
    // reason to noisily surface a status-line lookup error after a
    // genuine success.
    const fresh = await getWorktreeOverview(git).catch(() => undefined)
    const unstaged = fresh?.unstagedCount || 0
    const untracked = fresh?.untrackedCount || 0

    // The workflow now returns the actually-created commit hashes
    // directly (verified against HEAD inside applyCommitSplitPlan —
    // each commit confirmed to have advanced the tip). Drive the
    // just-landed marker AND the success-message commit count from
    // that exact data instead of doing a second rev-list round-trip
    // that could disagree with reality on partial-apply.
    const commitHashes = result.commitHashes || []
    if (commitHashes.length > 0) {
      // Audit finding #9: timestamp captured at dispatch time.
      dispatch({ type: 'markRecentCommits', hashes: commitHashes, markedAt: Date.now() })
      // DevSkim: ignore DS172411 — function literal, fixed delay,
      // no caller-supplied data flowing through.
      setTimeout(() => dispatch({ type: 'clearRecentCommits' }), 5000)
    }

    // If the workflow reported success but zero commits actually
    // landed, surface that as an error — the spinner-then-silence
    // failure mode from #940 manual testing where the apply appeared
    // to succeed but the worktree got wiped with no commits made.
    if (commitHashes.length === 0) {
      const detail = result.message || 'No commits were created.'
      dispatch({
        type: 'setStatus',
        value: `Split apply produced zero commits: ${detail} · diagnostic log: ${dumpPath}`,
        kind: 'error',
      })
      return
    }

    const successMessage = formatSplitApplySuccess(
      commitHashes.length,
      unstaged,
      untracked,
      result.fallback ? { reason: result.fallback.reason } : undefined
    )
    // Fallback path uses 'info' kind — apply technically succeeded
    // but the user should know it landed as a single combined commit
    // rather than a real LLM-driven multi-group split.
    dispatch({
      type: 'setStatus',
      value: successMessage,
      kind: result.fallback ? 'info' : 'success',
    })
  }, [dispatch, git, refreshContext, refreshHistoryRows, refreshWorktreeContext, state.splitPlan])

  // Esc inside the overlay — close without applying. Status line gets
  // a confirmation so the user knows the operation was abandoned.
  const cancelCommitSplit = React.useCallback(() => {
    dispatch({ type: 'clearSplitPlan' })
    dispatch({ type: 'setStatus', value: 'Split plan cancelled.' })
  }, [dispatch])

  // Resolve the destructive-action target from the live filtered+sorted
  // list the user is looking at, run the action against it, surface the
  // result on the status line, and silently refresh so the deleted item
  // disappears. Called from the y-confirm path for delete-branch / delete-
  // tag / drop-stash / remove-worktree / abort-operation.
  const runWorkflowAction = React.useCallback(async (id: string, payload?: string) => {
    // Hunk-apply payload format: `<target>\n<patchText>` — the input
    // handler synthesizes both pieces (target from the keystroke,
    // patch text from extractDiffHunk against the live diff lines)
    // and packs them into the single `payload` field. Splitting on
    // the first newline keeps the patch body intact.
    const runApplyHunk = (
      expectedTarget: ApplyHunkTarget,
      raw: string | undefined
    ): Promise<{ ok: boolean; message: string; details?: string[] }> => {
      if (!raw) {
        return Promise.resolve({ ok: false, message: 'No hunk under cursor to apply.' })
      }
      const newlineIndex = raw.indexOf('\n')
      if (newlineIndex < 0) {
        return Promise.resolve({ ok: false, message: 'Malformed hunk-apply payload.' })
      }
      const target = raw.slice(0, newlineIndex) === 'index' ? 'index' : 'worktree'
      const patchText = raw.slice(newlineIndex + 1)
      // The input handler is the source of truth for target — but if a
      // palette-injected payload mismatches the workflow id, prefer
      // the workflow id so the user sees the action they asked for.
      const effectiveTarget = expectedTarget || target
      return applyHunkPatch(git, patchText, { target: effectiveTarget })
    }

    // #882 phase 4 — post-mutation cache invalidation for the
    // issue / PR triage views. Each helper does two things:
    //   1. Clears the in-memory `context.issueList` /
    //      `context.pullRequestList` entry so the view's `useEffect`
    //      retriggers on the next render and the user sees their
    //      change reflected immediately.
    //   2. Wipes the disk cache so a follow-up `coco issues` /
    //      `coco prs` CLI call doesn't serve stale data from the
    //      5-minute TTL window. Sledgehammer rather than scalpel —
    //      clearing per (repo, filter) tuple would require more
    //      bookkeeping than the cache is worth.
    const invalidateIssueListCaches = (issueNumber?: number): void => {
      setContext((current) => {
        const next = { ...current, issueList: undefined }
        // Drop only the mutated issue's detail entry so other
        // hydrated entries survive — they're still accurate. When
        // no number is given (rare), wipe the whole detail map.
        if (current.issueDetailByNumber) {
          if (typeof issueNumber === 'number') {
            const trimmed = new Map(current.issueDetailByNumber)
            trimmed.delete(issueNumber)
            next.issueDetailByNumber = trimmed
          } else {
            next.issueDetailByNumber = undefined
          }
        }
        return next
      })
      setContextStatus((current) => updateLogInkContextStatus(current, 'issueList', 'idle'))
      clearGitHubListCache()
    }
    const invalidatePullRequestListCaches = (pullRequestNumber?: number): void => {
      setContext((current) => {
        const next = { ...current, pullRequestList: undefined }
        if (current.pullRequestDetailByNumber) {
          if (typeof pullRequestNumber === 'number') {
            const trimmed = new Map(current.pullRequestDetailByNumber)
            trimmed.delete(pullRequestNumber)
            next.pullRequestDetailByNumber = trimmed
          } else {
            next.pullRequestDetailByNumber = undefined
          }
        }
        return next
      })
      setContextStatus((current) => updateLogInkContextStatus(current, 'pullRequestList', 'idle'))
      clearGitHubListCache()
    }

    const handlers: Record<string, () => Promise<{ ok: boolean; message: string } | undefined>> = {
      'create-branch': async () => {
        const name = payload?.trim()
        if (!name) return { ok: false, message: 'Branch name required' }
        const startPoint = context.branches?.currentBranch || 'HEAD'
        return createBranch(git, name, startPoint)
      },
      'create-tag': async () => {
        const name = payload?.trim()
        if (!name) return { ok: false, message: 'Tag name required' }
        return createLightweightTag(git, name, 'HEAD')
      },
      'checkout-branch': async () => {
        const all = sortBranches(context.branches?.localBranches || [], state.branchSort)
        const visible = state.filter
          ? all.filter((b) => matchesPromotedFilter([b.shortName, b.upstream || ''], state.filter))
          : all
        const branch = visible[Math.min(state.selectedBranchIndex, visible.length - 1)]
        if (!branch) return { ok: false, message: 'No branch selected' }
        if (branch.current) return { ok: true, message: `Already on ${branch.shortName}` }
        return checkoutBranch(git, branch)
      },
      'delete-branch': async () => {
        const all = sortBranches(context.branches?.localBranches || [], state.branchSort)
        const visible = state.filter
          ? all.filter((b) => matchesPromotedFilter([b.shortName, b.upstream || ''], state.filter))
          : all
        const branch = visible[Math.min(state.selectedBranchIndex, visible.length - 1)]
        if (!branch) return { ok: false, message: 'No branch selected' }
        return deleteBranch(git, branch)
      },
      'force-delete-branch': async () => {
        const all = sortBranches(context.branches?.localBranches || [], state.branchSort)
        const visible = state.filter
          ? all.filter((b) => matchesPromotedFilter([b.shortName, b.upstream || ''], state.filter))
          : all
        const branch = visible[Math.min(state.selectedBranchIndex, visible.length - 1)]
        if (!branch) return { ok: false, message: 'No branch selected' }
        return deleteBranch(git, branch, true)
      },
      'delete-tag': async () => {
        const all = sortTags(context.tags?.tags || [], state.tagSort)
        const visible = state.filter
          ? all.filter((t) => matchesPromotedFilter([t.name, t.subject], state.filter))
          : all
        const tag = visible[Math.min(state.selectedTagIndex, visible.length - 1)]
        if (!tag) return { ok: false, message: 'No tag selected' }
        return deleteLocalTag(git, tag.name)
      },
      'push-tag': async () => {
        const all = sortTags(context.tags?.tags || [], state.tagSort)
        const visible = state.filter
          ? all.filter((t) => matchesPromotedFilter([t.name, t.subject], state.filter))
          : all
        const tag = visible[Math.min(state.selectedTagIndex, visible.length - 1)]
        if (!tag) return { ok: false, message: 'No tag selected' }
        return pushTag(git, tag.name)
      },
      'drop-stash': async () => {
        const all = context.stashes?.stashes || []
        const visible = state.filter
          ? all.filter((s) => matchesPromotedFilter([s.ref, s.message], state.filter))
          : all
        const stash = visible[Math.min(state.selectedStashIndex, visible.length - 1)]
        if (!stash) return { ok: false, message: 'No stash selected' }
        // Remember the dropped commit so `u` can undo it.
        if (stash.hash) lastDroppedStashRef.current = { hash: stash.hash, message: stash.message }
        return dropStash(git, stash)
      },
      'undo-drop-stash': async () => {
        const dropped = lastDroppedStashRef.current
        if (!dropped) return { ok: false, message: 'Nothing to undo — no stash dropped this session' }
        const result = await restoreStash(git, dropped.hash, dropped.message)
        if (result.ok) lastDroppedStashRef.current = null
        return result
      },
      'apply-stash': async () => {
        const all = context.stashes?.stashes || []
        const visible = state.filter
          ? all.filter((s) => matchesPromotedFilter([s.ref, s.message], state.filter))
          : all
        const stash = visible[Math.min(state.selectedStashIndex, visible.length - 1)]
        if (!stash) return { ok: false, message: 'No stash selected' }
        return applyStash(git, stash)
      },
      'apply-stash-index': async () => {
        const all = context.stashes?.stashes || []
        const visible = state.filter
          ? all.filter((s) => matchesPromotedFilter([s.ref, s.message], state.filter))
          : all
        const stash = visible[Math.min(state.selectedStashIndex, visible.length - 1)]
        if (!stash) return { ok: false, message: 'No stash selected' }
        return applyStashKeepIndex(git, stash)
      },
      'pop-stash': async () => {
        const all = context.stashes?.stashes || []
        const visible = state.filter
          ? all.filter((s) => matchesPromotedFilter([s.ref, s.message], state.filter))
          : all
        const stash = visible[Math.min(state.selectedStashIndex, visible.length - 1)]
        if (!stash) return { ok: false, message: 'No stash selected' }
        return popStash(git, stash)
      },
      'rename-stash': async () => {
        const all = context.stashes?.stashes || []
        const visible = state.filter
          ? all.filter((s) => matchesPromotedFilter([s.ref, s.message], state.filter))
          : all
        const stash = visible[Math.min(state.selectedStashIndex, visible.length - 1)]
        if (!stash) return { ok: false, message: 'No stash selected' }
        return renameStash(git, stash, payload ?? '')
      },
      'stash-branch': async () => {
        const all = context.stashes?.stashes || []
        const visible = state.filter
          ? all.filter((s) => matchesPromotedFilter([s.ref, s.message], state.filter))
          : all
        const stash = visible[Math.min(state.selectedStashIndex, visible.length - 1)]
        if (!stash) return { ok: false, message: 'No stash selected' }
        return stashBranch(git, stash, payload ?? '')
      },
      'bisect-good': async () => {
        if (!context.bisect?.active) return { ok: false, message: 'No bisect in progress' }
        try {
          const stdout = await bisectGood(git)
          return { ok: true, message: extractBisectRemainingHint(stdout) || 'Marked good' }
        } catch (error) {
          return { ok: false, message: `Bisect good failed: ${(error as Error).message}` }
        }
      },
      'bisect-bad': async () => {
        if (!context.bisect?.active) return { ok: false, message: 'No bisect in progress' }
        try {
          const stdout = await bisectBad(git)
          return { ok: true, message: extractBisectRemainingHint(stdout) || 'Marked bad' }
        } catch (error) {
          return { ok: false, message: `Bisect bad failed: ${(error as Error).message}` }
        }
      },
      'bisect-skip': async () => {
        if (!context.bisect?.active) return { ok: false, message: 'No bisect in progress' }
        try {
          const stdout = await bisectSkip(git)
          return { ok: true, message: extractBisectRemainingHint(stdout) || 'Skipped' }
        } catch (error) {
          return { ok: false, message: `Bisect skip failed: ${(error as Error).message}` }
        }
      },
      'bisect-reset': async () => {
        if (!context.bisect?.active) return { ok: false, message: 'No bisect in progress' }
        try {
          await bisectReset(git)
          return { ok: true, message: 'Bisect reset' }
        } catch (error) {
          return { ok: false, message: `Bisect reset failed: ${(error as Error).message}` }
        }
      },
      'bisect-run': async () => {
        // #879 item 5 — drive an automated bisect via `git bisect run
        // sh -c '<command>'`. Synchronous from our perspective: git
        // runs the loop, blocks until termination, then we surface
        // the last meaningful line of stdout (typically "<sha> is
        // the first bad commit") via the status line. Live streaming
        // + cancel mid-run is a follow-up.
        if (!context.bisect?.active) return { ok: false, message: 'No bisect in progress' }
        const command = payload?.trim()
        if (!command) return { ok: false, message: 'Bisect run needs a command' }
        try {
          const stdout = await bisectRun(git, command)
          // Bisect run can advance HEAD across many commits when
          // testing — refresh both the metadata context AND the
          // history rows so the user sees what `git log` actually
          // shows now.
          await refreshHistoryRows()
          await refreshContext({ silent: true })
          return {
            ok: true,
            message: extractBisectRemainingHint(stdout) || `Bisect run finished (${command})`,
          }
        } catch (error) {
          return { ok: false, message: `Bisect run failed: ${(error as Error).message}` }
        }
      },
      'bisect-start-from-history': async () => {
        // #879 item 4 — in-TUI wizard payload: `<bad>\n<good>`. The
        // input handler captures both shas off cursor selections and
        // routes through this workflow so the validation +
        // side-effects live in the runtime rather than the input
        // dispatcher. On success we clear the wizard mode and push
        // the bisect view so the user lands on the new candidate
        // (the candidate-detail loader from item 2 takes over from
        // there).
        const parts = payload?.split('\n') ?? []
        const badRef = parts[0]?.trim()
        const goodRef = parts[1]?.trim()
        if (!badRef || !goodRef) {
          return { ok: false, message: 'Bisect start needs a BAD and a GOOD commit' }
        }
        if (badRef === goodRef) {
          return { ok: false, message: 'Bad and good must be different commits' }
        }
        if (context.bisect?.active) {
          return { ok: false, message: 'A bisect is already in progress — reset it first' }
        }
        if (worktreeDirty) {
          return { ok: false, message: 'Worktree has changes — stash them before starting a bisect' }
        }
        try {
          const stdout = await bisectStart(git, badRef, goodRef)
          dispatch({ type: 'clearBisectPickMode' })
          dispatch({ type: 'pushView', value: 'bisect' })
          // Bisect start checks out the midpoint commit — HEAD moves,
          // history view needs the fresh row set.
          await refreshHistoryRows()
          await refreshContext({ silent: true })
          return {
            ok: true,
            message: extractBisectRemainingHint(stdout) || `Bisect started: bad ${badRef.slice(0, 8)} / good ${goodRef.slice(0, 8)}`,
          }
        } catch (error) {
          return { ok: false, message: `Bisect start failed: ${(error as Error).message}` }
        }
      },
      'checkout-file-from-stash': async () => {
        const path = payload?.trim()
        const ref = state.stashDiffRef
        if (!path) return { ok: false, message: 'No stash file under cursor' }
        if (!ref) return { ok: false, message: 'No stash ref active' }
        return checkoutFileFromStash(git, ref, path)
      },
      'cherry-pick-commit': async () => {
        const commit = getSelectedInkCommit(state)
        if (!commit) return { ok: false, message: 'No commit selected' }
        return cherryPickCommit(git, {
          hash: commit.hash,
          shortHash: commit.shortHash,
          message: commit.message,
        })
      },
      'revert-commit': async () => {
        const commit = getSelectedInkCommit(state)
        if (!commit) return { ok: false, message: 'No commit selected' }
        return revertCommit(git, {
          hash: commit.hash,
          shortHash: commit.shortHash,
          message: commit.message,
        })
      },
      'reset-to-commit': async () => {
        const commit = getSelectedInkCommit(state)
        if (!commit) return { ok: false, message: 'No commit selected' }
        // Mode arrives via the action's `payload` field — the input
        // handler runs the reset-mode prompt (kind: 'reset-mode') and
        // routes the typed value here. Default to `mixed` (git's own
        // default) when the user submitted an empty value.
        const raw = payload?.trim().toLowerCase() || 'mixed'
        if (!isResetMode(raw)) {
          return { ok: false, message: `Unknown reset mode: ${raw}. Use soft, mixed, or hard.` }
        }
        return resetToCommit(git, {
          hash: commit.hash,
          shortHash: commit.shortHash,
          message: commit.message,
        }, raw as ResetMode)
      },
      'interactive-rebase': async () => {
        const commit = getSelectedInkCommit(state)
        if (!commit) return { ok: false, message: 'No commit selected' }
        return startInteractiveRebase(git, {
          hash: commit.hash,
          shortHash: commit.shortHash,
          message: commit.message,
        })
      },
      'create-branch-here': async () => {
        const commit = getSelectedInkCommit(state)
        const name = payload?.trim()
        if (!commit) return { ok: false, message: 'No commit selected' }
        if (!name) return { ok: false, message: 'Branch name required' }
        return createBranchFromCommit(git, name, {
          hash: commit.hash,
          shortHash: commit.shortHash,
        })
      },
      'create-tag-here': async () => {
        const commit = getSelectedInkCommit(state)
        const name = payload?.trim()
        if (!commit) return { ok: false, message: 'No commit selected' }
        if (!name) return { ok: false, message: 'Tag name required' }
        return createTagAtCommit(git, name, {
          hash: commit.hash,
          shortHash: commit.shortHash,
        })
      },
      'checkout-file-from-commit': async () => {
        // payload is "<sha> <path>" so we pass both through a single
        // string field on the action.
        const trimmed = payload?.trim()
        if (!trimmed) return { ok: false, message: 'No commit file under cursor' }
        const spaceIndex = trimmed.indexOf(' ')
        if (spaceIndex < 0) return { ok: false, message: 'Malformed commit file payload' }
        const sha = trimmed.slice(0, spaceIndex)
        const path = trimmed.slice(spaceIndex + 1)
        if (!sha || !path) return { ok: false, message: 'No commit file under cursor' }
        return checkoutFileFromCommit(git, sha, path)
      },
      'apply-hunk-worktree': async () => runApplyHunk('worktree', payload),
      'apply-hunk-index': async () => runApplyHunk('index', payload),
      'remove-worktree': async () => {
        const all = context.worktreeList?.worktrees || []
        // Resolve the target from the visible (filtered) list so a
        // hidden filtered-out worktree can never be the action target.
        // Falls back to the cursor against the unfiltered list when the
        // action is invoked from the palette without ever visiting the
        // worktrees view.
        const visible = state.filter
          ? all.filter((w) => matchesPromotedFilter([w.path, w.branch || ''], state.filter))
          : all
        const cursorTarget = visible.length
          ? visible[Math.min(state.selectedWorktreeListIndex, visible.length - 1)]
          : all[Math.min(state.selectedWorktreeListIndex, Math.max(0, all.length - 1))]
        if (!cursorTarget) return { ok: false, message: 'No worktree selected' }
        if (cursorTarget.current) {
          return {
            ok: false,
            message: 'Cannot remove the current worktree — switch to another worktree first.',
          }
        }
        return removeWorktree(git, cursorTarget)
      },
      'remove-worktree-and-branch': async () => {
        const all = context.worktreeList?.worktrees || []
        const visible = state.filter
          ? all.filter((w) => matchesPromotedFilter([w.path, w.branch || ''], state.filter))
          : all
        const cursorTarget = visible.length
          ? visible[Math.min(state.selectedWorktreeListIndex, visible.length - 1)]
          : all[Math.min(state.selectedWorktreeListIndex, Math.max(0, all.length - 1))]
        if (!cursorTarget) return { ok: false, message: 'No worktree selected' }
        if (cursorTarget.current) {
          return {
            ok: false,
            message: 'Cannot remove the current worktree — switch to another worktree first.',
          }
        }
        // The chained helper handles the worktree removal AND the
        // safe branch delete in one call. Branch refs come from the
        // live context so the underlying deleteBranch helper sees
        // the current/local flags it needs to refuse the destructive
        // path on the wrong target.
        return removeWorktreeAndBranch(
          git,
          cursorTarget,
          context.branches?.localBranches || []
        )
      },
      'abort-operation': async () => {
        const operation = context.operation?.operation
        if (!operation) {
          return { ok: false, message: 'No git operation in progress' }
        }
        return abortOperation(git, operation)
      },
      'resolve-conflict-ours': async () => {
        const path = payload?.trim()
        if (!path) return { ok: false, message: 'No conflict file selected' }
        return resolveConflictOurs(git, path)
      },
      'resolve-conflict-theirs': async () => {
        const path = payload?.trim()
        if (!path) return { ok: false, message: 'No conflict file selected' }
        return resolveConflictTheirs(git, path)
      },
      'resolve-conflict-stage': async () => {
        const path = payload?.trim()
        if (!path) return { ok: false, message: 'No conflict file selected' }
        return stageConflictResolved(git, path)
      },
      'resolve-conflict-open-diff': async () => {
        // Push the diff view for the conflicted file so the user can
        // inspect conflict markers in context. We find the file's index
        // in the worktree file list and navigate to its diff.
        const path = payload?.trim()
        if (!path) return { ok: false, message: 'No conflict file selected' }
        const worktreeFiles = context.worktree?.files || []
        const fileIndex = worktreeFiles.findIndex((f) => f.path === path)
        if (fileIndex >= 0) {
          dispatch({ type: 'navigateOpenDiffForWorktreeFile', fileIndex })
          return { ok: true, message: `Viewing diff for ${path}` }
        }
        // File not in worktree list (e.g. deleted-by-us) — open in
        // editor as fallback so the user can still inspect it.
        return { ok: true, message: `${path} not in worktree diff list` }
      },
      'continue-operation': async () => {
        const operation = context.operation?.operation
        if (!operation || operation === 'none') {
          return { ok: false, message: 'No git operation in progress' }
        }
        if ((context.operation?.conflictedFiles.length ?? 0) > 0) {
          return { ok: false, message: 'Resolve all conflicts before continuing' }
        }
        return continueOperation(git, operation)
      },
      'open-pr': async () => {
        const repo = context.provider?.repository
        if (!repo || repo.provider !== 'github' || !repo.owner || !repo.name) {
          return { ok: false, message: 'No GitHub remote detected for this repo' }
        }
        // History view: prefer the cursored commit's URL so `O` from
        // a commit context lands the user on the commit page rather
        // than the repo root or the current PR. The user-visible
        // intent of `O` is "open whatever I'm cursoring on the web";
        // a commit is what the cursor is on in the history view.
        if (state.activeView === 'history') {
          const commit = getSelectedInkCommit(state)
          if (commit) {
            return openProviderUrl(repo, { type: 'commit', commit: commit.hash })
          }
        }
        const pr = context.provider?.currentPullRequest || context.pullRequest?.currentPullRequest
        if (pr) {
          return openProviderUrl(repo, { type: 'pull-request', number: pr.number })
        }
        // No PR — fall back to opening the repo page so the user can
        // create one or browse from there.
        return openProviderUrl(repo, { type: 'repo' })
      },
      'fetch-remotes': async () => fetchRemotes(git),
      'pull-current-branch': async () => pullCurrentBranch(git),
      'push-current-branch': async () => pushCurrentBranch(git),
      // Per-branch fetch / pull / push that operate on the cursored
      // row in the branches sidebar. inkInput.ts dispatches these
      // when F / U / P fire from the sidebar; the *-current-branch
      // / fetch-remotes variants above still handle the same keys
      // from any other context.
      'fetch-selected-branch': async () => {
        const all = sortBranches(context.branches?.localBranches || [], state.branchSort)
        const visible = state.filter
          ? all.filter((b) => matchesPromotedFilter([b.shortName, b.upstream || ''], state.filter))
          : all
        const branch = visible[Math.min(state.selectedBranchIndex, visible.length - 1)]
        if (!branch) return { ok: false, message: 'No branch selected' }
        return fetchBranch(git, branch)
      },
      'pull-selected-branch': async () => {
        const all = sortBranches(context.branches?.localBranches || [], state.branchSort)
        const visible = state.filter
          ? all.filter((b) => matchesPromotedFilter([b.shortName, b.upstream || ''], state.filter))
          : all
        const branch = visible[Math.min(state.selectedBranchIndex, visible.length - 1)]
        if (!branch) return { ok: false, message: 'No branch selected' }
        return pullBranch(git, branch, context.branches?.currentBranch)
      },
      'push-selected-branch': async () => {
        const all = sortBranches(context.branches?.localBranches || [], state.branchSort)
        const visible = state.filter
          ? all.filter((b) => matchesPromotedFilter([b.shortName, b.upstream || ''], state.filter))
          : all
        const branch = visible[Math.min(state.selectedBranchIndex, visible.length - 1)]
        if (!branch) return { ok: false, message: 'No branch selected' }
        return pushBranch(git, branch)
      },
      'add-to-gitignore': async () => addToGitignore(git, payload || ''),
      'rename-branch': async () => {
        const newName = payload?.trim()
        if (!newName) return { ok: false, message: 'New branch name required' }
        const all = sortBranches(context.branches?.localBranches || [], state.branchSort)
        const visible = state.filter
          ? all.filter((b) => matchesPromotedFilter([b.shortName, b.upstream || ''], state.filter))
          : all
        const branch = visible[Math.min(state.selectedBranchIndex, visible.length - 1)]
        if (!branch) return { ok: false, message: 'No branch selected' }
        return renameBranch(git, branch.shortName, newName)
      },
      'set-upstream': async () => {
        const upstream = payload?.trim()
        if (!upstream) return { ok: false, message: 'Upstream ref required' }
        const all = sortBranches(context.branches?.localBranches || [], state.branchSort)
        const visible = state.filter
          ? all.filter((b) => matchesPromotedFilter([b.shortName, b.upstream || ''], state.filter))
          : all
        const branch = visible[Math.min(state.selectedBranchIndex, visible.length - 1)]
        if (!branch) return { ok: false, message: 'No branch selected' }
        return setUpstream(git, branch.shortName, upstream)
      },
      'delete-remote-tag': async () => {
        const all = sortTags(context.tags?.tags || [], state.tagSort)
        const visible = state.filter
          ? all.filter((t) => matchesPromotedFilter([t.name, t.subject], state.filter))
          : all
        const tag = visible[Math.min(state.selectedTagIndex, visible.length - 1)]
        if (!tag) return { ok: false, message: 'No tag selected' }
        return deleteRemoteTag(git, tag.name)
      },
      'create-stash': async () => {
        // Empty is allowed — createStash turns it into a quick WIP stash
        // (git's own `WIP on <branch>` subject). Naming is optional.
        return createStash(git, payload ?? '')
      },
      'stash-staged': async () => createStash(git, payload ?? '', { stagedOnly: true }),
      'stash-keep-index': async () => createStash(git, payload ?? '', { keepIndex: true }),
      // #783 — full PR action panel handlers. Each wraps the matching
      // pullRequestActions verb. Strategy / body arrives via `payload`
      // — input prompts validate before they reach here, but the
      // strategy guard stays as a defensive belt-and-suspenders since
      // a future palette path could call us with a raw value.
      'create-pr': async () => {
        // The input-prompt submit handler validates non-empty title
        // already; this is the defensive belt-and-suspenders for
        // future palette callers passing in a raw payload.
        const text = (payload || '').trim()
        if (!text) {
          return { ok: false, message: 'Pull request title is required (first line of the prompt).' }
        }
        const lines = text.split('\n')
        const title = lines[0].trim()
        if (!title) {
          return { ok: false, message: 'Pull request title cannot be blank.' }
        }
        // Body: lines 2+, with the leading blank line tolerated. Empty
        // body is allowed — GitHub renders an empty PR body fine.
        const body = lines.slice(1).join('\n').replace(/^\n+/, '').trimEnd()
        const head = context.branches?.currentBranch || context.provider?.currentBranch
        const base = context.provider?.repository.defaultBranch
        if (!head) {
          return { ok: false, message: 'No current branch detected.' }
        }
        if (!base) {
          return { ok: false, message: 'No default branch detected. Configure the GitHub remote.' }
        }
        return createPullRequest({ base, head, title, body })
      },
      'merge-pr': async () => {
        const strategy = (payload || 'merge').toLowerCase()
        if (!isPullRequestMergeStrategy(strategy)) {
          return { ok: false, message: `Unknown merge strategy: ${strategy}. Use merge, squash, or rebase.` }
        }
        return mergePullRequest(strategy)
      },
      'close-pr': async () => closePullRequest(),
      'approve-pr': async () => approvePullRequest(),
      'request-changes-pr': async () => {
        const body = payload?.trim()
        if (!body) return { ok: false, message: 'Review body required for change-request' }
        return requestChangesPullRequest(body)
      },
      'comment-pr': async () => {
        const body = payload?.trim()
        if (!body) return { ok: false, message: 'Comment body required' }
        return commentPullRequest(body)
      },
      // #882 phase 4 — triage-view low-risk mutations. Each picks
      // the cursored item from the *filtered* list (matching what
      // the user sees on screen), runs the corresponding `gh` action,
      // and on success clears both the in-memory context entry and
      // the disk cache so the next view entry refetches. Comment
      // is additive; label / assign are toggleable via re-invocation
      // with --remove-* (deferred to phase 5 as part of the y-confirm
      // suite). Open / yank don't mutate so they skip the
      // invalidation step entirely.
      'triage-issue-open': async () => {
        const issue = filteredIssueList[
          Math.min(state.selectedIssueIndex, Math.max(0, filteredIssueList.length - 1))
        ]
        if (!issue) return { ok: false, message: 'No issue under cursor' }
        try {
          await defaultOpenUrlRunner(issue.url)
          return { ok: true, message: `Opened ${issue.url}` }
        } catch (error) {
          return { ok: false, message: (error as Error).message }
        }
      },
      'triage-issue-comment': async () => {
        const body = payload?.trim()
        if (!body) return { ok: false, message: 'Comment body required' }
        const issue = filteredIssueList[
          Math.min(state.selectedIssueIndex, Math.max(0, filteredIssueList.length - 1))
        ]
        if (!issue) return { ok: false, message: 'No issue under cursor' }
        const result = await commentIssue(issue.number, body)
        if (result.ok) invalidateIssueListCaches(issue.number)
        return result
      },
      'triage-issue-label': async () => {
        const label = payload?.trim()
        if (!label) return { ok: false, message: 'Label name required' }
        const issue = filteredIssueList[
          Math.min(state.selectedIssueIndex, Math.max(0, filteredIssueList.length - 1))
        ]
        if (!issue) return { ok: false, message: 'No issue under cursor' }
        const result = await addIssueLabel(issue.number, label)
        if (result.ok) invalidateIssueListCaches(issue.number)
        return result
      },
      'triage-issue-assign': async () => {
        const assignee = payload?.trim()
        if (!assignee) return { ok: false, message: 'Assignee login required' }
        const issue = filteredIssueList[
          Math.min(state.selectedIssueIndex, Math.max(0, filteredIssueList.length - 1))
        ]
        if (!issue) return { ok: false, message: 'No issue under cursor' }
        const result = await addIssueAssignee(issue.number, assignee)
        if (result.ok) invalidateIssueListCaches(issue.number)
        return result
      },
      'triage-pr-open': async () => {
        const pr = filteredPullRequestTriageList[
          Math.min(state.selectedPullRequestTriageIndex, Math.max(0, filteredPullRequestTriageList.length - 1))
        ]
        if (!pr) return { ok: false, message: 'No pull request under cursor' }
        try {
          await defaultOpenUrlRunner(pr.url)
          return { ok: true, message: `Opened ${pr.url}` }
        } catch (error) {
          return { ok: false, message: (error as Error).message }
        }
      },
      'triage-pr-comment': async () => {
        const body = payload?.trim()
        if (!body) return { ok: false, message: 'Comment body required' }
        const pr = filteredPullRequestTriageList[
          Math.min(state.selectedPullRequestTriageIndex, Math.max(0, filteredPullRequestTriageList.length - 1))
        ]
        if (!pr) return { ok: false, message: 'No pull request under cursor' }
        const result = await commentPullRequestByNumber(pr.number, body)
        if (result.ok) invalidatePullRequestListCaches(pr.number)
        return result
      },
      'triage-pr-label': async () => {
        const label = payload?.trim()
        if (!label) return { ok: false, message: 'Label name required' }
        const pr = filteredPullRequestTriageList[
          Math.min(state.selectedPullRequestTriageIndex, Math.max(0, filteredPullRequestTriageList.length - 1))
        ]
        if (!pr) return { ok: false, message: 'No pull request under cursor' }
        const result = await addPullRequestLabel(pr.number, label)
        if (result.ok) invalidatePullRequestListCaches(pr.number)
        return result
      },
      'triage-pr-assign': async () => {
        const assignee = payload?.trim()
        if (!assignee) return { ok: false, message: 'Assignee login required' }
        const pr = filteredPullRequestTriageList[
          Math.min(state.selectedPullRequestTriageIndex, Math.max(0, filteredPullRequestTriageList.length - 1))
        ]
        if (!pr) return { ok: false, message: 'No pull request under cursor' }
        const result = await addPullRequestAssignee(pr.number, assignee)
        if (result.ok) invalidatePullRequestListCaches(pr.number)
        return result
      },
      // #882 phase 5 — destructive triage mutations. Each is gated
      // through the y-confirm path so the user sees a prompt before
      // anything ships. The runner reads the cursored item from the
      // filtered list at confirm-time; the cursor can't move while
      // the confirmation overlay is up so there's no stale-target
      // window. Cache invalidation matches the phase-4 pattern.
      'triage-issue-close': async () => {
        const issue = filteredIssueList[
          Math.min(state.selectedIssueIndex, Math.max(0, filteredIssueList.length - 1))
        ]
        if (!issue) return { ok: false, message: 'No issue under cursor' }
        const result = await closeIssue(issue.number)
        if (result.ok) invalidateIssueListCaches(issue.number)
        return result
      },
      'triage-issue-reopen': async () => {
        const issue = filteredIssueList[
          Math.min(state.selectedIssueIndex, Math.max(0, filteredIssueList.length - 1))
        ]
        if (!issue) return { ok: false, message: 'No issue under cursor' }
        const result = await reopenIssue(issue.number)
        if (result.ok) invalidateIssueListCaches(issue.number)
        return result
      },
      'triage-pr-merge': async () => {
        const strategy = payload?.trim()
        if (!strategy || !isPullRequestMergeStrategy(strategy)) {
          return {
            ok: false,
            message: `Unknown merge strategy: ${strategy}. Use merge, squash, or rebase.`,
          }
        }
        const pr = filteredPullRequestTriageList[
          Math.min(state.selectedPullRequestTriageIndex, Math.max(0, filteredPullRequestTriageList.length - 1))
        ]
        if (!pr) return { ok: false, message: 'No pull request under cursor' }
        const result = await mergePullRequestByNumber(pr.number, strategy)
        if (result.ok) invalidatePullRequestListCaches(pr.number)
        return result
      },
      'triage-pr-close': async () => {
        const pr = filteredPullRequestTriageList[
          Math.min(state.selectedPullRequestTriageIndex, Math.max(0, filteredPullRequestTriageList.length - 1))
        ]
        if (!pr) return { ok: false, message: 'No pull request under cursor' }
        const result = await closePullRequestByNumber(pr.number)
        if (result.ok) invalidatePullRequestListCaches(pr.number)
        return result
      },
      'triage-pr-approve': async () => {
        const pr = filteredPullRequestTriageList[
          Math.min(state.selectedPullRequestTriageIndex, Math.max(0, filteredPullRequestTriageList.length - 1))
        ]
        if (!pr) return { ok: false, message: 'No pull request under cursor' }
        const result = await approvePullRequestByNumber(pr.number)
        if (result.ok) invalidatePullRequestListCaches(pr.number)
        return result
      },
      'triage-pr-request-changes': async () => {
        const body = payload?.trim()
        if (!body) return { ok: false, message: 'Review body required for change-request' }
        const pr = filteredPullRequestTriageList[
          Math.min(state.selectedPullRequestTriageIndex, Math.max(0, filteredPullRequestTriageList.length - 1))
        ]
        if (!pr) return { ok: false, message: 'No pull request under cursor' }
        const result = await requestChangesPullRequestByNumber(pr.number, body)
        if (result.ok) invalidatePullRequestListCaches(pr.number)
        return result
      },
      // Status surface group-level batch ops (#791 follow-up). The
      // input handler dispatches these when the user presses Enter on a
      // group header. We re-derive the file list from the live
      // `context.worktree?.files` rather than trusting a snapshot —
      // the worktree may have changed since the keystroke fired (rare,
      // but the cost of re-filtering is negligible compared to the cost
      // of a stale add). The mask is honored too so a user who's
      // hidden a category never has it touched by accident.
      'stage-all-unstaged': async () => {
        const files = applyStatusFilterMask(
          context.worktree?.files || [],
          state.statusFilterMask
        ).filter((file) => file.state === 'unstaged')
        return stageAllFiles(git, files)
      },
      'unstage-all-staged': async () => {
        const files = applyStatusFilterMask(
          context.worktree?.files || [],
          state.statusFilterMask
        ).filter((file) => file.state === 'staged')
        return unstageAllFiles(git, files)
      },
      'stage-all-untracked': async () => {
        const files = applyStatusFilterMask(
          context.worktree?.files || [],
          state.statusFilterMask
        ).filter((file) => file.state === 'untracked')
        return stageAllFiles(git, files)
      },
      'stage-all': async () => stageAll(git),
      'stage-pathspec': async () => stagePathspec(git, payload || ''),
    }
    const handler = handlers[id]
    if (!handler) {
      dispatch({ type: 'setStatus', value: `Workflow action ${id} not yet wired`, kind: 'warning' })
      return
    }
    // Remote network ops (fetch / pull / push) get a full-screen
    // history loader while in flight so the commit list doesn't sit
    // frozen and then abruptly repaint when the call returns. Cleared
    // in `finally` *after* the post-op refresh below so the loader
    // hands straight off to the freshly-fetched rows instead of
    // flashing the stale list for a frame in between.
    const remoteOp = REMOTE_OP_LOADERS[id]
    if (remoteOp) {
      dispatch({ type: 'setRemoteOp', value: remoteOp })
    }
    // Mark the cursored row as busy so it shows an inline pending
    // spinner while the git call runs (delete or checkout). Cleared in
    // `finally` after the refresh, so a successful delete hands straight
    // off to the row vanishing, a checkout to the sidebar repainting
    // with the new current branch, and a failure (e.g. an unmerged
    // branch) restores the row's normal icon alongside the error status.
    const pendingItemAction = resolvePendingItemAction(id, state, context)
    if (pendingItemAction) {
      dispatch({ type: 'setPendingItemAction', value: pendingItemAction })
    }
    try {
    const result = await handler()
    dispatch({ type: 'setStatus', value: result?.message || 'Workflow action complete' })
    // A safe `delete-branch` (`git branch -d`) refuses branches that
    // aren't fully merged. Rather than dead-end on git's raw error, raise
    // a second y-confirm offering the force-delete (`git branch -D`). The
    // cursor hasn't moved (the delete failed), so the force handler
    // re-resolves the same branch.
    if (id === 'delete-branch' && !result?.ok && isBranchNotFullyMergedError(result?.message)) {
      dispatch({ type: 'setPendingConfirmation', value: 'force-delete-branch' })
    }
    // A branch checked out in a worktree can't be deleted — and unlike
    // the unmerged case, `git branch -D` won't force it either, so we
    // don't offer a confirmation. Replace git's raw rejection with a
    // clear "free up the worktree first" message that names where the
    // branch is still in use.
    if (
      (id === 'delete-branch' || id === 'force-delete-branch') &&
      !result?.ok &&
      isBranchCheckedOutElsewhereError(result?.message)
    ) {
      const worktreePath = parseCheckedOutWorktreePath(result?.message)
      const branchName = pendingItemAction?.id
      dispatch({
        type: 'setStatus',
        value: worktreePath
          ? `Can't delete ${branchName ? `'${branchName}'` : 'branch'} — checked out in worktree ${worktreePath}. Switch that worktree off the branch or remove it first.`
          : `Can't delete ${branchName ? `'${branchName}'` : 'branch'} — it's checked out in another worktree. Switch that worktree off the branch or remove it first.`,
        kind: 'warning',
      })
    }
    // Checking out a branch that's already checked out in another
    // worktree is rejected by git ("already checked out at <path>").
    // Rather than dead-end on that, capture the conflict and raise a
    // y-confirm offering to switch into that worktree — the branch IS
    // checked out, just elsewhere (#1175).
    if (id === 'checkout-branch' && !result?.ok && isBranchCheckedOutElsewhereError(result?.message)) {
      const worktreePath = parseCheckedOutWorktreePath(result?.message)
      const branchName = pendingItemAction?.id
      if (worktreePath && branchName) {
        const worktree = context.worktreeList?.worktrees?.find((w) => w.path === worktreePath)
        dispatch({
          type: 'setWorktreeCheckoutConflict',
          value: { branch: branchName, worktreePath, dirty: worktree?.dirty ?? false },
        })
        dispatch({ type: 'setPendingConfirmation', value: 'switch-to-conflicting-worktree' })
      } else {
        dispatch({
          type: 'setStatus',
          value: `'${branchName ?? 'branch'}' is already checked out in another worktree.`,
          kind: 'warning',
        })
      }
    }
    // Refresh history rows AS WELL when the workflow could have
    // changed the commits the user sees (#945 follow-up). The
    // workflow IDs below all either create/rewrite local commits or
    // change which branch's history is being viewed — without this
    // the history pane shows stale data even after the operation
    // succeeds. Cheap one-off `git log` call; doesn't fire on
    // metadata-only mutations (delete-tag, set-upstream, etc.).
    const historyMutatingIds = new Set([
      'checkout-branch',
      'continue-operation',
      'pull-current-branch',
      // Fetch / pull / push bring in new commits and move
      // remote-tracking refs (origin/main, ahead/behind) — refresh the
      // graph so they appear instead of staying pinned to the pre-sync
      // state. (A successful push advances the local origin/<branch>
      // ref, so the chip should hop to the pushed commit.)
      'fetch-remotes',
      'fetch-selected-branch',
      'pull-selected-branch',
      'push-current-branch',
      'push-selected-branch',
      'cherry-pick-commit',
      'revert-commit',
      'reset-hard-to-commit',
      'reset-soft-to-commit',
      'reset-mixed-to-commit',
      'interactive-rebase-to-commit',
      'bisect-good',
      'bisect-bad',
      'bisect-skip',
      'bisect-reset',
    ])
    if (result?.ok && historyMutatingIds.has(id)) {
      await refreshHistoryRows()
    }

    // Checkout-branch snaps the cursor to position 0 first so when the
    // refresh completes and the new current branch lands at the top
    // (per #809's pin-current rule), the cursor is already there
    // waiting. The refresh is *silent*: the loud refresh used to blank
    // every branch name behind a "loading branches…" placeholder (#806),
    // but the in-flight row now carries its own inline pending spinner
    // (resolvePendingItemAction → action 'checkout'), so a silent
    // stale-while-revalidate swap keeps the list readable and just
    // repaints the current-branch marker once the new context lands.
    if (id === 'checkout-branch' && result?.ok) {
      dispatch({ type: 'resetBranchSelection' })
      await refreshContext({ silent: true })
    } else {
      // Silent refresh so the deleted item disappears from the list
      // without flickering the surfaces through a 'loading' phase.
      await refreshContext({ silent: true })
    }

    // Stash workflow follow-up. Two distinct behaviours.
    //
    // **apply / pop**: the user brought stashed content back into the
    // worktree, but the sidebar still has them on the stash view.
    // Expected next move is "look at what landed in my worktree", so
    // jump them to history view (where the worktree counts in the
    // sidebar are visible) AND refresh worktree context explicitly so
    // the staged / unstaged / untracked numbers reflect the changes.
    //
    // **drop**: the silent context refresh above already re-fetched
    // the stash list, BUT users reported it feeling like nothing
    // happened. Fix two things: refresh worktree alongside (drops can
    // affect untracked files when the stash held `-u` state), and
    // surface the new stash count on the status line so there's
    // unambiguous feedback that the drop landed and the list shrank.
    if (result?.ok && (id === 'apply-stash' || id === 'pop-stash')) {
      dispatch({ type: 'pushView', value: 'history' })
      await refreshWorktreeContext()
    }
    // Refresh the worktree so a now-ignored untracked file drops out of
    // the status list immediately (the silent context refresh above
    // doesn't always re-read the worktree file set).
    if (result?.ok && id === 'add-to-gitignore') {
      await refreshWorktreeContext()
    }
    // Stage-all / stage-pathspec change staged/unstaged counts — refresh
    // the worktree so the status list + compose summary reflect it.
    if (result?.ok && (id === 'stage-all' || id === 'stage-pathspec')) {
      await refreshWorktreeContext()
    }
    if (result?.ok && id === 'drop-stash') {
      // Explicit worktree refresh in case the dropped stash carried
      // untracked-file state that's now collected.
      await refreshWorktreeContext()
      // The silent context refresh already replaced `context.stashes`;
      // reading the count back here would be stale because closures
      // capture the pre-refresh value. Status message stays generic
      // ("Dropped stash@{N}") — the visible list shrinking is the
      // unambiguous signal that the operation landed.
    }
    } finally {
      // Always clear the loader — even if a refresh threw — so a
      // failed fetch/pull can't leave the history surface stuck behind
      // the spinner.
      if (remoteOp) {
        dispatch({ type: 'setRemoteOp', value: undefined })
      }
      // Same guarantee for the per-row pending spinner (delete or
      // checkout): clear it whether the action succeeded, failed, or the
      // refresh threw, so no row is left spinning forever.
      if (pendingItemAction) {
        dispatch({ type: 'setPendingItemAction', value: undefined })
      }
    }
  }, [context, dispatch, git, refreshContext, refreshHistoryRows, refreshWorktreeContext,
    state.branchSort, state.filter, state.selectedBranchIndex,
    state.selectedStashIndex, state.selectedTagIndex, state.selectedWorktreeListIndex, state.stashDiffRef,
    state.statusFilterMask, state.tagSort])

  // Resolve the active view's "yank target" (commit hash / branch /
  // tag / stash ref / file path) against the live filtered+sorted list,
  // copy it to the system clipboard, and surface the result on the
  // status line. `short=true` opts into the short hash on history /
  // commit-diff views (Y vs y); ignored for ref-only views.
  const yankFromActiveView = React.useCallback(async (short?: boolean) => {
    const clipboard: ClipboardRunner = clipboardRunner || defaultClipboardRunner
    let value: string | undefined
    let label: string | undefined

    const view = state.activeView
    if (view === 'history') {
      const commit = state.filteredCommits[state.selectedIndex]
      if (commit) {
        value = short ? commit.shortHash : commit.hash
        label = short ? `short hash ${commit.shortHash}` : `commit ${commit.shortHash}`
      }
    } else if (view === 'branches') {
      const all = sortBranches(context.branches?.localBranches || [], state.branchSort)
      const visible = state.filter
        ? all.filter((b) => matchesPromotedFilter([b.shortName, b.upstream || ''], state.filter))
        : all
      const branch = visible[Math.min(state.selectedBranchIndex, Math.max(0, visible.length - 1))]
      if (branch) {
        value = branch.shortName
        label = `branch ${branch.shortName}`
      }
    } else if (view === 'tags') {
      const all = sortTags(context.tags?.tags || [], state.tagSort)
      const visible = state.filter
        ? all.filter((t) => matchesPromotedFilter([t.name, t.subject], state.filter))
        : all
      const tag = visible[Math.min(state.selectedTagIndex, Math.max(0, visible.length - 1))]
      if (tag) {
        value = tag.name
        label = `tag ${tag.name}`
      }
    } else if (view === 'stash') {
      const all = context.stashes?.stashes || []
      const visible = state.filter
        ? all.filter((s) => matchesPromotedFilter([s.ref, s.message], state.filter))
        : all
      const stash = visible[Math.min(state.selectedStashIndex, Math.max(0, visible.length - 1))]
      if (stash) {
        value = stash.ref
        label = `stash ${stash.ref}`
      }
    } else if (view === 'status') {
      // Read from the mask-filtered list (#776) so the cursor and the
      // yanked path always match what's on screen — yanking a hidden
      // row is always a desync bug.
      const path = visibleWorktreeFilesGrouped[state.selectedWorktreeFileIndex]?.path
      if (path) {
        value = path
        label = `path ${path}`
      }
    } else if (view === 'submodules') {
      // #932 — yank from the dedicated submodules view. `y` (default)
      // copies the cursored submodule's path; `Y` (short) copies the
      // pinned commit's short sha. Either is what the user most
      // likely wants — path for `git submodule update <path>`, sha
      // for cross-referencing in logs or other repos.
      const entries = context.submodules?.entries || []
      const filtered = state.filter
        ? entries.filter((entry) => matchesPromotedFilter(
          [entry.name, entry.path, entry.trackingBranch || '', entry.url || ''],
          state.filter,
        ))
        : entries
      const entry = filtered[Math.min(state.selectedSubmoduleIndex, Math.max(0, filtered.length - 1))]
      if (entry) {
        if (short) {
          if (entry.pinnedSha) {
            value = entry.pinnedSha.slice(0, 8)
            label = `short sha ${value} (submodule ${entry.name})`
          }
        } else {
          value = entry.path
          label = `submodule path ${entry.path}`
        }
      }
    } else if (view === 'issues') {
      // #882 phase 4 — y yanks the cursored issue's URL so the user
      // can paste it into Slack / a PR description / etc. without
      // dropping back to the browser. Short form (`Y`) is a no-op
      // here — there's no compact identifier worth a second key.
      const issue = filteredIssueList[
        Math.min(state.selectedIssueIndex, Math.max(0, filteredIssueList.length - 1))
      ]
      if (issue) {
        value = issue.url
        label = `issue #${issue.number} URL`
      }
    } else if (view === 'pull-request-triage') {
      // #882 phase 4 — same URL-yank pattern for the multi-PR list.
      // Distinct from `pull-request` (single, current-branch); that
      // view falls through to the generic "Nothing to yank" path
      // below since the action panel already exposes O for browser
      // open.
      const pr = filteredPullRequestTriageList[
        Math.min(state.selectedPullRequestTriageIndex, Math.max(0, filteredPullRequestTriageList.length - 1))
      ]
      if (pr) {
        value = pr.url
        label = `pull request #${pr.number} URL`
      }
    } else if (view === 'bisect') {
      // #879 item 3 — yank the first-bad commit sha from the
      // completion panel. The headline answer is what the user
      // came here to copy. Y opts into the short form; y returns
      // the full sha as recorded in BISECT_LOG.
      const completion = context.bisect?.active
        ? getBisectCompletion(context.bisect.log)
        : undefined
      if (completion) {
        value = short ? completion.sha.slice(0, 8) : completion.sha
        label = short
          ? `short hash ${completion.sha.slice(0, 8)} (first bad)`
          : `commit ${completion.sha.slice(0, 8)} (first bad)`
      }
    } else if (view === 'diff') {
      if (state.diffSource === 'worktree') {
        const path = visibleWorktreeFilesGrouped[state.selectedWorktreeFileIndex]?.path
        if (path) {
          value = path
          label = `path ${path}`
        }
      } else if (state.diffSource === 'stash' && stashDiffLines) {
        // Walk back to the most recent file header at or before the
        // current preview offset — same logic the input-context block
        // uses to expose stashDiffSelectedPath. Reads the memoized
        // parse so the yank handler doesn't re-walk the entire patch.
        const current = findStashFileForOffset(stashDiffParsedFiles, state.diffPreviewOffset)
        if (current) {
          value = current.path
          label = `path ${current.path}`
        }
      } else if (state.diffSource === 'commit') {
        // Y on a commit-diff yanks the sha (handy when the user has
        // drilled into the file list); y yanks the cursored file path.
        if (short && selected) {
          value = selected.hash
          label = `commit ${selected.shortHash}`
        } else if (selectedDetailFile?.path) {
          value = selectedDetailFile.path
          label = `path ${selectedDetailFile.path}`
        } else if (selected) {
          value = selected.hash
          label = `commit ${selected.shortHash}`
        }
      }
    }

    if (!value || !label) {
      dispatch({ type: 'setStatus', value: 'Nothing to yank in this view', kind: 'warning' })
      return
    }

    try {
      await clipboard(value)
      dispatch({ type: 'setStatus', value: `Copied ${label}`, kind: 'success' })
    } catch (error) {
      dispatch({ type: 'setStatus', value: `Copy failed: ${(error as Error).message}`, kind: 'error' })
    }
  }, [
    clipboardRunner,
    context.bisect,
    context.branches,
    context.stashes,
    context.submodules,
    context.tags,
    dispatch,
    filteredIssueList,
    filteredPullRequestTriageList,
    selected,
    selectedDetailFile,
    stashDiffLines,
    stashDiffParsedFiles,
    state.activeView,
    state.branchSort,
    state.diffPreviewOffset,
    state.diffSource,
    state.filter,
    state.filteredCommits,
    state.selectedBranchIndex,
    state.selectedIndex,
    state.selectedIssueIndex,
    state.selectedPullRequestTriageIndex,
    state.selectedStashIndex,
    state.selectedSubmoduleIndex,
    state.selectedTagIndex,
    state.selectedWorktreeFileIndex,
    state.tagSort,
    visibleWorktreeFilesGrouped,
  ])

  React.useEffect(() => {
    let active = true

    async function loadPreview(): Promise<void> {
      if (!selected || !selectedDetailFile) {
        setFilePreview(undefined)
        return
      }

      setFilePreviewLoading(true)
      const nextPreview = await safe(getCommitFilePreview(git, selected.hash, selectedDetailFile))

      if (active) {
        setFilePreview(nextPreview)
        setFilePreviewLoading(false)
      }
    }

    void loadPreview()

    return () => {
      active = false
    }
  }, [git, selected?.hash, selectedDetailFile?.path, selectedDetailFile?.oldPath])

  React.useEffect(() => {
    return () => {
      mountedRef.current = false
    }
  }, [])

  React.useEffect(() => {
    loadingMoreCommitsRef.current = loadingMoreCommits
  }, [loadingMoreCommits])

  // STABLE useCallback (empty deps) for loadMoreCommits. The function
  // reads the volatile state (commit counts, fetch args, hasMore) via
  // refs that update on every render so the identity stays constant.
  //
  // Why stable matters: the cursor-syncs-history auto-load chain
  // calls this through a forward-reference ref (loadMoreCommitsRef).
  // If loadMoreCommits regenerated on every render — as the previous
  // implementation did via state deps — there was a render-order
  // race: the cursor sync effect would call the PREVIOUS render's
  // callback (still in the ref because the ref-setter useEffect runs
  // after the cursor-sync effect in declaration order), which had
  // captured a stale `state.commits.length` and re-fetched the same
  // window. The auto-load chain appeared to fire but never advanced
  // through history.
  //
  // Stable identity + refs sidesteps the race entirely: the function
  // never changes, and every call reads the latest state.
  const loadMoreStateRef = React.useRef({
    commitsLength: state.commits.length,
    filteredCommitsLength: state.filteredCommits.length,
    historyFetchArgs: state.historyFetchArgs,
    hasMoreCommits,
    logArgv,
  })
  loadMoreStateRef.current = {
    commitsLength: state.commits.length,
    filteredCommitsLength: state.filteredCommits.length,
    historyFetchArgs: state.historyFetchArgs,
    hasMoreCommits,
    logArgv,
  }

  const loadMoreCommits = React.useCallback(async (
    options: { statusMessage?: string } = {}
  ): Promise<{ fired: boolean; addedCommits: number }> => {
    const snap = loadMoreStateRef.current
    if (!snap.logArgv || snap.logArgv.limit || loadingMoreCommitsRef.current || !snap.hasMoreCommits) {
      return { fired: false, addedCommits: 0 }
    }
    if (snap.filteredCommitsLength === 0) {
      return { fired: false, addedCommits: 0 }
    }

    loadingMoreCommitsRef.current = true
    const requestId = loadMoreRequestRef.current + 1
    loadMoreRequestRef.current = requestId
    setLoadingMoreCommits(true)
    dispatch({
      type: 'setStatus',
      value: options.statusMessage || 'loading older commits',
      loading: true,
    })
    const fetchArgs = snap.historyFetchArgs
    const mergedArgv: LogArgv = {
      ...snap.logArgv,
      ...(fetchArgs?.author ? { author: fetchArgs.author } : {}),
      ...(fetchArgs?.path ? { path: fetchArgs.path } : {}),
    }
    // Load-more paths a fresh page from git AFTER what's already
    // loaded; pass the stash hashes again so the additional rows
    // stay graph-consistent with the boot fetch (a window that
    // dropped stashes mid-stream would render with broken junctions).
    const stashHashes = await getStashCommitHashes(git).catch(() => [])
    const nextRows = await safe(
      getLogRows(git, mergedArgv, {
        limit: LOG_INTERACTIVE_DEFAULT_LIMIT,
        skip: snap.commitsLength,
        extraRefs: stashHashes,
      })
    )

    if (!mountedRef.current || loadMoreRequestRef.current !== requestId) {
      return { fired: false, addedCommits: 0 }
    }

    loadingMoreCommitsRef.current = false
    setLoadingMoreCommits(false)

    const nextCommitCount = nextRows ? getCommitRows(nextRows).length : 0

    if (!nextRows) {
      dispatch({ type: 'setStatus', value: 'failed to load older commits', kind: 'error' })
      return { fired: false, addedCommits: 0 }
    }

    if (nextRows?.length) {
      dispatch({ type: 'appendRows', rows: nextRows })
    }

    setHasMoreCommits(nextCommitCount >= LOG_INTERACTIVE_DEFAULT_LIMIT)
    return { fired: true, addedCommits: nextCommitCount }
    // Empty deps — the function is intentionally stable. State is
    // read via `loadMoreStateRef.current` at call time, and `dispatch`
    // / `git` / `setLoadingMoreCommits` / `setHasMoreCommits` are
    // already stable across renders by React's contract.
  }, [dispatch, git])

  // Scroll-near-bottom auto-trigger. Fires when the user's cursor is
  // within 20 rows of the last loaded commit so older history is
  // already on its way by the time they reach the bottom.
  React.useEffect(() => {
    const remaining = state.filteredCommits.length - state.selectedIndex - 1
    if (remaining > 20) return
    void loadMoreCommits().then((result) => {
      if (result.fired) {
        dispatch({
          type: 'setStatus',
          value: result.addedCommits
            ? `loaded ${result.addedCommits} older commits`
            : 'end of history',
        })
      }
    })
  }, [
    dispatch,
    loadMoreCommits,
    state.filteredCommits.length,
    state.selectedIndex,
  ])

  /**
   * Targeted-context loader for the cursor-syncs-history effect. Called
   * when the resolver returns `load-context` — the user cursored a
   * branch / tag / stash whose target commit isn't in the loaded
   * window, so we run a `git log` anchored on that commit (guaranteed
   * to include it) and merge the result via `appendRows` (which
   * already deduplicates by hash).
   *
   * Stable identity (empty deps) for the same reason as
   * `loadMoreCommits` — the cursor-sync effect calls this through a
   * forward-reference ref, and a regenerating callback would
   * reintroduce the render-order race that bit the previous chain.
   * All volatile state (logArgv, mostly) is read via refs.
   */
  const loadCommitContextStateRef = React.useRef({ logArgv })
  loadCommitContextStateRef.current = { logArgv }

  const loadCommitContext = React.useCallback(async (
    target: { hash: string; label: string }
  ): Promise<void> => {
    const snap = loadCommitContextStateRef.current
    if (!snap.logArgv) return
    dispatch({
      type: 'setStatus',
      value: `Loading commits around ${target.label}…`,
      loading: true,
    })
    try {
      // No stashHashes here — `getLogRowsAnchoredOn` walks only from
      // the target so it can guarantee the target's inclusion.
      // Stashes are already in the loaded graph from boot's
      // `loadRowsWithStashes`; `appendRows` deduplicates by hash so
      // the merged result keeps both views without double-counting.
      const rows = await getLogRowsAnchoredOn(git, snap.logArgv, target.hash, {})
      if (!mountedRef.current) return
      if (rows.length > 0) {
        dispatch({ type: 'appendRows', rows })
        // Don't dispatch a setStatus here — the cursor-sync effect
        // will re-fire on the appendRows-driven filteredCommits
        // change and either jump (success) or report unreachable
        // (failure), surfacing the right message.
      } else {
        dispatch({
          type: 'setStatus',
          value: `${target.label} target commit returned no rows — orphan ref?`,
          kind: 'warning',
        })
      }
    } catch (error) {
      if (mountedRef.current) {
        dispatch({
          type: 'setStatus',
          value: `Failed to load context for ${target.label}: ${
            error instanceof Error ? error.message : String(error)
          }`,
          kind: 'error',
        })
      }
    }
  }, [dispatch, git])

  React.useEffect(() => {
    loadCommitContextRef.current = loadCommitContext
  }, [loadCommitContext])

  // Server-side history filter (#776). When the user submits `path:foo`
  // or `author:foo`, the filter parser dispatches setHistoryFetchArgs;
  // this effect picks up the change, re-runs `getLogRows` with merged
  // args, and replaces the rows. Clearing the fetch args (Ctrl+U inside
  // filter mode) re-fetches with the original logArgv so the user gets
  // the live full log back, not a stale snapshot of the initial rows.
  const historyFetchEffectInitialized = React.useRef(false)
  const historyFetchRequestRef = React.useRef(0)
  React.useEffect(() => {
    if (!logArgv) return
    // Skip the first run — initial rows came in via deps.rows; we only
    // want to fetch in response to *changes* to historyFetchArgs.
    if (!historyFetchEffectInitialized.current) {
      historyFetchEffectInitialized.current = true
      return
    }

    const requestId = historyFetchRequestRef.current + 1
    historyFetchRequestRef.current = requestId
    const fetchArgs = state.historyFetchArgs
    const merged: LogArgv = {
      ...logArgv,
      ...(fetchArgs?.author ? { author: fetchArgs.author } : {}),
      ...(fetchArgs?.path ? { path: fetchArgs.path } : {}),
    }
    const description = fetchArgs?.author
      ? `author:${fetchArgs.author}`
      : fetchArgs?.path
        ? `path:${fetchArgs.path}`
        : undefined

    dispatch({
      type: 'setStatus',
      value: description ? `Refetching with ${description}` : 'Restoring full log',
    })

    void (async () => {
      const stashHashes = await getStashCommitHashes(git).catch(() => [])
      const nextRows = await safe(getLogRows(git, merged, {
        limit: LOG_INTERACTIVE_DEFAULT_LIMIT,
        extraRefs: stashHashes,
      }))
      if (!mountedRef.current || historyFetchRequestRef.current !== requestId) {
        return
      }
      if (!nextRows) {
        dispatch({ type: 'setStatus', value: 'Failed to refetch with active filter', kind: 'error' })
        return
      }
      dispatch({ type: 'replaceRows', rows: nextRows })
      const matched = getCommitRows(nextRows).length
      setHasMoreCommits(matched >= LOG_INTERACTIVE_DEFAULT_LIMIT)
      dispatch({
        type: 'setStatus',
        value: description
          ? `Showing ${matched} commits matching ${description}`
          : 'Showing full log',
        kind: 'success',
      })
    })()
  }, [dispatch, git, logArgv, state.historyFetchArgs])

  // Graph mode toggle (`g` key, #791 follow-up). The header label flips
  // between "compact graph" and "full graph", but unless we re-fetch with
  // the right `view`, the underlying rows still come from the user's
  // initial argv (default `--first-parent --no-merges`) and the renderer
  // has no topology to draw — defeating the per-lane / junction work.
  // Mirrors the historyFetchArgs effect: skip first run, request-id ref
  // for stale-completion guard, swap rows in place via replaceRows.
  const toggleGraphEffectInitialized = React.useRef(false)
  const toggleGraphRequestRef = React.useRef(0)
  React.useEffect(() => {
    if (!logArgv) return
    if (!toggleGraphEffectInitialized.current) {
      toggleGraphEffectInitialized.current = true
      return
    }

    const requestId = toggleGraphRequestRef.current + 1
    toggleGraphRequestRef.current = requestId
    const merged = buildToggleGraphArgs(logArgv, state.fullGraph)

    dispatch({
      type: 'setStatus',
      value: state.fullGraph
        ? 'Loading full topology…'
        : 'Loading compact history…',
    })

    void (async () => {
      // Include stash commits as graph roots so the toggle's re-fetch
      // sees the same rich graph the boot loader assembles. Without
      // this, flipping `\` into full mode and back loses the stash
      // anchors that loadRowsWithStashes seeded on boot.
      const stashHashes = await getStashCommitHashes(git).catch(() => [])
      const nextRows = await safe(getLogRows(git, merged, {
        limit: LOG_INTERACTIVE_DEFAULT_LIMIT,
        extraRefs: stashHashes,
      }))
      if (!mountedRef.current || toggleGraphRequestRef.current !== requestId) {
        return
      }
      if (!nextRows) {
        dispatch({ type: 'setStatus', value: 'Failed to refetch graph rows', kind: 'error' })
        return
      }
      dispatch({ type: 'replaceRows', rows: nextRows })
      const matched = getCommitRows(nextRows).length
      setHasMoreCommits(matched >= LOG_INTERACTIVE_DEFAULT_LIMIT)
      dispatch({
        type: 'setStatus',
        value: state.fullGraph
          ? `Showing ${matched} commits across all branches`
          : `Showing ${matched} commits (compact)`,
        kind: 'success',
      })
    })()
  }, [dispatch, git, logArgv, state.fullGraph])

  const commitDiffHunkOffsets = React.useMemo(() => (
    filePreview?.hunks
      .map((line, index) => (line.startsWith('@@') ? index : -1))
      .filter((index) => index >= 0)
  ), [filePreview])

  const worktreeDirty = Boolean(
    context.worktree &&
    (context.worktree.stagedCount + context.worktree.unstagedCount + context.worktree.untrackedCount) > 0
  )

  useInput((inputValue: string, key: LogInkInputKey) => {
    // First-launch onboarding (P1.3): any keystroke dismisses the overlay
    // and writes the seen-marker. Swallow the keystroke so the same key
    // doesn't also trigger normal input dispatch.
    if (showOnboarding) {
      setShowOnboarding(false)
      markOnboardingSeen()
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
    const tagVisibleCount = filteredTagList.length
    const tagSelectedName = filteredTagList[
      Math.min(state.selectedTagIndex, Math.max(0, filteredTagList.length - 1))
    ]?.name
    const stashVisibleCount = filteredStashList.length
    const stashSelectedRef = filteredStashList[
      Math.min(state.selectedStashIndex, Math.max(0, filteredStashList.length - 1))
    ]?.ref
    const reflogVisibleCount = filteredReflogList.length
    const reflogSelectedHash = filteredReflogList[
      Math.min(state.selectedReflogIndex, Math.max(0, filteredReflogList.length - 1))
    ]?.hash
    const submoduleVisibleCount = filteredSubmoduleList.length
    const submoduleSelectedPath = filteredSubmoduleList[
      Math.min(state.selectedSubmoduleIndex, Math.max(0, filteredSubmoduleList.length - 1))
    ]?.path
    const issueVisibleCount = filteredIssueList.length
    const issueSelectedUrl = filteredIssueList[
      Math.min(state.selectedIssueIndex, Math.max(0, filteredIssueList.length - 1))
    ]?.url
    const pullRequestTriageVisibleCount = filteredPullRequestTriageList.length
    const pullRequestTriageSelectedUrl = filteredPullRequestTriageList[
      Math.min(state.selectedPullRequestTriageIndex, Math.max(0, filteredPullRequestTriageList.length - 1))
    ]?.url
    const worktreeVisibleCount = filteredWorktreeList.length

    // When the diff view is showing a stash patch, swap the previewLineCount
    // to the stash diff length so the existing pageDetailPreview path
    // (j/k, PgUp/PgDn) scrolls through it without a parallel pipeline.
    const diffPreviewLineCount = state.diffSource === 'stash'
      ? stashDiffLines?.length
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
      tagCount: tagVisibleCount,
      tagSelectedName,
      stashCount: stashVisibleCount,
      reflogCount: reflogVisibleCount,
      reflogSelectedHash,
      submoduleCount: submoduleVisibleCount,
      submoduleSelectedPath,
      issueCount: issueVisibleCount,
      issueSelectedUrl,
      pullRequestTriageCount: pullRequestTriageVisibleCount,
      pullRequestTriageSelectedUrl,
      stashSelectedRef,
      stashDiffFileOffsets: stashDiffFileOffsets.length ? stashDiffFileOffsets : undefined,
      stashDiffSelectedPath,
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
        void runWorkflowAction(event.id, event.payload)
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

  // In single-pane mode (narrow terminals) only one pane renders, so an
  // active overlay must pull its own pane into view rather than stay
  // hidden behind whatever pane focus points at. The split-plan overlay
  // lives in the main panel; every other overlay (help / palette / theme
  // / gitignore / input prompt / confirmation / chord) renders in the
  // inspector. Ignored above the single-pane breakpoint (all panes show).
  const forcedPane: LogInkVisiblePane | undefined = state.splitPlan
    ? 'main'
    : state.showHelp ||
        state.showViewKeys ||
        state.showCommandPalette ||
        state.showThemePicker ||
        state.gitignorePicker ||
        state.inputPrompt ||
        state.pendingConfirmationId ||
        state.pendingMutationConfirmation ||
        state.pendingKey
      ? 'inspector'
      : undefined

  // Layout depends on focus (sidebar grows when focused), so it's
  // computed here — after state is in scope but before the render path.
  const layout = getLogInkLayout({
    columns: windowSize.columns || process.stdout.columns || LOG_INK_DEFAULT_COLUMNS,
    rows: windowSize.rows || process.stdout.rows || LOG_INK_DEFAULT_ROWS,
    sidebarFocused: state.focus === 'sidebar',
    inspectorFocused: state.focus === 'detail',
    helpOverlayActive: state.showHelp,
    forcedPane,
  })

  // Runtime Context provider (#1136). Bundles the five most-drilled
  // values so surfaces can read them from context instead of receiving
  // them as positional props. No consumers yet — this PR only installs
  // the provider at the root; the surface families migrate in later PRs.
  // A Context.Provider renders its children transparently (no host
  // output), so wrapping the tree is behavior-preserving.
  const RuntimeContext = getLogInkRuntimeContext(React)
  const runtimeContextValue: LogInkRuntimeContextValue = {
    state,
    dispatch,
    theme,
    layout,
    context,
  }

  if (layout.tooSmall) {
    return h(Box, {
      flexDirection: 'column',
      height: layout.rows,
      paddingX: 1,
      paddingY: 1,
    },
    h(Text, { bold: true }, appLabel),
    h(Text, undefined, `Terminal too small: ${layout.columns}x${layout.rows}`),
    h(Text, { dimColor: true }, `Minimum size is ${LOG_INK_MIN_COLUMNS}x${LOG_INK_MIN_ROWS}.`),
    h(Text, { dimColor: true }, 'Resize the terminal or run plain coco log.'))
  }

  // First-launch onboarding overlay (P1.3) replaces the entire UI for
  // one render — any keystroke dismisses it and persists the seen-marker.
  if (showOnboarding) {
    return renderOnboardingOverlay(h, { Box, Text }, layout.rows, layout.columns, theme, appLabel)
  }

  // Panel renderers are thunks so single-pane mode can build only the
  // visible pane — the main-panel render in particular is expensive, so
  // we don't want to invoke the two hidden ones just to drop them.
  const sidebarPanel = () =>
    renderSidebar(h, { Box, Text }, state, context, contextStatus, layout.sidebarWidth, layout.bodyRows, theme, spinnerFrame)
  const mainSurface: SurfaceRenderContext = {
    h,
    components: { Box, Text },
    state,
    context,
    contextStatus,
    bodyRows: layout.bodyRows,
    width: layout.mainPanelWidth,
    theme,
  }
  const mainPanel = () =>
    renderMainPanel(
      mainSurface,
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
      hasMoreCommits,
      loadingMoreCommits,
      spinnerFrame,
      layout.density,
      layout.historyRowMode,
      Boolean(dateBucketingEnabled),
      diffSyntaxSpans
    )
  const detailPanel = () =>
    renderDetailPanel(
      h,
      { Box, Text },
      state,
      context,
      contextStatus,
      detail,
      detailLoading,
      filePreview,
      filePreviewLoading,
      layout.detailWidth,
      layout.inspectorTabbed,
      theme,
      layout.bodyRows
    )

  // Single-pane mode (narrow terminals): exactly one full-width pane,
  // chosen by `layout.visiblePane`; Tab cycles which one. Above the
  // breakpoint all three tile side by side as before.
  const bodyPanels = layout.singlePane
    ? [
        layout.visiblePane === 'sidebar'
          ? sidebarPanel()
          : layout.visiblePane === 'inspector'
            ? detailPanel()
            : mainPanel(),
      ]
    : [sidebarPanel(), mainPanel(), detailPanel()]

  return h(RuntimeContext.Provider, { value: runtimeContextValue },
    h(Box, { flexDirection: 'column', height: layout.rows },
    renderHeader(h, { Box, Text }, state, context, contextStatus, layout.columns, theme, appLabel),
    h(Box, { flexDirection: 'row', height: layout.bodyRows }, ...bodyPanels),
    renderFooter(h, { Box, Text }, state, context, theme, idleTip, spinnerFrame, layout.singlePane)
    )
  )
}

