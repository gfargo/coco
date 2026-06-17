/**
 * `LogInkApp` — the workstation's root React component. Hosts all state
 * via `useState`/`useEffect`/`useMemo`/`useCallback` hooks; wires up the
 * input handler, refresh watcher, persistence layers, idle-tip cycle,
 * and per-context loaders; assembles the header / sidebar / main /
 * detail / footer chrome from the runtime modules.
 *
 * The entry point (`startInkInteractiveLog`) and the orchestration
 * helpers (`loadLogInkContext`, `loadInkRuntime`, `safe`) stay in
 * `src/workstation/runtime/inkRuntime.ts` — they're the boot sequence, not the
 * component itself.
 *
 * Extracted from `src/workstation/runtime/inkRuntime.ts` as part of phase 5b
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

import type * as ReactTypes from 'react'
import {SimpleGit} from 'simple-git'
import {getBranchOverview} from '../../git/branchData'
import {getLfsAttributeStatus} from '../../git/lfsAttributes'
import {getSubmoduleOverview} from '../../git/submoduleData'
import {getRemoteOverview} from '../../git/remoteData'
import {LOG_INTERACTIVE_DEFAULT_LIMIT, buildToggleGraphArgs, getCommitRows, getLogRows} from '../../commands/log/data'
import {LogInkContextKey, createLogInkContextStatus, updateLogInkContextStatus} from '../chrome/context'
import {createLogInkTheme, type LogInkThemePreset} from '../chrome/theme'
import {saveThemePreset} from '../chrome/themePersistence'
import {PromotedSelectionsSnapshot, rectifyPromotedSelectionIndex} from '../chrome/selectionRectify'
import {LOG_INK_DEFAULT_COLUMNS, LOG_INK_DEFAULT_ROWS, LOG_INK_MIN_COLUMNS, LOG_INK_MIN_ROWS, getLogInkLayout} from '../chrome/layout'
import type { LogInkVisiblePane } from '../chrome/layout'
import {LogInkState, applyLogInkAction, createLogInkState, getSelectedInkCommit, getThemePickerSelection} from '../../workstation/runtime/inkViewModel'
import {getGitOperationOverview} from '../../git/operationData'
import {getProviderOverview} from '../../git/providerData'
import {getForgeActions, getForgePullRequestOverview} from '../../git/forgeActions'
import {issueFilterForPreset, pullRequestFilterForPreset} from '../../git/triageFilterPresets'
import {getStashCommitHashes, getStashOverview} from '../../git/stashData'
import {getWorktreeOverview} from '../../git/statusData'
import {getBisectStatus} from '../../git/bisectData'
import {getReflogOverview} from '../../git/reflogData'
import {getTagOverview} from '../../git/tagData'
import {getWorktreeListOverview} from '../../git/worktreeData'


async function safe<T>(promise: Promise<T>): Promise<T | undefined> {
  try {
    return await promise
  } catch {
    return undefined
  }
}

async function loadLogInkContext(git: SimpleGit): Promise<LogInkContext> {
  const [branches, pullRequest, tags, worktree, stashes, worktreeList, operation, provider, reflog, bisect, lfs, submodules, remotes] =
    await Promise.all([
      safe(getBranchOverview(git)),
      safe(getForgePullRequestOverview(git)),
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
      safe(getRemoteOverview(git)),
    ])

  return {
    bisect,
    branches,
    lfs,
    operation,
    provider,
    pullRequest,
    reflog,
    remotes,
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
      key: 'remotes',
      load: () => safe(getRemoteOverview(git)),
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
import {matchesPromotedFilter} from '../runtime/promotedFilter'
import {useFilteredLists} from './hooks/buildFilteredLists'
import {useBisectCandidateHydration, useBisectCandidateState} from './hooks/useBisectCandidateHydration'
import {useCommitDetailHydration, useCommitDetailState} from './hooks/useCommitDetailHydration'
import {useContextHydration} from './hooks/useContextHydration'
import {useBlameLoadingState, useDetailHydration} from './hooks/useDetailHydration'
import {useCommitFilePreviewHydration, useCommitFilePreviewState, useCompareDiffHydration, useCompareDiffState, useStashDiffHydration, useStashDiffState, useWorktreeDiffHydration, useWorktreeDiffState, useWorktreeHunksHydration, useWorktreeHunksState} from './hooks/useDiffHydration'
import {useDiffSyntaxHighlight, useDiffSyntaxState} from './hooks/useDiffSyntaxHighlight'
import {useIdleTip} from './hooks/useIdleTip'
import {useRefreshWatcher} from './hooks/useRefreshWatcher'
import {useActiveRepoRoot, useViewModePersistence} from './hooks/useRepoPersistence'
import {useSpinnerFrame} from './hooks/useSpinnerFrame'
import {useStatusSurfaceData} from './hooks/buildStatusSurfaceData'
import {useStatusAutoDismiss} from './hooks/useStatusAutoDismiss'
import {useHistoryCursorSync} from './hooks/useHistoryCursorSync'
import {useHistoryPaginationState, useLoadMoreHistory} from './hooks/useLoadMoreHistory'
import {useOnboarding} from './hooks/useOnboarding'
import {useRepoStackRuntimes} from './hooks/useRepoStackRuntimes'
import {useResumeTick} from './hooks/useResumeTick'
import {useWorktreeStageActions} from './hooks/useWorktreeStageActions'
import {useCommitComposeActions} from './hooks/useCommitComposeActions'
import {useCommitSplitActions} from './hooks/useCommitSplitActions'
import {useAiCommitDraftActions} from './hooks/useAiCommitDraftActions'
import {usePullRequestActions} from './hooks/usePullRequestActions'
import {useEditorActions} from './hooks/useEditorActions'
import {useYankActions} from './hooks/useYankActions'
import {useChangelogActions} from './hooks/useChangelogActions'
import {useWorkflowAction} from './hooks/useWorkflowAction'
import {useInputHandler} from './hooks/useInputHandler'

// Chrome + overlay + dispatcher renderers extracted in phase 5a.7. The
// per-surface and detail renderers are consumed internally by mainPanel /
// detailPanel; LogInkApp just calls these top-level pieces.
import {renderFooter} from '../runtime/footer'
import {createLogInkHeader} from '../runtime/header'
import {renderSidebar} from '../runtime/sidebar'
import {renderMainPanel} from '../runtime/mainPanel'
import {renderDetailPanel} from '../runtime/detailPanel'
import {renderOnboardingOverlay} from '../runtime/overlays'
import {getLogInkRuntimeContext, type LogInkRuntimeContextValue} from '../runtime/runtimeContext'

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
  // Resume-repaint tick (SIGCONT → `fg`), owned by `useResumeTick` (app.ts
  // decomposition item 5 / #1237). The throwaway `useState` and its effect are
  // adjacent, so they move together into the hook at this exact slot; the
  // effect wires `resumeRef.current` to a tick-bump that forces a repaint.
  useResumeTick(React, {resumeRef})
  // First-launch onboarding (P1.3). Persisted via a marker file in the
  // user's cache dir so the tip never reappears once dismissed. Lazy
  // initializer so the fs check only runs on mount, not every render.
  // First-run onboarding overlay, owned by `useOnboarding` (app.ts
  // decomposition item 4 / #1237). The hook seeds `showOnboarding` from
  // `!hasSeenOnboarding()` and returns `dismissOnboarding`, which clears the
  // overlay and writes the seen-marker; the input handler calls it on the
  // first keystroke.
  const {showOnboarding, dismissOnboarding} = useOnboarding(React)
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
  // Repo-stack runtimes (#931 / #994), owned by `useRepoStackRuntimes` (app.ts
  // decomposition item 6 / #1237). The contiguous cluster — the `runtimes`
  // `useState`, the push/pop sync effect, the active-frame `git` / `context` /
  // `contextStatus` projection, and the frame-tagged `setContext` /
  // `setContextStatus` writers — moves wholesale into the hook at this exact
  // slot, preserving React hook order. Every downstream consumer reads the same
  // returned names, so nothing else changes. See the hook's header.
  const {
    runtimes,
    git,
    context,
    contextStatus,
    setContext,
    setContextStatus,
  } = useRepoStackRuntimes(React, {rootGit, repoStack: state.repoStack})
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
  const activeRepoRoot = useActiveRepoRoot(React, git)
  // Commit-detail hydration state, lifted into `useCommitDetailState`
  // (app.ts decomposition item 1a / #1237). The `useState` pair stays in this
  // exact slot; the loader effect that toggles it is issued ~600 lines below
  // by `useCommitDetailHydration`, in its original position — a two-hook
  // split to preserve React hook ordering. See that module's header.
  const {detail, setDetail, detailLoading, setDetailLoading} = useCommitDetailState(React)
  // Commit file-preview hydration state, lifted into `useCommitFilePreviewState`
  // (app.ts decomposition item 2 / #1237). The `useState` pair stays in this
  // exact slot; the loader effect that toggles it is issued ~900 lines below by
  // `useCommitFilePreviewHydration`, in its original position — a two-hook split
  // to preserve React hook ordering. See `useDiffHydration`'s header.
  const {filePreview, setFilePreview, filePreviewLoading, setFilePreviewLoading} = useCommitFilePreviewState(React)
  // Worktree diff / hunks hydration state, owned by `useWorktreeDiffState` /
  // `useWorktreeHunksState` (app.ts decomposition #1237). The `setWorktreeDiff`
  // / `setWorktreeHunks` setters are shared with the staging callbacks
  // (`useWorktreeStageActions`), so the hooks own the slots and hand the values
  // + setters back here; the consumer call sites are unchanged. See
  // `useDiffHydration`'s header.
  const {worktreeDiff, setWorktreeDiff, worktreeDiffLoading, setWorktreeDiffLoading} = useWorktreeDiffState(React)
  const {worktreeHunks, setWorktreeHunks, worktreeHunksLoading, setWorktreeHunksLoading} = useWorktreeHunksState(React)
  // Syntax-highlight spans for the diff currently in view (#1117
  // follow-up). Owned by `useDiffSyntaxState` (app.ts decomposition item 2 /
  // #1237); the `useState` stays in this exact slot while the effect that
  // computes the spans is issued ~600 lines below by `useDiffSyntaxHighlight`,
  // in its original position — a two-hook split to preserve hook ordering.
  // `undefined` = no highlighting (renders plain).
  const {diffSyntaxSpans, setDiffSyntaxSpans} = useDiffSyntaxState(React)
  // Stash diff explorer (Enter on a stash row): the runtime fetches
  // `git stash show -p <ref>` lazily once the diff view becomes active
  // with diffSource='stash'. Lines are stored as a flat string[] —
  // renderDiffSurface paints each line through diffLineProps so +/-
  // colors match the commit-diff path.
  const {stashDiffLines, setStashDiffLines, stashDiffLoading, setStashDiffLoading} = useStashDiffState(React)
  // #779 — compare-two-refs diff state. Loaded lazily when the diff
  // view becomes active with `diffSource === 'compare'`.
  const {compareDiffLines, setCompareDiffLines, compareDiffLoading, setCompareDiffLoading} = useCompareDiffState(React)
  // Load-more pagination state, owned by `useHistoryPaginationState` (app.ts
  // decomposition item 3 / #1237). The `useState` pair stays in this exact
  // slot; the setters are shared (the loader `useLoadMoreHistory` below plus
  // the history-filter / graph-toggle effects all write them), so the hook
  // owns the slots and hands values + setters back here. The lazy seed for
  // `hasMoreCommits` is preserved verbatim inside the hook.
  const {
    hasMoreCommits,
    setHasMoreCommits,
    loadingMoreCommits,
    setLoadingMoreCommits,
  } = useHistoryPaginationState(React, {logArgv, rows})
  const loadingMoreCommitsRef = React.useRef(false)
  const loadMoreRequestRef = React.useRef(0)
  const mountedRef = React.useRef(true)

  // P4.3 — idle tip rotation. Extracted into `useIdleTip` (0.72 app.ts
  // decomposition). The hook issues the `useState` tick counter then the
  // timer `useEffect` in the same order and with the same dep array the
  // inline cluster used, so React hook ordering and the grace/cadence +
  // reset-on-statusMessage timer semantics are unchanged; it returns the
  // gated `idleTip` (tips enabled, no active statusMessage) via the same
  // `pickIdleTip` provider argument.
  const idleTip = useIdleTip(React, {
    idleTipsEnabled,
    statusMessage: state.statusMessage,
    provider: context.provider?.repository.provider,
  })

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
  const spinnerFrame = useSpinnerFrame(React, {
    splitPlanStatus: state.splitPlan?.status,
    changelogStatus: state.changelogView.status,
    commitComposeLoading: state.commitCompose.loading,
    remoteOp: state.remoteOp,
    statusLoading: state.statusLoading,
    pendingItemAction: state.pendingItemAction,
  })

  const selected = getSelectedInkCommit(state)
  const selectedDetailFile = detail?.files[state.selectedFileIndex]
  // Status-surface derived data (#776 / #791 / #808). Extracted into
  // `useStatusSurfaceData` (0.72 app.ts decomposition). The hook issues
  // one `React.useMemo` per value in the same order — and with the same
  // per-value dependency arrays — these memos used to, delegating to the
  // pure `buildStatusSurfaceData` core. Hook call-order and per-value
  // reference identity are unchanged:
  // `visibleWorktreeFiles` is the single source of truth for
  // staged/unstaged/untracked filtering and feeds the grouping below; it
  // stays internal to the hook (no direct consumer in app.ts), so only
  // the values app.ts reads are destructured:
  //  - `visibleWorktreeGroups` / `visibleWorktreeFilesGrouped` drive the
  //    status surface's three-tier cursor model and keep the rendered
  //    list in canonical group order regardless of the order
  //    `git status --porcelain` emits.
  //  - `selectedWorktreeFile` keeps a dedicated memo (deps
  //    `[visibleWorktreeFilesGrouped, selectedWorktreeFileIndex]`) so an
  //    unchanged selection yields a stable reference — it feeds the
  //    worktree-diff and worktree-hunks effects below via its `.path` /
  //    `.indexStatus` / `.worktreeStatus`.
  //  - `stashDiffParsedFiles` is the per-file segmentation of the active
  //    stash patch (hoisted out of useInput / the yank handler /
  //    renderDiffSurface, all of which used to re-walk the patch text).
  const {
    visibleWorktreeGroups,
    visibleWorktreeFilesGrouped,
    selectedWorktreeFile,
    stashDiffParsedFiles,
  } = useStatusSurfaceData(
    React,
    context.worktree?.files,
    state.statusFilterMask,
    state.selectedWorktreeFileIndex,
    stashDiffLines,
  )

  // Filtered promoted-view lists (#808). These were recomputed inline
  // inside useInput on every keystroke — for a repo with hundreds of
  // branches / tags and an active filter, that's hundreds of regex
  // matches per arrow-key press. Memoizing on (raw list, filter)
  // collapses the work to one pass per filter / data change.
  // Extracted into `useFilteredLists` (0.72 app.ts decomposition). The
  // hook issues one `React.useMemo` per list in the same order — and
  // with the same per-list dependency arrays — these memos used to,
  // delegating to the pure `buildFilteredLists` core. Hook call-order
  // and per-list reference identity are unchanged; every downstream
  // consumer (the input handler, cursor-sync) destructures the same
  // names below.
  const {
    filteredBranchList,
    filteredTagList,
    filteredStashList,
    filteredWorktreeList,
    filteredReflogList,
    filteredSubmoduleList,
    filteredRemoteList,
    filteredIssueList,
    filteredPullRequestTriageList,
  } = useFilteredLists(React, context, state.filter)

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
  // linger forever. Extracted into `useStatusAutoDismiss` (0.72 app.ts
  // decomposition). The hook issues the single timer `useEffect` in the
  // same position and with the same dep array the inline cluster used, so
  // React hook ordering and the timer's reset/cancel/mountedRef semantics
  // are unchanged: each new message resets the timer, clearing the message
  // via setStatus(undefined) cancels it, and it doesn't fire while a modal
  // (input prompt, confirmation, palette) is open — those flows use the
  // status line as live feedback for the open task.
  useStatusAutoDismiss(React, {
    statusMessage: state.statusMessage,
    inputPrompt: state.inputPrompt,
    pendingConfirmationId: state.pendingConfirmationId,
    pendingChoice: state.pendingChoice,
    pendingMutationConfirmation: state.pendingMutationConfirmation,
    showCommandPalette: state.showCommandPalette,
    dispatch,
    mountedRef,
  })

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
        // Drop the blame cache (#0.71): staging / unstaging / reverting
        // changes the working-tree contents, so any cached attribution
        // (especially the "staged" not-yet-committed lines) is now
        // potentially stale. Re-opening blame re-hydrates from the
        // fresh tree.
        blameByPath: undefined,
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
  // context when something changes outside the TUI. Lifted verbatim into
  // `useRefreshWatcher` (0.72 app.ts decomposition, PR 9) — the async
  // `revparse` bootstrap, the `cancelled` guard, the 750ms debounce, the
  // `mountedRef` mount check, and the `watcher?.close()` teardown all carry
  // over byte-for-byte, as does the dep array.
  useRefreshWatcher(React, {
    git,
    mountedRef,
    refreshContext,
    refreshWorktreeContext,
  })

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
  useViewModePersistence(React, {
    git,
    dispatch,
    repoRootRef,
    userSidebarTab: state.userSidebarTab,
    diffViewMode: state.diffViewMode,
  })

  // P-stash-explorer: load `git stash show -p <ref>` once the diff view
  // becomes active with diffSource='stash'. Best-effort — empty stashes
  // or read errors fall through to a "no diff" hint at the render site.
  // Lifted verbatim into `useStashDiffHydration` (0.72 app.ts
  // decomposition, PR 8) — the guard, the `active` cancellation flag, the
  // `safe()` wrapper, the loading toggle, and the dependency array all
  // carry over byte-for-byte.
  useStashDiffHydration(React, {
    git,
    activeView: state.activeView,
    diffSource: state.diffSource,
    stashDiffRef: state.stashDiffRef,
    setStashDiffLines,
    setStashDiffLoading,
  })

  // #879 (item 2) — load commit detail for the active bisect's
  // current candidate so the bisect surface can show "what changed
  // here" alongside the decision keys. Mirrors the history-detail
  // loader's shape but keyed on `bisect.currentSha` and only fires
  // when the bisect view is active. Best-effort: any failure leaves
  // the surface in its non-detail mode (decision log only) — never
  // crash the workstation because git couldn't resolve a sha.
  // Owned by `useBisectCandidateState` (app.ts decomposition item 2 / #1237).
  // The `useState` pair stays in this exact slot (just above the
  // `useBlameLoadingState` call); the loader effect that toggles it is issued
  // a few lines below by `useBisectCandidateHydration`, in its original
  // position — a two-hook split to preserve React hook ordering.
  const {
    bisectCandidateDetail,
    setBisectCandidateDetail,
    bisectCandidateLoading,
    setBisectCandidateLoading,
  } = useBisectCandidateState(React)
  // On-demand blame hydration flag (#0.71). True while the debounced
  // `getBlame` for the active `state.blamePath` is in flight; the blame
  // surface shows a loading placeholder until the parse lands in the
  // `blameByPath` cache. The `useState` is issued here (in its original
  // slot, next to the bisect-candidate `useState`s) by `useBlameLoadingState`
  // to preserve hook ordering; the debounced effects that toggle it live in
  // `useDetailHydration` further down (0.72 app.ts decomposition, PR 7).
  const { blameLoading, setBlameLoading } = useBlameLoadingState(React)
  const bisectCandidateSha = state.activeView === 'bisect' && context.bisect?.active
    ? context.bisect.currentSha
    : ''
  // Lifted verbatim into `useBisectCandidateHydration` (app.ts decomposition
  // item 2 / #1237) — the empty-sha guard, `active` cancellation flag, `safe()`
  // wrapper, loading toggles, and `[git, bisectCandidateSha]` dependency array
  // carry over byte-for-byte. Issued here, in its original slot; the `useState`
  // pair it writes is owned by `useBisectCandidateState` above.
  useBisectCandidateHydration(React, {
    git,
    bisectCandidateSha,
    setBisectCandidateDetail,
    setBisectCandidateLoading,
  })

  // #779 — load `git diff <base>..<head>` once the diff view becomes
  // active with diffSource='compare'. Mirrors the stash loader's
  // shape; the surface renders the lines via the same +/-/@@ coloring
  // path. On unknown ref / git error, `safe()` swallows and the
  // surface falls back to a "no diff" hint.
  const compareBaseRef = state.compareBase?.ref
  const compareHeadRef = state.compareHead?.ref
  // Lifted verbatim into `useCompareDiffHydration` (0.72 app.ts
  // decomposition, PR 8) — guard, `active` flag, `safe()` wrapper, loading
  // toggle, and dependency array carry over byte-for-byte.
  useCompareDiffHydration(React, {
    git,
    activeView: state.activeView,
    diffSource: state.diffSource,
    compareBaseRef,
    compareHeadRef,
    setCompareDiffLines,
    setCompareDiffLoading,
  })

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

  // Lifted verbatim into `useWorktreeHunksHydration` (0.72 app.ts
  // decomposition, PR 8) — guard, `active` flag, `safe()` wrapper, loading
  // toggle, and dependency array carry over byte-for-byte.
  useWorktreeHunksHydration(React, {
    git,
    activeView: state.activeView,
    selectedWorktreeFile,
    setWorktreeHunks,
    setWorktreeHunksLoading,
  })

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
  // Cache-aware boot load + lazy PR-overview hydration. Both effects were
  // lifted verbatim into `useContextHydration` (0.72 app.ts decomposition,
  // PR 9): the per-key `'ready'` gate (read through `contextStatusRef`),
  // the `active` cancellation flag, the PR view / cache guards, and — the
  // critical invariant — the `issuedAtDepth = runtimes.length - 1`
  // frame-tag captured *before* the await all carry over byte-for-byte, as
  // do the dep arrays. `loadLogInkContextEntries` (the boot loader table)
  // and `contextStatusRef` stay here and are injected so the move stays
  // faithful without relocating unrelated module-local helpers.
  useContextHydration(React, {
    git,
    activeView: state.activeView,
    context,
    runtimes,
    loadLogInkContextEntries,
    contextStatusRef,
    setContext,
    setContextStatus,
  })

  // Lazy-load the issue triage list (#882 phase 3, filter-aware
  // since phase 6). Fires on entry to the view AND on filter
  // preset changes (`f` cycles the preset; the dep on
  // `state.selectedIssueFilter` triggers the refetch). The
  // existing `context.issueList` guard collapses to a no-op when
  // the preset hasn't changed and data is already loaded.
  // Forge facade — picks gh (GitHub / GHE) vs glab (GitLab) implementations
  // from the detected provider, so every list / detail / action below routes
  // to the right CLI without per-call-site branching.
  const forgeProvider = context.provider?.repository.provider
  const forgeGitlabPath =
    context.provider?.repository.owner && context.provider?.repository.name
      ? `${context.provider.repository.owner}/${context.provider.repository.name}`
      : undefined
  // Remote host (`gitlab.com` or a self-hosted instance) — threaded so the
  // GitLab error-path auth re-probe checks the right server.
  const forgeGitlabHost = context.provider?.repository.host
  const forge = React.useMemo(
    () => getForgeActions(forgeProvider, { gitlabPath: forgeGitlabPath, gitlabHost: forgeGitlabHost }),
    [forgeProvider, forgeGitlabPath, forgeGitlabHost]
  )

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
    void safe(forge.getIssueList(git, filter)).then((value) => {
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
    void safe(forge.getPullRequestList(git, filter)).then((value) => {
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

  // Per-item inspector hydration (#882) + on-demand blame hydration
  // (#0.71). When the user rests the cursor on an issue / PR row for
  // ~250ms — or opens the blame view for a path for ~150ms — fetch the
  // detail and cache it keyed by number / path. Cursoring back to a
  // previously-fetched item renders the cached entry instantly; rapid
  // j/k navigation never fires a `gh` / `git blame` call because the
  // debounce timer resets on every cursor move. The three debounced
  // effects (issue detail, PR detail, blame) were lifted verbatim into
  // `useDetailHydration` (0.72 app.ts decomposition, PR 7) — the debounce
  // delays, the `active` cancellation flag, the cache-skip check, the
  // `clearTimeout` cleanup, and the `issuedAtDepth` frame-tag captured
  // before the await all carry over byte-for-byte. The `blameLoading`
  // `useState` it toggles is issued above by `useBlameLoadingState`.
  useDetailHydration(React, {
    git,
    forge,
    state,
    context,
    runtimes,
    filteredIssueList,
    filteredPullRequestTriageList,
    setContext,
    setBlameLoading,
  })

  // Commit-detail loader, lifted verbatim into `useCommitDetailHydration`
  // (app.ts decomposition item 1a / #1237) — guard, `active` cancellation
  // flag, `safe()` wrapper, `detailLoading` toggles, and `[git, selected?.hash]`
  // dependency array carry over byte-for-byte. Issued here, in its original
  // slot; the `useState` it toggles is owned by `useCommitDetailState` above.
  useCommitDetailHydration(React, {
    git,
    selected,
    setDetail,
    setDetailLoading,
  })

  // #806 follow-up — auto-jump the history view to whichever branch /
  // tag / stash the user is cursoring (cluster N). Lifted verbatim into
  // `useHistoryCursorSync` (0.72 app.ts decomposition, PR 10): the two
  // cluster-local refs (`lastSyncedHashRef`, `attemptedContextHashesRef`),
  // the forward-reference bridge ref (`loadCommitContextRef`), and the
  // sync + reset effects move over in the same declaration order with
  // byte-identical dep arrays. The hook RETURNS `loadCommitContextRef` so
  // the load-more cluster (`useLoadMoreHistory`, far below) can keep its
  // `loadCommitContextRef.current = loadCommitContext` assignment in the
  // exact same relative slot — see that hook for the full render-order
  // race write-up.
  const loadCommitContextRef = useHistoryCursorSync(React, {
    dispatch,
    context,
    state,
  })

  // Lifted verbatim into `useWorktreeDiffHydration` (0.72 app.ts
  // decomposition, PR 8) — guard, `active` flag, `safe()` wrapper, loading
  // toggle, and dependency array carry over byte-for-byte.
  useWorktreeDiffHydration(React, {
    git,
    activeView: state.activeView,
    selectedWorktreeFile,
    setWorktreeDiff,
    setWorktreeDiffLoading,
  })

  // Syntax-highlight the diff currently in view, off the render path
  // (#1117 follow-up). Lifted verbatim into `useDiffSyntaxHighlight` (app.ts
  // decomposition item 2 / #1237) — the gate, the commit-vs-worktree source
  // detection, the `active` cancellation flag, the `highlightDiffCode` call,
  // and the dependency array carry over byte-for-byte. Issued here, in its
  // original slot; the `useState` it writes is owned by `useDiffSyntaxState`
  // above.
  useDiffSyntaxHighlight(React, {
    syntaxHighlightEnabled,
    noColor: theme.noColor,
    activeView: state.activeView,
    diffSource: state.diffSource,
    selectedDetailFile,
    filePreview,
    worktreeDiff,
    setDiffSyntaxSpans,
  })

  // Lifted verbatim into `useWorktreeStageActions` (0.72 app.ts
  // decomposition — the first extraction of action callbacks). The four
  // staging/revert handlers are contiguous and invoked ONLY from the input
  // handler's keystroke dispatch (no effect/memo dep-array reference), so a
  // single hook at this slot preserves both hook order and the four
  // `useCallback` identities. Bodies + dep arrays are byte-identical; the
  // only change is `state.worktreeDiffOffset` is threaded in as
  // `worktreeDiffOffset` (same value).
  const {
    toggleSelectedFileStage,
    toggleSelectedHunkStage,
    revertSelectedFile,
    revertSelectedHunk,
  } = useWorktreeStageActions(React, {
    git,
    dispatch,
    selectedWorktreeFile,
    worktreeDiff,
    worktreeHunks,
    worktreeDiffOffset: state.worktreeDiffOffset,
    refreshWorktreeContext,
    setWorktreeDiff,
    setWorktreeHunks,
  })

  // Lifted verbatim into `useCommitComposeActions` (0.72 app.ts
  // decomposition). `createCommitFromCompose` and `openComposeInEditor`
  // are non-contiguous in the original file but read only early-declared
  // values, so a single hook call here reproduces both `useCallback`
  // identities exactly. Both are keystroke-dispatch-only — not in any
  // effect/memo dep array — so co-locating them is identity-safe.
  const {
    createCommitFromCompose,
    openComposeInEditor,
  } = useCommitComposeActions(React, {
    git,
    dispatch,
    context,
    commitCompose: state.commitCompose,
    refreshHistoryRows,
    refreshWorktreeContext,
    resumeRef,
  })

  // Lifted verbatim into `useAiCommitDraftActions` (0.72 app.ts
  // decomposition). The hook declares `aiDraftAbortRef` internally
  // (pair-local: read only by these two callbacks) and reproduces both
  // `useCallback` bodies + dep arrays byte-for-byte. `mountedRef` is
  // shared with the rest of the component so it stays here and is
  // threaded in.
  const {
    runAiCommitDraft,
    cancelAiCommitDraft,
  } = useAiCommitDraftActions(React, {
    git,
    dispatch,
    mountedRef,
  })

  // Lifted verbatim into `usePullRequestActions` (0.72 app.ts
  // decomposition). The hook declares `pullRequestBodyCancelRef`
  // internally (pair-local: read only by these two callbacks) and
  // reproduces both `useCallback` bodies + dep arrays byte-for-byte.
  const {
    startCreatePullRequest,
    cancelPullRequestBodyDraft,
  } = usePullRequestActions(React, {
    dispatch,
    context,
    forgeProvider,
  })

  // Lifted verbatim into `useYankActions` (0.72 app.ts decomposition,
  // alongside `useChangelogActions`). `yankText` (generic clipboard copy)
  // and `yankFromActiveView` (view-polymorphic target resolution) are the
  // two clipboard callbacks; they're independent (`yankFromActiveView`
  // resolves the `clipboard` runner directly rather than calling `yankText`),
  // so the hook holds no in-hook cross-reference. All of
  // `yankFromActiveView`'s ~31 dep-array inputs (`context`, `state`,
  // `selected`, `selectedDetailFile`, `stashDiffLines`,
  // `stashDiffParsedFiles`, `visibleWorktreeFilesGrouped`, the three
  // filtered lists) are declared above this slot. Both callbacks are
  // keystroke-dispatch-only — not in any effect/memo dep array — so the
  // move is identity-safe. `yankText` is destructured out so
  // `useChangelogActions` (called next) can thread it into `yankChangelog`.
  const {
    yankText,
    yankFromActiveView,
  } = useYankActions(React, {
    clipboardRunner,
    dispatch,
    context,
    state,
    selected,
    selectedDetailFile,
    stashDiffLines,
    stashDiffParsedFiles,
    visibleWorktreeFilesGrouped,
    filteredRemoteList,
    filteredIssueList,
    filteredPullRequestTriageList,
  })

  // Lifted verbatim into `useChangelogActions` (0.72 app.ts decomposition,
  // alongside `useYankActions`). The four changelog callbacks
  // (`startChangelogView` `L`, `regenerateChangelog` `r`, `yankChangelog`
  // `y`, `openChangelogInEditor` `E`) share the changelog-view orchestration.
  // `regenerateChangelog` references the in-hook `startChangelogView`
  // identity; `yankChangelog` delegates to `yankText` — owned by the
  // `useYankActions` hook called just above and threaded in here — keeping
  // its `[dispatch, changelogViewText, yankText]` dep array verbatim. The
  // `state.changelogCache` / `state.changelogView.text` dep slices are
  // threaded in as `changelogCache` / `changelogViewText` (identical
  // dependency SET). All four are keystroke-dispatch-only — not in any
  // effect/memo dep array — so co-locating them is identity-safe.
  const {
    startChangelogView,
    regenerateChangelog,
    yankChangelog,
    openChangelogInEditor,
  } = useChangelogActions(React, {
    dispatch,
    context,
    changelogCache: state.changelogCache,
    changelogViewText: state.changelogView.text,
    resumeRef,
    yankText,
  })

  // Lifted verbatim into `useEditorActions` (0.72 app.ts decomposition).
  // `openConfigInEditor` depends on the in-hook `openInEditor` identity
  // (`[dispatch, openInEditor]`), so the pair must share a hook. Both are
  // keystroke-dispatch-only — not in any effect/memo dep array.
  const {
    openInEditor,
    openConfigInEditor,
  } = useEditorActions(React, {
    dispatch,
    refreshWorktreeContext,
    resumeRef,
    repoRootRef,
  })

  // Lifted verbatim into `useCommitSplitActions` (0.72 app.ts
  // decomposition). `startCommitSplit`, `applyCommitSplit`, and
  // `cancelCommitSplit` are three contiguous callbacks sharing the
  // `state.splitPlan` orchestration; all read only early-declared values
  // (`context`, `state.splitPlan`, `git`, `dispatch`, the three refresh
  // callbacks), so a single hook call at their original slot reproduces all
  // three `useCallback` identities exactly. They are keystroke-dispatch-only
  // — not in any effect/memo dep array — so co-locating them is identity-safe.
  const {
    startCommitSplit,
    applyCommitSplit,
    cancelCommitSplit,
  } = useCommitSplitActions(React, {
    git,
    dispatch,
    context,
    splitPlan: state.splitPlan,
    refreshContext,
    refreshHistoryRows,
    refreshWorktreeContext,
  })

  // Lifted verbatim into `useWorkflowAction` (0.72 app.ts decomposition,
  // PR 16 — the single largest extraction). The ~1,200-line dispatcher —
  // the `handlers` object literal plus the shared try/catch/finally
  // orchestration, with `runApplyHunk` / `invalidateIssueListCaches` /
  // `invalidatePullRequestListCaches` inline and `lastDroppedStashRef`
  // owned inside — moves wholesale. `context` and `state` are passed WHOLE
  // so the body reads (`state.selectedBranchIndex`, …) and the 18-item dep
  // array stay byte-identical. The callback is keystroke-dispatch-only
  // (the `runWorkflowAction` input event) — not in any effect/memo dep
  // array — so co-locating it is identity-safe.
  const { runWorkflowAction } = useWorkflowAction(React, {
    git,
    context,
    state,
    dispatch,
    refreshContext,
    refreshHistoryRows,
    refreshWorktreeContext,
    setContext,
    setContextStatus,
    forge,
    forgeProvider,
    filteredRemoteList,
    filteredReflogList,
    filteredSubmoduleList,
    filteredIssueList,
    filteredPullRequestTriageList,
  })

  // Lifted verbatim into `useCommitFilePreviewHydration` (0.72 app.ts
  // decomposition, PR 8) — guard, `active` flag, `safe()` wrapper, loading
  // toggle, and dependency array carry over byte-for-byte.
  useCommitFilePreviewHydration(React, {
    git,
    selected,
    selectedDetailFile,
    setFilePreview,
    setFilePreviewLoading,
  })

  React.useEffect(() => {
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Load-more pagination + targeted-context loader (cluster O). Lifted
  // verbatim into `useLoadMoreHistory` (0.72 app.ts decomposition, PR 10):
  // the `loadingMoreCommitsRef` mirror effect, the STABLE `loadMoreCommits`
  // `useCallback` (deps `[dispatch, git]`, identity preserved so the
  // cursor-sync chain never sees a stale callback), the scroll-near-bottom
  // auto-trigger effect, the STABLE `loadCommitContext` `useCallback`, and
  // the `loadCommitContextRef.current = loadCommitContext` bridge-assignment
  // effect all move over in the same declaration order with byte-identical
  // dep arrays. `mountedRef`, `loadingMoreCommitsRef`, `loadMoreRequestRef`,
  // the `hasMoreCommits` / `loadingMoreCommits` state and their setters stay
  // in app.ts (read/written by the render and the history-filter / graph-
  // toggle effects) and are passed in. The hook keeps the bridge assignment
  // in its EXACT relative slot so the render-order race documented in
  // `useHistoryCursorSync` cannot recur.
  useLoadMoreHistory(React, {
    git,
    dispatch,
    state,
    logArgv,
    hasMoreCommits,
    setHasMoreCommits,
    loadingMoreCommits,
    setLoadingMoreCommits,
    mountedRef,
    loadingMoreCommitsRef,
    loadMoreRequestRef,
    loadCommitContextRef,
  })

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

  // Header surface component (#1136, 0.72 phase 7). Built once with a
  // stable identity so the subtree isn't remounted every render — the
  // factory closes over the runtime React instance and rendering
  // primitives, and the component reads state/context/theme/layout from
  // `LogInkRuntimeContext` (the provider installed below) instead of
  // receiving them as positional props. Empty deps: `React`, `h`, `Box`,
  // `Text` are stable for the lifetime of the component.
  const LogInkHeader = React.useMemo(
    () => createLogInkHeader(React, h, { Box, Text }),
    []
  )

  const worktreeDirty = Boolean(
    context.worktree &&
    (context.worktree.stagedCount + context.worktree.unstagedCount + context.worktree.untrackedCount) > 0
  )

  // Lifted verbatim into `useInputHandler` (0.72 app.ts decomposition, the
  // final big cluster). The single `useInput(…)` keyboard handler — the
  // component's largest reader — moves wholesale: it derives the per-keystroke
  // filtered-list snapshots, assembles the ~60-field input-context object for
  // `getLogInkInputEvents`, and dispatches the returned events into the
  // extracted action callbacks + the reducer. `useInput` (ink's hook) is
  // injected so the hook can call it unconditionally at this exact slot,
  // preserving ink's hook order. `context` and `state` are passed WHOLE so the
  // handler body stays byte-identical; the six pure helpers it calls move into
  // the hook (used nowhere else here). The original had NO `useInput` options
  // argument, so none is threaded.
  useInputHandler(useInput, {
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
    createCommitFromCompose,
    openComposeInEditor,
    runAiCommitDraft,
    cancelAiCommitDraft,
    startCreatePullRequest,
    cancelPullRequestBodyDraft,
    startChangelogView,
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
        state.pendingChoice ||
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
    contextStatus,
    h,
    components: { Box, Text },
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
    renderMainPanel(React, mainSurface, {
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
      blame: state.blamePath ? context.blameByPath?.get(state.blamePath) : undefined,
      blameLoading,
      hasMoreCommits,
      loadingMoreCommits,
      spinnerFrame,
      density: layout.density,
      rowMode: layout.historyRowMode,
      dateBucketingEnabled: Boolean(dateBucketingEnabled),
      syntaxSpans: diffSyntaxSpans,
    })
  const detailPanel = () =>
    renderDetailPanel(
      React,
      {
        h,
        components: { Box, Text },
        state,
        context,
        contextStatus,
        bodyRows: layout.bodyRows,
        width: layout.detailWidth,
        theme,
      },
      {
        detail,
        loading: detailLoading,
        filePreview,
        filePreviewLoading,
        tabbed: layout.inspectorTabbed,
      }
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
    h(LogInkHeader, { contextStatus, appLabel }),
    h(Box, { flexDirection: 'row', height: layout.bodyRows }, ...bodyPanels),
    renderFooter(h, { Box, Text }, state, context, theme, idleTip, spinnerFrame, layout.singlePane)
    )
  )
}

