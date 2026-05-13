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
import { formatSplitApplySuccess } from '../chrome/postApplyHints'
import { SPINNER_TICK_MS } from '../chrome/spinner'


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
    LOG_INK_MIN_ROWS,
    getLogInkLayout,
} from '../chrome/layout'
import { sortBranches, sortTags } from '../chrome/sorting'
import { IDLE_TIPS_GRACE_MS, IDLE_TIPS_INTERVAL_MS, pickIdleTip } from '../chrome/idleTips'
import {
    LogInkState,
    applyLogInkAction,
    createLogInkState,
    getSelectedInkCommit,
} from '../../commands/log/inkViewModel'
import { getGitOperationOverview } from '../../git/operationData'
import { openProviderUrl } from '../../git/providerActions'
import { getProviderOverview } from '../../git/providerData'
import {
    checkoutBranch,
    createBranch,
    deleteBranch,
    fetchRemotes,
    pullCurrentBranch,
    pushCurrentBranch,
    renameBranch,
    setUpstream,
} from '../../git/branchActions'
import { createLightweightTag, deleteLocalTag, deleteRemoteTag, pushTag } from '../../git/tagActions'
import {
    ClipboardRunner,
    ResetMode,
    checkoutFileFromCommit,
    cherryPickCommit,
    createBranchFromCommit,
    createTagAtCommit,
    defaultClipboardRunner,
    isResetMode,
    resetToCommit,
    revertCommit,
    startInteractiveRebase,
} from '../../git/historyActions'
import { applyStash, checkoutFileFromStash, createStash, dropStash, popStash } from '../../git/stashActions'
import { ApplyHunkTarget, applyHunkPatch } from '../../git/hunkActions'
import { removeWorktree, removeWorktreeAndBranch } from '../../git/worktreeActions'
import { abortOperation, continueOperation, resolveConflictOurs, resolveConflictTheirs, stageConflictResolved } from '../../git/operationActions'
import { getPullRequestOverview } from '../../git/pullRequestData'
import {
    approvePullRequest,
    closePullRequest,
    commentPullRequest,
    createPullRequest,
    isPullRequestMergeStrategy,
    mergePullRequest,
    requestChangesPullRequest,
} from '../../git/pullRequestActions'
import { runPullRequestBodyWorkflow } from '../../git/aiActions'
import {
    findStashFileForOffset,
    getStashDiff,
    getStashOverview,
    parseStashDiffFiles,
} from '../../git/stashData'
import {
    revertFile,
    stageAllFiles,
    stageFile,
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
// Entry-point types (LogInkStreams, LogInkOptions) and the orchestration
// types (DynamicImport, LogInkRuntime) stay in inkRuntime.ts since they're
// only needed by startInkInteractiveLog.

import type { LogInkComponentDeps, LogInkContext } from './types'
import type { LogArgv } from '../../commands/log/config'

// Promoted-list filter helpers shared by every promoted surface. Live in
// runtime/ rather than chrome/ because they're tightly coupled to the
// LogInkState filter-mode shape.
import { matchesPromotedFilter } from '../runtime/promotedFilter'

// Chrome + overlay + dispatcher renderers extracted in phase 5a.7. The
// per-surface and detail renderers are consumed internally by mainPanel /
// detailPanel; LogInkApp just calls these top-level pieces.
import { renderFooter } from '../runtime/footer'
import { renderHeader } from '../runtime/header'
import { renderSidebar } from '../runtime/sidebar'
import { renderMainPanel } from '../runtime/mainPanel'
import { renderDetailPanel } from '../runtime/detailPanel'
import { renderOnboardingOverlay } from '../runtime/overlays'



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
  const { appLabel, clipboardRunner, git, idleTipsEnabled, ink, initialView, loadRows, logArgv, React, resumeRef, rows, theme } = deps
  const { Box, Text, useApp, useInput, useWindowSize } = ink
  const h = React.createElement
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
  const [context, setContext] = React.useState<LogInkContext>({})
  const [contextStatus, setContextStatus] = React.useState<LogInkContextStatus>(() => {
    // Boot starts every fetched key in 'loading' so the surfaces show
    // their loading hints immediately. `pullRequest` is the exception
    // (#808) — it isn't part of the boot fetch entries; it lazy-loads
    // when the user enters the PR view. Marking it 'idle' avoids a
    // permanent "loading" flag in the chrome and lets the dedicated
    // PR view's own load effect drive its loading state.
    return updateLogInkContextStatus(
      createLogInkContextStatus('loading'),
      'pullRequest',
      'idle'
    )
  })
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
    Boolean(state.statusLoading)
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
        dispatch({ type: 'setStatus', value: `Failed to load commits: ${message}` })
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

  const refreshContext = React.useCallback(async (options: { silent?: boolean } = {}) => {
    // Loud refresh (manual `r`): flip everything to 'loading' so the user
    // sees the surfaces clear, then settle to 'ready' on completion.
    // Silent refresh (fs.watch trigger): keep the existing data on screen
    // (stale-while-revalidate) and quietly swap it in once the new fetch
    // resolves — avoids the every-second flicker the watcher would
    // otherwise produce on busy repos.
    if (!options.silent) {
      dispatch({ type: 'setStatus', value: 'refreshing repository context' })
      setContextStatus(createLogInkContextStatus('loading'))
    }
    const next = await loadLogInkContext(git)
    setContext(next)
    setContextStatus(createLogInkContextStatus('ready'))
    if (!options.silent) {
      dispatch({ type: 'setStatus', value: 'repository context refreshed' })
    }
  }, [dispatch, git])

  const refreshWorktreeContext = React.useCallback(async (options: { silent?: boolean } = {}) => {
    if (!options.silent) {
      setContextStatus((current) => updateLogInkContextStatus(current, 'worktree', 'loading'))
    }
    const worktree = await safe(getWorktreeOverview(git))

    setContext((current) => ({
      ...current,
      worktree,
    }))
    setContextStatus((current) => updateLogInkContextStatus(current, 'worktree', 'ready'))
  }, [git])

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

  React.useEffect(() => {
    const repoRoot = repoRootRef.current
    if (!repoRoot) return
    saveSidebarTab(repoRoot, state.userSidebarTab)
  }, [state.userSidebarTab])

  React.useEffect(() => {
    const repoRoot = repoRootRef.current
    if (!repoRoot) return
    saveDiffViewMode(repoRoot, state.diffViewMode)
  }, [state.diffViewMode])

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

  React.useEffect(() => {
    let active = true

    loadLogInkContextEntries(git).forEach(({ key, load }) => {
      void load().then((value) => {
        if (!active) {
          return
        }

        setContext((current) => ({
          ...current,
          [key]: value,
        }))
        setContextStatus((current) => updateLogInkContextStatus(current, key, 'ready'))
      })
    })

    return () => {
      active = false
    }
  }, [git])

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
    let active = true
    setContextStatus((current) => updateLogInkContextStatus(current, 'pullRequest', 'loading'))
    void safe(getPullRequestOverview(git)).then((value) => {
      if (!active) return
      setContext((current) => ({
        ...current,
        pullRequest: value,
      }))
      setContextStatus((current) => updateLogInkContextStatus(current, 'pullRequest', 'ready'))
    })
    return () => {
      active = false
    }
  }, [git, state.activeView, context.pullRequest])

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
  React.useEffect(() => {
    const onBranchTab = state.activeView === 'branches' ||
      (state.focus === 'sidebar' && state.sidebarTab === 'branches')
    const onTagTab = state.activeView === 'tags' ||
      (state.focus === 'sidebar' && state.sidebarTab === 'tags')
    if (!onBranchTab && !onTagTab) return

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
    }

    if (!targetHash) return
    // Skip the dispatch + status churn when the cursor hasn't
    // actually changed which commit it's targeting (the case for
    // rapid navigation through a cluster of branches that all point
    // at the same commit). Without this guard the user sees a stream
    // of "Synced history to <branch> tip" status messages even
    // though the history cursor never moved.
    if (targetHash === lastSyncedHashRef.current) return

    const loaded = state.filteredCommits.some((commit) =>
      commit.hash === targetHash || commit.shortHash === targetHash
    )
    if (loaded) {
      lastSyncedHashRef.current = targetHash
      dispatch({ type: 'selectCommitByHash', hash: targetHash })
      // Confirmation status message so the user gets feedback even
      // when the dedicated branches / tags view is occupying the
      // main panel and the history cursor moves invisibly behind it.
      dispatch({
        type: 'setStatus',
        value: `Synced history to ${targetLabel} tip`,
      })
    } else {
      dispatch({
        type: 'setStatus',
        value: `${targetLabel} tip not in loaded window — press \\ for full graph or Ctrl+L to load more`,
      })
    }
  }, [
    dispatch, context.branches, context.tags,
    state.activeView, state.focus, state.sidebarTab,
    state.selectedBranchIndex, state.selectedTagIndex,
    state.branchSort, state.tagSort, state.filter,
    state.filteredCommits,
  ])

  // Reset the dedup ref when the user moves focus away from the
  // sidebar branches / tags tab so re-entering re-fires the sync
  // even if the cursored branch is the same as before.
  React.useEffect(() => {
    const onBranchTab = state.activeView === 'branches' ||
      (state.focus === 'sidebar' && state.sidebarTab === 'branches')
    const onTagTab = state.activeView === 'tags' ||
      (state.focus === 'sidebar' && state.sidebarTab === 'tags')
    if (!onBranchTab && !onTagTab) {
      lastSyncedHashRef.current = undefined
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

  const toggleSelectedFileStage = React.useCallback(async () => {
    if (!selectedWorktreeFile) {
      dispatch({ type: 'setStatus', value: 'no worktree file selected' })
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
      dispatch({ type: 'setStatus', value: 'no hunk selected' })
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
      })
      await refreshWorktreeContext()
      setWorktreeDiff(undefined)
      setWorktreeHunks(undefined)
    } catch (error) {
      dispatch({
        type: 'setStatus',
        value: (error as Error).message || 'failed to update hunk stage state',
      })
    }
  }, [dispatch, git, refreshWorktreeContext, state.selectedWorktreeHunkIndex, worktreeHunks])

  const revertSelectedFile = React.useCallback(async () => {
    if (!selectedWorktreeFile) {
      dispatch({ type: 'setStatus', value: 'no worktree file selected' })
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
      dispatch({ type: 'setStatus', value: 'no hunk selected' })
      return
    }

    dispatch({ type: 'setStatus', value: 'reverting selected hunk' })
    try {
      await revertHunk(git, selectedHunk)
      dispatch({ type: 'setStatus', value: `Reverted hunk in ${selectedHunk.filePath}` })
      await refreshWorktreeContext()
      setWorktreeDiff(undefined)
      setWorktreeHunks(undefined)
    } catch (error) {
      dispatch({
        type: 'setStatus',
        value: (error as Error).message || 'failed to revert hunk',
      })
    }
  }, [dispatch, git, refreshWorktreeContext, state.selectedWorktreeHunkIndex, worktreeHunks])

  const createCommitFromCompose = React.useCallback(async () => {
    const stagedCount = context.worktree?.stagedCount || 0

    if (!stagedCount) {
      dispatch({ type: 'setStatus', value: 'stage changes before committing' })
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
      await refreshWorktreeContext()
    }
  }, [
    context.worktree?.stagedCount,
    dispatch,
    git,
    refreshWorktreeContext,
    state.commitCompose.body,
    state.commitCompose.summary,
  ])

  const runAiCommitDraft = React.useCallback(async () => {
    dispatch({ type: 'commitCompose', action: { type: 'setLoading', value: true } })
    dispatch({ type: 'setStatus', value: 'generating AI commit draft', loading: true })
    const result = await runCommitDraftWorkflow()

    if (result.ok && result.draft) {
      dispatch({ type: 'commitCompose', action: { type: 'setDraft', value: result.draft } })
      dispatch({ type: 'setStatus', value: 'AI draft ready for editing' })
      return
    }

    dispatch({
      type: 'commitCompose',
      action: { type: 'setResult', message: result.message, details: result.details },
    })
    dispatch({ type: 'setStatus', value: result.message })
  }, [dispatch])

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
  const startCreatePullRequest = React.useCallback(async () => {
    const head = context.branches?.currentBranch || context.provider?.currentBranch
    if (!head) {
      dispatch({ type: 'setStatus', value: 'No current branch to create a PR from.' })
      return
    }
    const defaultBranch = context.provider?.repository.defaultBranch
    if (!defaultBranch) {
      dispatch({
        type: 'setStatus',
        value: 'No default branch detected. Set origin/HEAD or ensure main/master exists locally.',
      })
      return
    }
    if (head === defaultBranch) {
      dispatch({ type: 'setStatus', value: `Current branch is ${defaultBranch}; check out a feature branch first.` })
      return
    }
    if (context.pullRequest?.currentPullRequest || context.provider?.currentPullRequest) {
      const existing = context.pullRequest?.currentPullRequest || context.provider?.currentPullRequest
      dispatch({
        type: 'setStatus',
        value: existing
          ? `PR #${existing.number} already open for ${head}. Use the PR view to manage it.`
          : `A pull request is already open for ${head}.`,
      })
      return
    }

    dispatch({
      type: 'setStatus',
      value: `generating PR body from changelog (vs ${defaultBranch})…`,
      loading: true,
    })
    const body = await runPullRequestBodyWorkflow({ baseBranch: defaultBranch })

    // Fallback shape when the changelog generation fails — open the
    // prompt with empty title + body rather than aborting, so the user
    // can still author the PR manually. The status line surfaces why
    // we couldn't pre-fill.
    const initialTitle = body.title || head.replace(/^(feat|fix|chore|docs|refactor|test)\//, '').replace(/[-_]/g, ' ')
    const initialBody = body.body || ''
    const initial = initialBody ? `${initialTitle}\n\n${initialBody}` : initialTitle

    if (!body.ok) {
      dispatch({ type: 'setStatus', value: `PR body generation failed: ${body.message}. Edit manually.` })
    } else {
      dispatch({ type: 'setStatus', value: 'PR body drafted — review and Ctrl+D to submit.' })
    }

    dispatch({
      type: 'openInputPrompt',
      kind: 'create-pr',
      label: `Create PR: ${head} → ${defaultBranch}  (line 1 title · rest body · Enter newline · Ctrl+D submit)`,
      initial,
      multiline: true,
    })
  }, [
    context.branches?.currentBranch,
    context.provider?.currentBranch,
    context.provider?.currentPullRequest,
    context.provider?.repository.defaultBranch,
    context.pullRequest?.currentPullRequest,
    dispatch,
  ])

  // Copy an arbitrary string to the system clipboard. Distinct from
  // `yankFromActiveView` which derives the value from the current view
  // — this one takes the value as an explicit event payload, used by
  // the changelog view's `y` keystroke (and a candidate for future
  // "copy this" surfaces). Surfaces a status confirming what landed
  // in clipboard.
  const yankText = React.useCallback(async (value: string, label: string) => {
    const clipboard: ClipboardRunner = clipboardRunner || defaultClipboardRunner
    if (!value) {
      dispatch({ type: 'setStatus', value: `Nothing to copy — ${label} is empty.` })
      return
    }
    try {
      await clipboard(value)
      dispatch({ type: 'setStatus', value: `Copied ${label} to clipboard.` })
    } catch (error) {
      dispatch({
        type: 'setStatus',
        value: `Copy failed (${label}): ${(error as Error).message}`,
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
      dispatch({ type: 'setStatus', value: 'No current branch — check out a branch first.' })
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
      dispatch({ type: 'setStatus', value: `Changelog failed: ${result.message}` })
      return
    }

    dispatch({
      type: 'setChangelogReady',
      branch: head,
      baseLabel,
      text: result.text,
    })
    dispatch({
      type: 'setStatus',
      value: 'Changelog ready — y yank · E $EDITOR · c PR · r regen · < back.',
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
      dispatch({ type: 'setStatus', value: 'No changelog text to copy.' })
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
      dispatch({ type: 'setStatus', value: 'Changelog not loaded yet — wait for generation.' })
      return
    }

    let dir: string | undefined
    try {
      dir = mkdtempSync(nodePath.join(tmpdir(), 'coco-changelog-'))
    } catch (error) {
      dispatch({
        type: 'setStatus',
        value: `Failed to create temp file for editor: ${(error as Error).message}`,
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
        dispatch({ type: 'setStatus', value: `Failed to launch ${editor}: ${result.error.message}` })
      } else if (result.signal) {
        dispatch({ type: 'setStatus', value: `${editor} interrupted by ${result.signal}` })
      } else if (typeof result.status === 'number' && result.status !== 0) {
        dispatch({ type: 'setStatus', value: `${editor} exited with status ${result.status}` })
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
        dispatch({ type: 'setChangelogText', text: content })
        dispatch({ type: 'setStatus', value: 'Changelog updated from editor.' })
      } catch (error) {
        dispatch({
          type: 'setStatus',
          value: `Failed to read back edited changelog: ${(error as Error).message}`,
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
        dispatch({ type: 'setStatus', value: `Failed to launch ${editor}: ${result.error.message}` })
      } else if (result.signal) {
        // Editor was killed by a signal (e.g. ^C, SIGTERM). status is
        // null in this case, so the old `status !== 0` check would
        // mistakenly fall through to the success branch.
        dispatch({ type: 'setStatus', value: `${editor} interrupted by ${result.signal}` })
      } else if (typeof result.status === 'number' && result.status !== 0) {
        dispatch({ type: 'setStatus', value: `${editor} exited with status ${result.status}` })
      } else {
        dispatch({ type: 'setStatus', value: `Edited ${path}` })
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
        dispatch({ type: 'setStatus', value: `Failed to launch ${editor}: ${result.error.message}` })
      } else if (result.signal) {
        dispatch({ type: 'setStatus', value: `${editor} interrupted by ${result.signal}` })
      } else if (typeof result.status === 'number' && result.status !== 0) {
        dispatch({ type: 'setStatus', value: `${editor} exited with status ${result.status}` })
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
        dispatch({ type: 'setStatus', value: 'Commit draft updated from editor.' })
      } catch (error) {
        dispatch({
          type: 'setStatus',
          value: `Failed to read back edited draft: ${(error as Error).message}`,
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
    })
    dispatch({
      type: 'setStatus',
      value: `Split plan ready: ${result.plan.groups.length} commit(s). y/Enter to apply, Esc to cancel.`,
      kind: 'success',
    })
  }, [context.operation, context.worktree?.stagedCount, dispatch, git])

  // `y`/Enter inside the overlay — apply the previewed plan. Uses the
  // plan + planContext from state (set by setSplitPlanReady) so the
  // executed split matches what the user reviewed exactly. No LLM
  // re-roll, no plan drift.
  const applyCommitSplit = React.useCallback(async () => {
    const splitPlan = state.splitPlan
    if (!splitPlan?.plan || !splitPlan.planContext) {
      dispatch({ type: 'setStatus', value: 'No split plan loaded yet — wait for generation.' })
      return
    }

    // Capture HEAD before the apply so we can compute exactly which
    // commits the operation created (rev-list headBefore..HEAD after
    // success). Best-effort — if revparse fails we skip the
    // newest-commits marker, no degradation of the apply itself.
    const headBefore = await git.revparse(['HEAD']).then((sha) => sha.trim()).catch(() => undefined)

    dispatch({ type: 'setSplitPlanApplying' })
    dispatch({ type: 'setStatus', value: 'Applying split plan…', loading: true })

    const result = await runCommitSplitApplyWorkflow({
      plan: splitPlan.plan,
      planContext: splitPlan.planContext,
      git,
    })

    if (!result.ok) {
      // Keep the overlay open so the user can see what happened and
      // try again. setSplitPlanError preserves the existing plan in
      // 'ready' state with the error annotation.
      dispatch({ type: 'setSplitPlanError', error: result.message })
      dispatch({
        type: 'setStatus',
        value: `Split apply failed: ${result.message}`,
        kind: 'error',
      })
      return
    }

    // Success — close the overlay, reset compose (the staged set is
    // now empty since the plan committed everything), and pop the
    // compose view so the user lands on whatever was beneath (usually
    // status, sometimes history).
    dispatch({ type: 'clearSplitPlan' })
    dispatch({ type: 'commitCompose', action: { type: 'reset' } })
    // Only pop if compose is on top — the apply could have been
    // invoked from a deeper stack and we don't want to over-pop.
    if (state.activeView === 'compose' && state.viewStack.length > 1) {
      dispatch({ type: 'popView' })
    }

    // Refresh BEFORE setting the final status so we can peek at the
    // post-apply worktree state and craft a directive next-step hint
    // ("X unstaged + Y untracked remaining — press gs to stage / I
    // to draft / …"). An empty success message reads as a dead end;
    // a next-step hint keeps momentum.
    await refreshWorktreeContext()
    await refreshContext()

    // Best-effort peek at the fresh worktree counts. If the second
    // load fails we just fall back to the bare success message — no
    // reason to noisily surface a status-line lookup error after a
    // genuine success.
    const fresh = await getWorktreeOverview(git).catch(() => undefined)
    const unstaged = fresh?.unstagedCount || 0
    const untracked = fresh?.untrackedCount || 0

    // Compute the freshly-created commit hashes and mark them so the
    // history surface renders them with a "new" indicator. Auto-
    // clears after 5s so the marker doesn't linger across later
    // operations. Best-effort — a rev-list failure (e.g. headBefore
    // capture failed earlier) just skips the marker, no impact on
    // the apply itself. The count from this rev-list also drives
    // the success message — counting hashes is more accurate than
    // parsing the workflow's string result.
    let commitCount = 0
    if (headBefore) {
      try {
        const range = `${headBefore}..HEAD`
        const raw = await git.raw(['rev-list', range])
        const hashes = raw.split('\n').map((line) => line.trim()).filter(Boolean)
        commitCount = hashes.length
        if (hashes.length > 0) {
          dispatch({ type: 'markRecentCommits', hashes })
          // DevSkim: ignore DS172411 — function literal, fixed delay,
          // no caller-supplied data flowing through.
          setTimeout(() => dispatch({ type: 'clearRecentCommits' }), 5000)
        }
      } catch { /* ignore — marker is a nice-to-have, not load-bearing */ }
    }

    // Fall back to parsing the workflow result message ("Created N
    // split commit(s).") if the rev-list path didn't yield a count.
    if (commitCount === 0 && result.message) {
      const match = result.message.match(/^Created (\d+)/)
      if (match) commitCount = parseInt(match[1], 10) || 0
    }

    // Compose the success message with explicit nav cue (where to
    // see the commits) + remaining-work hint. Closes the loop on the
    // "what should I expect to see?" confusion from manual testing.
    const successMessage = commitCount > 0
      ? formatSplitApplySuccess(commitCount, unstaged, untracked)
      : (result.message || 'Applied split plan.')

    dispatch({ type: 'setStatus', value: successMessage, kind: 'success' })
  }, [dispatch, git, refreshContext, refreshWorktreeContext, state.activeView, state.splitPlan, state.viewStack.length])

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
        return dropStash(git, stash)
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
      'pop-stash': async () => {
        const all = context.stashes?.stashes || []
        const visible = state.filter
          ? all.filter((s) => matchesPromotedFilter([s.ref, s.message], state.filter))
          : all
        const stash = visible[Math.min(state.selectedStashIndex, visible.length - 1)]
        if (!stash) return { ok: false, message: 'No stash selected' }
        return popStash(git, stash)
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
        const message = payload?.trim()
        if (!message) return { ok: false, message: 'Stash message required' }
        return createStash(git, message)
      },
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
    }
    const handler = handlers[id]
    if (!handler) {
      dispatch({ type: 'setStatus', value: `Workflow action ${id} not yet wired` })
      return
    }
    const result = await handler()
    dispatch({ type: 'setStatus', value: result?.message || 'Workflow action complete' })
    // Checkout-branch is the one workflow where we want a *visible*
    // refresh so the user sees the branches sidebar repaint with the
    // new current branch (per #806 follow-up). Snap the cursor to
    // position 0 first so when the refresh completes and the new
    // current branch lands at the top (per #809's pin-current rule),
    // the cursor is already there waiting.
    if (id === 'checkout-branch' && result?.ok) {
      dispatch({ type: 'resetBranchSelection' })
      await refreshContext()
    } else {
      // Silent refresh so the deleted item disappears from the list
      // without flickering the surfaces through a 'loading' phase.
      await refreshContext({ silent: true })
    }
  }, [context, dispatch, git, refreshContext, state.branchSort, state.filter, state.selectedBranchIndex,
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
      dispatch({ type: 'setStatus', value: 'Nothing to yank in this view' })
      return
    }

    try {
      await clipboard(value)
      dispatch({ type: 'setStatus', value: `Copied ${label}` })
    } catch (error) {
      dispatch({ type: 'setStatus', value: `Copy failed: ${(error as Error).message}` })
    }
  }, [
    clipboardRunner,
    context.bisect,
    context.branches,
    context.stashes,
    context.submodules,
    context.tags,
    dispatch,
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

  React.useEffect(() => {
    const remaining = state.filteredCommits.length - state.selectedIndex - 1

    async function loadMoreCommits(): Promise<void> {
      if (!logArgv || logArgv.limit || loadingMoreCommitsRef.current || !hasMoreCommits) {
        return
      }

      if (state.filteredCommits.length === 0 || remaining > 20) {
        return
      }

      loadingMoreCommitsRef.current = true
      const requestId = loadMoreRequestRef.current + 1
      loadMoreRequestRef.current = requestId
      setLoadingMoreCommits(true)
      dispatch({ type: 'setStatus', value: 'loading older commits' })
      const fetchArgs = state.historyFetchArgs
      const mergedArgv: LogArgv = {
        ...logArgv,
        ...(fetchArgs?.author ? { author: fetchArgs.author } : {}),
        ...(fetchArgs?.path ? { path: fetchArgs.path } : {}),
      }
      const nextRows = await safe(
        getLogRows(git, mergedArgv, {
          limit: LOG_INTERACTIVE_DEFAULT_LIMIT,
          skip: state.commits.length,
        })
      )

      if (!mountedRef.current || loadMoreRequestRef.current !== requestId) {
        return
      }

      loadingMoreCommitsRef.current = false
      setLoadingMoreCommits(false)

      const nextCommitCount = nextRows ? getCommitRows(nextRows).length : 0

      if (!nextRows) {
        dispatch({ type: 'setStatus', value: 'failed to load older commits' })
        return
      }

      if (nextRows?.length) {
        dispatch({ type: 'appendRows', rows: nextRows })
      }

      setHasMoreCommits(nextCommitCount >= LOG_INTERACTIVE_DEFAULT_LIMIT)
      dispatch({
        type: 'setStatus',
        value: nextCommitCount
          ? `loaded ${nextCommitCount} older commits`
          : 'end of history',
      })
    }

    void loadMoreCommits()
  }, [
    dispatch,
    git,
    hasMoreCommits,
    loadingMoreCommits,
    logArgv,
    state.commits.length,
    state.filteredCommits.length,
    state.historyFetchArgs,
    state.selectedIndex,
  ])

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
      const nextRows = await safe(getLogRows(git, merged, { limit: LOG_INTERACTIVE_DEFAULT_LIMIT }))
      if (!mountedRef.current || historyFetchRequestRef.current !== requestId) {
        return
      }
      if (!nextRows) {
        dispatch({ type: 'setStatus', value: 'Failed to refetch with active filter' })
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
      const nextRows = await safe(getLogRows(git, merged, { limit: LOG_INTERACTIVE_DEFAULT_LIMIT }))
      if (!mountedRef.current || toggleGraphRequestRef.current !== requestId) {
        return
      }
      if (!nextRows) {
        dispatch({ type: 'setStatus', value: 'Failed to refetch graph rows' })
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
          if ((group.hunks?.length || 0) > 0) lines += group.hunks.length + 1
          return sum + lines
        }, 0)
        : undefined,
    }).forEach((event) => {
      if (event.type === 'exit') {
        exit()
      } else if (event.type === 'refreshContext') {
        void refreshContext()
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
      } else if (event.type === 'startCreatePullRequest') {
        void startCreatePullRequest()
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
      } else if (event.type === 'yankFromActiveView') {
        void yankFromActiveView(event.short)
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

  // Layout depends on focus (sidebar grows when focused), so it's
  // computed here — after state is in scope but before the render path.
  const layout = getLogInkLayout({
    columns: windowSize.columns || process.stdout.columns || LOG_INK_DEFAULT_COLUMNS,
    rows: windowSize.rows || process.stdout.rows || LOG_INK_DEFAULT_ROWS,
    sidebarFocused: state.focus === 'sidebar',
    inspectorFocused: state.focus === 'detail',
    helpOverlayActive: state.showHelp,
  })

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

  return h(Box, { flexDirection: 'column', height: layout.rows },
    renderHeader(h, { Box, Text }, state, context, contextStatus, layout.columns, theme, appLabel),
    h(Box, { flexDirection: 'row', height: layout.bodyRows },
      renderSidebar(h, { Box, Text }, state, context, contextStatus, layout.sidebarWidth, layout.bodyRows, theme),
      renderMainPanel(
        h,
        { Box, Text },
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
        bisectCandidateDetail,
        bisectCandidateLoading,
        layout.bodyRows,
        layout.mainPanelWidth,
        theme,
        hasMoreCommits,
        loadingMoreCommits,
        spinnerFrame
      ),
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
        theme
      )
    ),
    renderFooter(h, { Box, Text }, state, context, theme, idleTip, spinnerFrame)
  )
}

