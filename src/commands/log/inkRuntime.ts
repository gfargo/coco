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
import type * as ReactTypes from 'react'
import { SimpleGit } from 'simple-git'
import { BranchOverview, getBranchOverview } from './branchData'
import { createManualCommit } from './commitCompose'
import { runCommitDraftWorkflow } from './commitWorkflowActions'
import {
    GitCommitDetail,
    GitCommitFilePreview,
    GitLogCommitRow,
    GitLogRow,
    LOG_INTERACTIVE_DEFAULT_LIMIT,
    buildToggleGraphArgs,
    getCommitDetail,
    getCommitFilePreview,
    getCommitRows,
    getLogRows,
} from './data'
import {
    LogInkContextKey,
    LogInkContextStatus,
    createLogInkContextStatus,
    isLogInkContextKeyLoading,
    isLogInkContextLoading,
    updateLogInkContextStatus,
} from './inkContext'
import {
    formatInkRefLabels,
    getVisibleLogInkHistory,
} from './inkHistoryRows'
import {
    formatBindingKeys,
    formatLogInkBreadcrumb,
    filterLogInkPaletteCommands,
    getLogInkChordContinuations,
    getLogInkPaletteCommands,
    getLogInkFooterHints,
    getLogInkHelpSections,
} from './inkKeymap'
import { substituteGraphChars } from './inkGraphChars'
import { LaneSegment, getLaneColor } from './inkGraphLanes'
import { formatHyperlink } from './inkHyperlinks'
import {
    LogInkInputKey,
    getInspectorActionsForState,
    getLogInkInputEvents,
} from './inkInput'
import { hasSeenOnboarding, markOnboardingSeen } from './inkOnboarding'
import { getSavedDiffViewMode, saveDiffViewMode } from './inkDiffViewModePersistence'
import { getSavedSidebarTab, saveSidebarTab } from './inkSidebarPersistence'
import { SplitDiffRow, buildSplitDiffRows } from './inkSplitDiff'
import { getSidebarVisibleWindow } from './inkSidebarSelection'
import {
    PromotedSelectionsSnapshot,
    rectifyPromotedSelectionIndex,
} from './inkSelectionRectify'
import {
    LogInkRefreshWatcher,
    createRefreshWatcher,
} from './inkRefreshWatcher'
import { installTerminalLifecycle } from './inkTerminalLifecycle'
import {
    LOG_INK_DEFAULT_COLUMNS,
    LOG_INK_DEFAULT_ROWS,
    LOG_INK_MIN_COLUMNS,
    LOG_INK_MIN_ROWS,
    getLogInkLayout,
} from './inkLayout'
import { createLogInkTheme, LogInkTheme, LogInkThemeConfig } from './inkTheme'
import {
    STAGE_STATUS_DOT,
    branchRowMarker,
    formatBranchDivergence,
    formatBranchLastTouched,
    getPullRequestStateGlyph,
    getStageStatusDotColor,
    sidebarTabCount,
} from './inkIconography'
import { IDLE_TIPS_GRACE_MS, IDLE_TIPS_INTERVAL_MS, pickIdleTip } from './inkIdleTips'
import {
    PreviewLine,
    formatBranchPreview,
    formatStashPreview,
    formatTagPreview,
} from './inkPreviewPane'
import {
    formatSortIndicator,
    sortBranches,
    sortTags,
} from './inkSorting'
import {
    formatLogInkBranchesEmpty,
    formatLogInkComposeEmpty,
    formatLogInkHistoryEmpty,
    formatLogInkLoading,
    formatLogInkReflogEmpty,
    formatLogInkStashEmpty,
    formatLogInkStatusEmpty,
    formatLogInkTagsEmpty,
} from './inkSurfaceStates'
import { cellWidth, truncateCells, wrapCells } from './inkText'
import {
    LogInkHistoryFetchArgs,
    LogInkSidebarTab,
    LogInkState,
    LogInkStatusFilterMask,
    LogInkView,
    applyLogInkAction,
    createLogInkState,
    getLogInkSidebarTabs,
    getSelectedInkCommit,
} from './inkViewModel'
import { startInteractiveLog } from './interactive'
import { GitOperationOverview, getGitOperationOverview } from './operationData'
import { openProviderUrl } from './providerActions'
import { ProviderOverview, ProviderRepository, buildProviderUrl, getProviderOverview } from './providerData'
import {
    checkoutBranch,
    createBranch,
    deleteBranch,
    fetchRemotes,
    pullCurrentBranch,
    pushCurrentBranch,
    renameBranch,
    setUpstream,
} from './branchActions'
import { createLightweightTag, deleteLocalTag, deleteRemoteTag, pushTag } from './tagActions'
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
} from './historyActions'
import { applyStash, checkoutFileFromStash, createStash, dropStash, popStash } from './stashActions'
import { ApplyHunkTarget, applyHunkPatch } from './hunkActions'
import { removeWorktree, removeWorktreeAndBranch } from './worktreeActions'
import { abortOperation, continueOperation, resolveConflictOurs, resolveConflictTheirs, stageConflictResolved } from './operationActions'
import { PullRequestOverview, getPullRequestOverview } from './pullRequestData'
import {
    approvePullRequest,
    closePullRequest,
    commentPullRequest,
    isPullRequestMergeStrategy,
    mergePullRequest,
    requestChangesPullRequest,
} from './pullRequestActions'
import {
    StashOverview,
    findStashFileForOffset,
    getStashDiff,
    getStashOverview,
    parseStashDiffFiles,
} from './stashData'
import { formatStashHeaderIdentity } from './inkStashHeader'
import {
    buildPullRequestCheckRows,
    formatPullRequestChecksSummary,
    formatPullRequestReviewsSummary,
    formatPullRequestStateLine,
    summarizePullRequestChecks,
    summarizePullRequestReviews,
} from './inkPullRequestPanel'
import {
    revertFile,
    stageAllFiles,
    stageFile,
    unstageAllFiles,
    unstageFile,
} from './statusActions'
import {
    WorktreeFile,
    WorktreeFileGroup,
    WorktreeOverview,
    applyStatusFilterMask,
    flattenWorktreeGroups,
    getWorktreeOverview,
    groupWorktreeFiles,
} from './statusData'
import {
    WorktreeHunkOverview,
    getWorktreeHunks,
    revertHunk,
    stageHunk,
    unstageHunk,
} from './statusHunks'
import { getCompareDiff } from './compareData'
import { ReflogOverview, getReflogOverview, splitReflogSubject } from './reflogData'
import { TagOverview, getTagOverview } from './tagData'
import {
    getLogInkWorkflowActionById,
} from './inkWorkflows'
import {
    InspectorAction,
    InspectorActionContext,
    getInspectorActions,
} from './inkInspectorActions'
import { WorktreeOverview as WorktreeListOverview, getWorktreeListOverview } from './worktreeData'
import { WorktreeFileDiff, getWorktreeFileDiff } from './worktreeDiffData'
import { canStartLogInkTui, getLogInkRenderOptions } from './inkTerminal'
import { LogArgv } from './config'

type DynamicImport = <T>(specifier: string) => Promise<T>
const dynamicImport = new Function('specifier', 'return import(specifier)') as DynamicImport

type LogInkStreams = {
  input?: NodeJS.ReadStream
  output?: NodeJS.WriteStream
  error?: NodeJS.WriteStream
}

type LogInkOptions = {
  appLabel?: string
  /**
   * P4.3 — opt-in idle tip rotation. Forwarded from `logTui.idleTips` in the
   * user's config. The runtime starts a tip cycle when `state.statusMessage`
   * is empty for >10s; the tip lives in the footer's status slot until the
   * next user action sets a real message.
   */
  idleTips?: boolean
  initialView?: LogInkView
  logArgv?: LogArgv
  /**
   * Deferred commit-log loader (#808). When set, the runtime mounts
   * Ink immediately with whatever `rows` was passed (typically `[]`)
   * and runs `loadRows` in a useEffect. The history surface shows a
   * "Loading commits…" placeholder while the load is in flight; the
   * loader's result is dispatched via `replaceRows` which clears the
   * boot flag. Without this option the runtime keeps the previous
   * eager behavior (caller awaits the rows before mount).
   */
  loadRows?: () => Promise<GitLogRow[]>
  theme?: LogInkThemeConfig
}

type LogInkContext = {
  branches?: BranchOverview
  operation?: GitOperationOverview
  provider?: ProviderOverview
  pullRequest?: PullRequestOverview
  reflog?: ReflogOverview
  stashes?: StashOverview
  tags?: TagOverview
  worktree?: WorktreeOverview
  worktreeList?: WorktreeListOverview
}

type LogInkRuntime = {
  ink: {
    Box: ReactTypes.ComponentType<Record<string, unknown>>
    Text: ReactTypes.ComponentType<Record<string, unknown>>
    render: (
      app: ReactTypes.ReactElement,
      options: {
        alternateScreen?: boolean
        exitOnCtrlC?: boolean
        patchConsole?: boolean
        stderr?: NodeJS.WriteStream
        stdin?: NodeJS.ReadStream
        stdout?: NodeJS.WriteStream
      }
    ) => {
      waitUntilExit: () => Promise<void>
      unmount: () => void
    }
    useApp: () => {
      exit: () => void
    }
    useInput: (handler: (input: string, key: LogInkInputKey) => void) => void
    useWindowSize: () => {
      columns: number
      rows: number
    }
  }
  React: typeof ReactTypes
}

type LogInkComponents = Pick<LogInkRuntime['ink'], 'Box' | 'Text'>

type LogInkComponentDeps = LogInkRuntime & {
  appLabel: string
  git: SimpleGit
  /** Drives P4.3 idle status-line tip rotation when truthy. */
  idleTipsEnabled?: boolean
  initialView: LogInkView
  logArgv?: LogArgv
  rows: GitLogRow[]
  /**
   * Optional deferred commit-log loader (#808). When set, the React
   * tree mounts with `rows` (typically `[]`) and runs the loader on
   * mount, dispatching `replaceRows` on completion. Boot UX is the
   * sole motivator — for a moderately large repo, awaiting `git log`
   * before mount produces 1-3 seconds of black terminal that reads as
   * "is this hanging?".
   */
  loadRows?: () => Promise<GitLogRow[]>
  theme: LogInkTheme
  /**
   * Mutable ref the runtime fills with a force-render callback. The
   * terminal-lifecycle module invokes it on `SIGCONT` so users land on a
   * painted screen after `fg` instead of an empty alt buffer.
   */
  resumeRef?: { current: (() => void) | null }
  /**
   * Test seam — when set, the yank-to-clipboard handler uses this runner
   * instead of `defaultClipboardRunner`. Lets unit tests assert that the
   * right value reached the clipboard without spawning pbcopy/wl-copy.
   */
  clipboardRunner?: ClipboardRunner
}

const truncate = truncateCells

function compactHash(hash: string | undefined): string {
  return hash ? hash.slice(0, 7) : '<none>'
}

async function safe<T>(promise: Promise<T>): Promise<T | undefined> {
  try {
    return await promise
  } catch {
    return undefined
  }
}

async function loadLogInkContext(git: SimpleGit): Promise<LogInkContext> {
  const [branches, pullRequest, tags, worktree, stashes, worktreeList, operation, provider, reflog] =
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
    ])

  return {
    branches,
    operation,
    provider,
    pullRequest,
    reflog,
    stashes,
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

async function loadInkRuntime(): Promise<LogInkRuntime> {
  const [ink, React] = await Promise.all([
    dynamicImport<LogInkRuntime['ink']>('ink'),
    dynamicImport<typeof ReactTypes>('react'),
  ])

  return {
    ink,
    React,
  }
}

function focusBorderColor(
  theme: LogInkTheme,
  focused: boolean
): string | undefined {
  if (theme.noColor) {
    return undefined
  }

  return focused ? theme.colors.focusBorder : theme.colors.border
}

function panelTitle(title: string, focused: boolean): string {
  return focused ? `${title} *` : title
}

/**
 * Map a unified-diff line to the props passed to an Ink `<Text>` so the
 * standard +/-/@@ prefixes render in their conventional colors. File
 * headers (`+++`, `---`, `diff --git`, `index`) get a softer treatment so
 * they don't compete with the actual hunk content.
 *
 * `theme.noColor` collapses everything to dim/normal so we stay readable
 * under `NO_COLOR` and the `monochrome` preset.
 */
function diffLineProps(
  line: string,
  theme: LogInkTheme
): { color?: string; dimColor?: boolean } {
  if (theme.noColor) {
    return { dimColor: line.startsWith(' ') || line.startsWith('diff ') || line.startsWith('index ') }
  }

  if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('+++') || line.startsWith('---')) {
    return { dimColor: true }
  }
  if (line.startsWith('@@')) {
    return { color: theme.colors.accent }
  }
  if (line.startsWith('+')) {
    return { color: theme.colors.gitAdded }
  }
  if (line.startsWith('-')) {
    return { color: theme.colors.gitDeleted }
  }

  return {}
}

/**
 * Minimum terminal width below which the split diff falls back to
 * unified rendering (#785). Each column needs ~50 columns for code to
 * read comfortably plus border + padding overhead, so anything narrower
 * than ~120 columns gets the unified view regardless of the user's
 * preference. The preference is preserved — switching back to a wide
 * terminal restores split mode automatically.
 */
const MIN_SPLIT_DIFF_WIDTH = 120

function isSplitDiffViable(state: LogInkState, width: number): boolean {
  return state.diffViewMode === 'split' && width >= MIN_SPLIT_DIFF_WIDTH
}

/**
 * Style props for one side of a split-diff row, derived from the row's
 * `kind` rather than the leading character (because the helper has
 * already stripped the leading +/-/space). Keeps the colors aligned with
 * `diffLineProps`.
 */
function splitDiffSideProps(
  kind: SplitDiffRow['left']['kind'] | SplitDiffRow['right']['kind'],
  theme: LogInkTheme
): { color?: string; dimColor?: boolean } {
  if (kind === 'header') {
    if (theme.noColor) return { dimColor: true }
    return { color: theme.colors.accent }
  }
  if (kind === 'empty') {
    return { dimColor: true }
  }
  if (theme.noColor) {
    return { dimColor: kind === 'context' }
  }
  if (kind === 'add') return { color: theme.colors.gitAdded }
  if (kind === 'remove') return { color: theme.colors.gitDeleted }
  return {}
}

/**
 * Format one column of a split-diff row: an optional 4-digit line
 * number prefix + the line text, padded/truncated to the column width.
 * Empty rows render a faint `·` placeholder so the alignment gap is
 * visible at a glance.
 */
function formatSplitDiffCell(
  side: SplitDiffRow['left'] | SplitDiffRow['right'],
  columnWidth: number
): string {
  if (side.kind === 'empty') {
    const placeholder = ' · '
    return placeholder.padEnd(columnWidth)
  }
  if (side.kind === 'header') {
    return truncate(side.text, columnWidth).padEnd(columnWidth)
  }
  const lineNo = side.lineNumber !== undefined ? String(side.lineNumber).padStart(4) : '    '
  // Strip the trailing newline that some diffs include. Keeps column
  // widths predictable.
  const text = side.text.replace(/\n$/, '')
  // 4 digits + 1 space gutter = 5 chars; reserve that off the column
  // before truncating the text.
  const textRoom = Math.max(1, columnWidth - 5)
  return `${lineNo} ${truncate(text, textRoom)}`.padEnd(columnWidth)
}

/**
 * Render the split-diff body as a list of two-column rows. The caller
 * is responsible for slicing the unified-line array to the visible
 * window — the helper just transforms that slice into Ink nodes.
 */
function renderSplitDiffBody(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  unifiedSlice: string[],
  startOffset: number,
  width: number,
  theme: LogInkTheme,
  keyPrefix: string
): ReactTypes.ReactElement[] {
  const { Box, Text } = components
  const rows = buildSplitDiffRows(unifiedSlice)
  // Reserve 3 columns of gutter (1 left padding from the Box + 1 column
  // separator + 1 right padding) so neither side touches the border.
  const usable = Math.max(20, width - 4)
  const gutter = 1
  const half = Math.max(10, Math.floor((usable - gutter) / 2))
  return rows.map((row, index) => {
    const leftProps = splitDiffSideProps(row.left.kind, theme)
    const rightProps = splitDiffSideProps(row.right.kind, theme)
    const leftText = formatSplitDiffCell(row.left, half)
    const rightText = formatSplitDiffCell(row.right, half)
    return h(Box, {
      key: `${keyPrefix}-${startOffset + index}`,
      flexDirection: 'row',
    },
    h(Box, { width: half, flexShrink: 0 },
      h(Text, leftProps, leftText)
    ),
    h(Box, { width: gutter, flexShrink: 0 }, h(Text, { dimColor: true }, ' ')),
    h(Box, { width: half, flexShrink: 0 },
      h(Text, rightProps, rightText)
    )
    )
  })
}

/**
 * Pick a theme color for a single name-status code (`A`, `M`, `D`,
 * `R100`, etc.) so the inspector and commit-diff file list render with
 * familiar git colors at a glance. Letters stay in the line so the
 * meaning survives `NO_COLOR`.
 */
function statusCodeColor(status: string, theme: LogInkTheme): string | undefined {
  if (theme.noColor) {
    return undefined
  }

  const head = status.charAt(0)
  switch (head) {
    case 'A':
      return theme.colors.gitAdded
    case 'D':
      return theme.colors.gitDeleted
    case 'U':
      return theme.colors.danger
    case 'M':
    case 'T':
      return theme.colors.gitModified
    case 'R':
    case 'C':
      return theme.colors.accent
    default:
      return undefined
  }
}

function formatChangedFileStats(file: GitCommitDetail['files'][number]): string {
  if (file.binary) {
    return 'bin'
  }
  if (file.additions === undefined && file.deletions === undefined) {
    return ''
  }
  return `+${file.additions || 0}/-${file.deletions || 0}`
}

function sidebarTabLabel(tab: LogInkSidebarTab): string {
  switch (tab) {
    case 'status':
      return 'Status'
    case 'branches':
      return 'Branches'
    case 'tags':
      return 'Tags'
    case 'stashes':
      return 'Stashes'
    case 'worktrees':
      return 'Worktrees'
    default:
      return tab
  }
}

export async function startInkInteractiveLog(
  git: SimpleGit,
  rows: GitLogRow[],
  streams: LogInkStreams = {},
  options: LogInkOptions = {}
): Promise<void> {
  const input = streams.input || process.stdin
  const output = streams.output || process.stdout
  const error = streams.error || process.stderr

  // Non-TTY fallback (CI logs, piped output) needs the rows up-front
  // because the renderer just dumps a static snapshot. Run the
  // deferred loader synchronously here when present so callers get
  // the same shape regardless of the entry path.
  if (!canStartLogInkTui(input, output)) {
    const fallbackRows = options.loadRows && rows.length === 0
      ? await options.loadRows()
      : rows
    await startInteractiveLog(git, fallbackRows, {
      appLabel: options.appLabel,
      input,
      output,
    })
    return
  }

  const runtime = await loadInkRuntime()
  const { ink, React } = runtime

  // Forward declared so the lifecycle handler can call back into the React
  // tree on SIGCONT to force a repaint after the user `fg`s.
  const resumeRef: { current: (() => void) | null } = { current: null }

  const app = React.createElement(LogInkApp, {
    appLabel: options.appLabel || 'coco log',
    git,
    idleTipsEnabled: Boolean(options.idleTips),
    ink,
    initialView: options.initialView || 'history',
    logArgv: options.logArgv,
    loadRows: options.loadRows,
    React,
    rows,
    theme: createLogInkTheme(options.theme),
    resumeRef,
  })
  const instance = ink.render(app, getLogInkRenderOptions({ input, output, error }))

  const lifecycle = installTerminalLifecycle({
    input,
    output,
    instance,
    onResume: () => resumeRef.current?.(),
  })

  try {
    await instance.waitUntilExit()
  } finally {
    lifecycle.dispose()
  }
}

/**
 * Predict the filter value that a filter-mutating action would land on, so
 * the runtime can compute the post-filter selection snapshot before the
 * reducer ever runs (P4.5). Returns undefined when the action isn't a
 * filter action.
 */
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

function LogInkApp(deps: LogInkComponentDeps): ReactTypes.ReactElement {
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
    dispatch({ type: 'setStatus', value: 'generating AI commit draft' })
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
    context.branches,
    context.stashes,
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
        layout.bodyRows,
        layout.mainPanelWidth,
        theme,
        hasMoreCommits,
        loadingMoreCommits
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
    renderFooter(h, { Box, Text }, state, context, theme, idleTip)
  )
}

function renderHeader(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  context: LogInkContext,
  contextStatus: LogInkContextStatus,
  columns: number,
  theme: LogInkTheme,
  appLabel: string
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const branch = context.branches?.currentBranch || context.provider?.currentBranch || '<detached>'
  const dirty = context.branches?.dirty ? 'dirty' : 'clean'
  const repo = context.provider?.repository.owner && context.provider.repository.name
    ? `${context.provider.repository.owner}/${context.provider.repository.name}`
    : 'local repository'
  const prInfo = context.provider?.currentPullRequest || context.pullRequest?.currentPullRequest
  const prGlyph = prInfo ? getPullRequestStateGlyph(prInfo, theme) : null
  const prLabel = prInfo
    ? `PR #${prInfo.number} ${prInfo.isDraft ? 'DRAFT' : prInfo.state}`
    : 'no PR'
  const search = state.filterMode ? `search: ${state.filter}_` : state.filter ? `filter: ${state.filter}` : ''
  // Boot loading wins over the per-context loading hint because it
  // tells the user the headline thing they care about (commits aren't
  // ready yet) — the context fetches finish independently and surface
  // their own per-section loading copy in the sidebars.
  const loading = state.bootLoading
    ? '  loading commits'
    : isLogInkContextLoading(contextStatus) ? '  loading context' : ''
  const breadcrumb = formatLogInkBreadcrumb(state.viewStack)
  const view = breadcrumb ? `  ${breadcrumb}` : ''
  // Mode indicator (P2.2) — surfaces the current input mode so users
  // never wonder why `q` doesn't quit while they're editing or filtering.
  const mode = state.commitCompose.editing
    ? '[EDIT]'
    : state.filterMode
      ? '[FILTER]'
      : '[NORMAL]'
  const titlePrefix = `${appLabel}  ${repo}  ${branch}  ${dirty}  `
  const glyphPart = prGlyph?.glyph ? `${prGlyph.glyph} ` : ''
  const titleSuffix = `${view}${loading}`
  const fullTitle = `${titlePrefix}${glyphPart}${prLabel}${titleSuffix}`
  const titleBudget = columns - mode.length - 4
  const truncatedTitle = truncate(fullTitle, titleBudget)
  // Only split into colored fragments when the prefix + glyph + label all
  // fit unmodified — otherwise the truncate ellipsis can land mid-fragment
  // and we'd render half a glyph in the wrong color.
  const splitFragments = truncatedTitle === fullTitle && glyphPart.length > 0
  const modeColor = theme.noColor
    ? undefined
    : state.filterMode || state.commitCompose.editing
      ? theme.colors.warning
      : theme.colors.accent

  return h(Box, {
    borderColor: theme.colors.border,
    borderStyle: theme.borderStyle,
    height: 3,
    paddingX: 1,
  },
  splitFragments
    ? h(Text, { bold: true, color: theme.colors.accent }, titlePrefix)
    : h(Text, { bold: true, color: theme.colors.accent }, truncatedTitle),
  splitFragments
    ? h(Text, { bold: true, color: prGlyph?.color, dimColor: prGlyph?.dim }, glyphPart)
    : undefined,
  splitFragments
    ? h(Text, { bold: true, color: theme.colors.accent }, `${prLabel}${titleSuffix}`)
    : undefined,
  h(Text, { bold: true, color: modeColor }, `  ${mode}`),
  search ? h(Text, { dimColor: true }, `  ${truncate(search, 36)}`) : undefined)
}

function renderSidebar(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  context: LogInkContext,
  contextStatus: LogInkContextStatus,
  width: number,
  bodyRows: number,
  theme: LogInkTheme
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const focused = state.focus === 'sidebar'
  const tabs = getLogInkSidebarTabs()

  // Accordion layout — every tab's title is visible on its own line, but
  // only the active tab expands its content underneath. Switching tabs
  // (1-5 / [/]) collapses the previous and expands the next.
  // When sidebar focus has been promoted to the tab header (#806
  // follow-up), the active tab's title row gets selection styling
  // and the items below it render without their cursor highlight
  // (which now lives on the header).
  const headerFocused = focused && state.sidebarHeaderFocused
  const tabBlocks = tabs.flatMap((tab, tabIndex) => {
    const isActive = tab === state.sidebarTab
    const count = sidebarTabCount(tab, context)
    const labelWithCount = count !== undefined
      ? `${sidebarTabLabel(tab)} (${count})`
      : sidebarTabLabel(tab)
    const headerText = isActive ? `[${labelWithCount}]` : labelWithCount
    const headerSelected = isActive && headerFocused
    const blocks: ReactTypes.ReactElement[] = []
    if (tabIndex > 0) {
      blocks.push(h(Text, { key: `tab-spacer-${tab}` }, ''))
    }
    blocks.push(h(Text, {
      key: `tab-header-${tab}`,
      bold: isActive,
      dimColor: !isActive,
      // Selection styling on the header itself when the cursor has
      // been promoted off the items list. inverse swaps fg/bg so the
      // highlight reads as "this is the cursor target" identically
      // to how items render when focused.
      backgroundColor: headerSelected && !theme.noColor ? theme.colors.selection : undefined,
      inverse: headerSelected,
    }, headerText))
    if (isActive) {
      blocks.push(...renderActiveSidebarContent(h, Text, tab, state, context, contextStatus, width, bodyRows, theme))
    }
    return blocks
  })

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    width,
    paddingX: 1,
  },
  h(Text, { bold: true }, panelTitle('Repository', focused)),
  h(Text, undefined, ''),
  ...tabBlocks)
}

/**
 * Render the indented body of the active sidebar tab. The status tab
 * colours its summary counts (warning / danger / muted) and per-file
 * rows so they read as the same severity scale used in the main status
 * surface; every other tab falls through to `sidebarLines` for its
 * string-based summary.
 */
function renderActiveSidebarContent(
  h: typeof ReactTypes.createElement,
  Text: LogInkComponents['Text'],
  tab: LogInkSidebarTab,
  state: LogInkState,
  context: LogInkContext,
  contextStatus: LogInkContextStatus,
  width: number,
  bodyRows: number,
  theme: LogInkTheme
): ReactTypes.ReactElement[] {
  // Available rows for the active tab's list. The sidebar chrome
  // takes ~10 rows (panel title + spacer + 5 tab headers + 4 inter-tab
  // spacers); the branches tab eats 3 more for its summary header
  // (Current / Worktree / spacer). Floor of 8 keeps short terminals
  // usable; tall terminals (40+ rows) get noticeably more items.
  const sidebarChrome = 10
  const branchHeaderRows = tab === 'branches' ? 3 : 0
  const visibleListCount = Math.max(8, bodyRows - sidebarChrome - branchHeaderRows)
  if (tab === 'status') {
    return renderActiveStatusTabContent(h, Text, context, contextStatus, width, theme)
  }

  // Branches / tags / stashes / worktrees: render selectable rows so
  // ↑/↓ navigates within the sidebar list and Enter / per-entity keys
  // act on the cursored item without needing to drill into the
  // dedicated view (#791 follow-up — in-sidebar selection).
  // Items render with the cursor highlight only when the sidebar is
  // focused on this tab AND the cursor is on items (not promoted to
  // the tab header). The header-focused branch up in `renderSidebar`
  // owns the highlight in that case.
  const focused = state.focus === 'sidebar' && state.sidebarTab === tab && !state.sidebarHeaderFocused

  if (tab === 'branches') {
    if (isLogInkContextKeyLoading(contextStatus, 'branches')) {
      return [h(Text, { key: 'tab-branches-loading', dimColor: true }, '  Loading branches…')]
    }
    const branches = context.branches
    if (!branches) {
      return [h(Text, { key: 'tab-branches-empty', dimColor: true }, '  Branches unavailable')]
    }
    const sortedBranches = sortBranches(branches.localBranches, state.branchSort)
    const headerRows: ReactTypes.ReactElement[] = [
      h(Text, { key: 'tab-branches-current', dimColor: true },
        truncate(`  Current: ${branches.currentBranch || '<detached>'}`, width - 4)),
      h(Text, { key: 'tab-branches-state', dimColor: true },
        `  Worktree: ${branches.dirty ? 'dirty' : 'clean'}`),
      h(Text, { key: 'tab-branches-spacer' }, ''),
    ]
    return [
      ...headerRows,
      ...renderSelectableSidebarRows(
        h, Text, sortedBranches, state.selectedBranchIndex, focused, width, theme,
        (branch) => `${branchRowMarker(branch, { ascii: theme.ascii })} ${branch.shortName}`,
        'tab-branches', visibleListCount,
      ),
    ]
  }

  if (tab === 'tags') {
    if (isLogInkContextKeyLoading(contextStatus, 'tags')) {
      return [h(Text, { key: 'tab-tags-loading', dimColor: true }, '  Loading tags…')]
    }
    const tags = sortTags(context.tags?.tags || [], state.tagSort)
    if (tags.length === 0) {
      return [h(Text, { key: 'tab-tags-empty', dimColor: true }, '  No tags found')]
    }
    return renderSelectableSidebarRows(
      h, Text, tags, state.selectedTagIndex, focused, width, theme,
      (tag) => `${truncate(tag.name, 16)} ${tag.subject}`,
      'tab-tags', visibleListCount,
    )
  }

  if (tab === 'stashes') {
    if (isLogInkContextKeyLoading(contextStatus, 'stashes')) {
      return [h(Text, { key: 'tab-stashes-loading', dimColor: true }, '  Loading stashes…')]
    }
    const stashes = context.stashes?.stashes || []
    if (stashes.length === 0) {
      return [h(Text, { key: 'tab-stashes-empty', dimColor: true }, '  No stashes found')]
    }
    return renderSelectableSidebarRows(
      h, Text, stashes, state.selectedStashIndex, focused, width, theme,
      (stash, index) => `@{${index}} ${stash.message || '(no message)'}`,
      'tab-stashes', visibleListCount,
    )
  }

  // worktrees
  if (isLogInkContextKeyLoading(contextStatus, 'worktreeList')) {
    return [h(Text, { key: 'tab-worktrees-loading', dimColor: true }, '  Loading worktrees…')]
  }
  const worktrees = context.worktreeList?.worktrees || []
  if (worktrees.length === 0) {
    return [h(Text, { key: 'tab-worktrees-empty', dimColor: true }, '  No linked worktrees')]
  }
  return renderSelectableSidebarRows(
    h, Text, worktrees, state.selectedWorktreeListIndex, focused, width, theme,
    (worktree) => {
      const marker = worktree.current ? '*' : ' '
      const wstate = worktree.dirty ? 'dirty' : 'clean'
      return `${marker} ${worktree.branch || worktree.path} ${wstate}`
    },
    'tab-worktrees', visibleListCount,
  )
}

/**
 * Render a sliding-window list of selectable sidebar rows. The cursor
 * highlights the row at `selectedIndex` only when `focused` is true so
 * an unfocused sidebar doesn't compete visually with the active panel.
 * Sliding window keeps the cursor in view as the user navigates a long
 * list; truncation hints surface the count of hidden rows.
 */
function renderSelectableSidebarRows<T>(
  h: typeof ReactTypes.createElement,
  Text: LogInkComponents['Text'],
  items: T[],
  selectedIndex: number,
  focused: boolean,
  width: number,
  theme: LogInkTheme,
  toRowText: (item: T, index: number) => string,
  keyPrefix: string,
  visibleCount?: number,
): ReactTypes.ReactElement[] {
  if (items.length === 0) return []

  const window = getSidebarVisibleWindow(items.length, selectedIndex, visibleCount)
  const elements: ReactTypes.ReactElement[] = []

  if (window.truncatedAbove > 0) {
    elements.push(h(Text, {
      key: `${keyPrefix}-trunc-above`,
      dimColor: true,
    }, truncate(`  … ${window.truncatedAbove} more above`, width - 4)))
  }

  for (let offset = 0; offset < window.size; offset += 1) {
    const index = window.start + offset
    if (index >= items.length) break
    const isSelected = focused && index === selectedIndex
    const text = toRowText(items[index], index)
    elements.push(h(Text, {
      key: `${keyPrefix}-row-${index}`,
      backgroundColor: isSelected && !theme.noColor ? theme.colors.selection : undefined,
      inverse: isSelected,
    }, truncate(`  ${text}`, width - 4)))
  }

  if (window.truncatedBelow > 0) {
    elements.push(h(Text, {
      key: `${keyPrefix}-trunc-below`,
      dimColor: true,
    }, truncate(`  … ${window.truncatedBelow} more below`, width - 4)))
  }

  return elements
}

function renderActiveStatusTabContent(
  h: typeof ReactTypes.createElement,
  Text: LogInkComponents['Text'],
  context: LogInkContext,
  contextStatus: LogInkContextStatus,
  width: number,
  theme: LogInkTheme
): ReactTypes.ReactElement[] {
  if (isLogInkContextKeyLoading(contextStatus, 'worktree')) {
    return [h(Text, { key: 'tab-status-loading', dimColor: true }, '  Loading status…')]
  }
  const worktree = context.worktree
  if (!worktree) {
    return [h(Text, { key: 'tab-status-empty', dimColor: true }, '  Status unavailable')]
  }
  const colorOf = (state: 'staged' | 'unstaged' | 'untracked'): string | undefined => {
    if (theme.noColor) return undefined
    if (state === 'staged') return theme.colors.warning
    if (state === 'unstaged') return theme.colors.danger
    return theme.colors.muted
  }
  const summaryRow = (count: number, label: string, key: string, kind: 'staged' | 'unstaged' | 'untracked') =>
    h(Text, { key }, '  ', h(Text, { color: colorOf(kind), bold: count > 0 }, `${count} ${label}`))
  const fileRows = worktree.files.slice(0, 12).map((file, index) => {
    const codes = `${file.indexStatus}${file.worktreeStatus}`
    return h(Text, {
      key: `tab-status-file-${index}`,
      color: colorOf(file.state),
    }, truncate(`  ${codes} ${file.path}`, width - 4))
  })
  return [
    summaryRow(worktree.stagedCount, 'staged', 'tab-status-staged', 'staged'),
    summaryRow(worktree.unstagedCount, 'unstaged', 'tab-status-unstaged', 'unstaged'),
    summaryRow(worktree.untrackedCount, 'untracked', 'tab-status-untracked', 'untracked'),
    ...(fileRows.length
      ? [h(Text, { key: 'tab-status-spacer' }, ''), ...fileRows]
      : []),
  ]
}

function renderMainPanel(
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

function renderHistoryPanel(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  context: LogInkContext,
  bodyRows: number,
  width: number,
  theme: LogInkTheme,
  hasMoreCommits: boolean,
  loadingMoreCommits: boolean
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const focused = state.focus === 'commits'
  const worktree = context.worktree
  const worktreeDirty = Boolean(
    worktree && (worktree.stagedCount + worktree.unstagedCount + worktree.untrackedCount) > 0
  )
  // The synthetic "(+) new commit" row only appears when the worktree is
  // dirty AND the visible window is anchored at the top of the list — i.e.
  // the first real commit (selectedIndex 0) is in view. Scroll past that
  // and the row slides off naturally; the user can `gg` to bring it back.
  const showPendingRow = worktreeDirty &&
    !state.filter &&
    state.selectedIndex === 0
  const listRows = Math.max(3, bodyRows - (showPendingRow ? 5 : 4))
  const visible = getVisibleLogInkHistory(state, listRows)
  const loadState = loadingMoreCommits
    ? 'loading older commits'
    : hasMoreCommits
      ? 'more below'
      : 'loaded'
  const title = `${state.filteredCommits.length}/${state.commits.length} commits`
  const graphMode = state.fullGraph ? 'full graph' : 'compact graph'

  const pendingRowSelected = showPendingRow && Boolean(state.pendingCommitFocused) && focused
  // Real-commit selection is suppressed while the cursor is on the pending
  // row so the visible cursor only renders in one place at a time.
  const realSelectionSuppressed = state.pendingCommitFocused

  const pendingNode = showPendingRow
    ? renderPendingCommitRow(h, Text, worktree!, pendingRowSelected, theme)
    : null

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    flexShrink: 0,
    paddingX: 1,
    width,
  },
  h(Box, { justifyContent: 'space-between' },
    h(Text, { bold: true }, panelTitle('Commits', focused)),
    h(Text, { dimColor: true }, `${title} | ${graphMode} | ${loadState}`)
  ),
  // Server-side filter indicator (#776). Only rendered when the user
  // has an active path:/author: prefix; clears when they Ctrl+U.
  ...(state.historyFetchArgs
    ? [h(Text, { key: 'history-fetch-indicator', dimColor: true },
        `filter: ${formatHistoryFetchArgs(state.historyFetchArgs)}  (ctrl+u in / to clear)`)]
    : []),
  ...(pendingNode ? [pendingNode] : []),
  visible.items.length === 0
    ? h(Text, { dimColor: true }, state.bootLoading
        ? formatLogInkLoading({ resource: 'commits' })
        : formatLogInkHistoryEmpty({
          filter: state.filter,
          totalCommits: state.commits.length,
        }))
    : visible.items.map((item, index) => {
      if (item.type === 'graph') {
        // Graph-only rows are git's lane-closure scaffolding (`|/`,
        // `|\`, etc.) — they're real topology but visually they look
        // like blank rows that the user might wonder if they
        // accidentally skipped a commit on (#831). Render dim-on-dim
        // so they retreat as connectors rather than competing with
        // commit rows for the eye's attention.
        if (item.laneSegments && !theme.ascii) {
          return h(Text, { key: `graph-${index}-${item.graph}`, dimColor: true },
            ...renderLaneSegmentSpans(
              h, Text, item.laneSegments, theme, visible.graphWidth, `g${index}`,
              { forceDim: true }
            ))
        }
        return h(Text, {
          key: `graph-${index}-${item.graph}`,
          color: theme.noColor ? undefined : theme.colors.muted,
          dimColor: true,
        }, truncate(substituteGraphChars(
          item.graph.padEnd(visible.graphWidth),
          { ascii: theme.ascii }
        ), Math.max(8, width - 4)))
      }

      return renderCommitHistoryRow(
        h, Text, item.commit, item.graph, visible.graphWidth,
        Boolean(item.selected) && !realSelectionSuppressed, theme, index,
        width, item.laneSegments
      )
    }))
}

/**
 * Render `LaneSegment[]` as a flat list of Text spans, one per lane
 * (#791 stage 2). Each segment paints in its lane's palette color so
 * the eye can follow a branch column-by-column; segments without a
 * lane id (spaces, padding, decorations) fall back to the muted graph
 * color so they visually recede.
 *
 * Final padding is appended as its own span so callers do not need to
 * pre-pad the graph string before computing lane segments.
 */
function renderLaneSegmentSpans(
  h: typeof ReactTypes.createElement,
  Text: LogInkComponents['Text'],
  segments: LaneSegment[],
  theme: LogInkTheme,
  padTo: number,
  keyPrefix: string,
  options: { forceDim?: boolean } = {}
): ReactTypes.ReactElement[] {
  const muted = theme.noColor ? undefined : theme.colors.muted
  const elements: ReactTypes.ReactElement[] = []
  let totalLen = 0

  segments.forEach((seg, idx) => {
    const laneColor = getLaneColor(seg.laneId, theme)
    elements.push(h(Text, {
      key: `${keyPrefix}-${idx}`,
      color: laneColor ?? muted,
      // Ink does not cascade dimColor from a parent Text to children,
      // so the caller's "this whole row should fade" intent has to
      // travel here as an explicit flag (#831). Used for graph-only
      // lane-closure rows, where the lane colors otherwise compete
      // for attention with the commits they connect.
      dimColor: options.forceDim || (theme.noColor && seg.laneId === undefined),
    }, seg.text))
    totalLen += seg.text.length
  })

  if (padTo > totalLen) {
    elements.push(h(Text, { key: `${keyPrefix}-pad` }, ' '.repeat(padTo - totalLen)))
  }

  return elements
}

/**
 * Render a single commit row with each segment in its own colored span.
 * Graph chars render in `theme.colors.muted` so the topology visually
 * recedes; shortHash takes the accent so the eye lands on the commit
 * identifier first; date is dimmed; message is normal; ref labels
 * (`[HEAD -> main]`) trail in accent. Selection styling is applied at
 * the outer span via `backgroundColor` / `inverse` so the highlight
 * fills the whole row regardless of inner-span coloring.
 *
 * Truncation is per-segment so the variable-length message field gets
 * the leftover budget after fixed segments are accounted for.
 */
function renderCommitHistoryRow(
  h: typeof ReactTypes.createElement,
  Text: LogInkComponents['Text'],
  commit: GitLogCommitRow,
  graph: string,
  graphWidth: number,
  selected: boolean,
  theme: LogInkTheme,
  index: number,
  panelWidth: number,
  laneSegments?: LaneSegment[]
): ReactTypes.ReactElement {
  const refs = formatInkRefLabels(commit.refs)
  // Total cells available to the row content. Earlier revisions used a
  // hardcoded 140 here, which let row content overflow whenever the
  // panel was narrower than that — Ink would wrap onto a second visual
  // line and the next commit's graph indicator landed against the wrap
  // continuation rather than its own commit (#830). Subtracting 4
  // accounts for the panel's left + right border + 1-cell padding.
  const totalWidth = Math.max(20, panelWidth - 4)
  const fixedWidth = graphWidth + 1 + commit.shortHash.length + 1 + commit.date.length + 1
  // Refs trail the message and shrink first when the row is narrow:
  // the user can always see the full ref list in the inspector, so
  // the headline subject keeps priority over decoration.
  const refsRoom = Math.max(0, totalWidth - fixedWidth - 8)
  const refsTrunc = refs ? truncate(refs, refsRoom) : ''
  const messageRoom = Math.max(8, totalWidth - fixedWidth - cellWidth(refsTrunc))
  const message = truncate(commit.message, messageRoom)

  const selectedBg = selected && !theme.noColor ? theme.colors.selection : undefined
  const accent = theme.noColor ? undefined : theme.colors.accent
  const muted = theme.noColor ? undefined : theme.colors.muted

  // Lane-colored graph spans when full graph mode + non-ASCII rendering
  // is in play; otherwise fall back to the legacy single-muted span so
  // compact mode and legacy terminals stay visually unchanged.
  const graphChildren = laneSegments && !theme.ascii
    ? renderLaneSegmentSpans(h, Text, laneSegments, theme, graphWidth, `c${index}`)
    : [h(Text, { color: muted, dimColor: theme.noColor },
        substituteGraphChars(graph.padEnd(graphWidth), { ascii: theme.ascii }))]

  return h(Text, {
    key: `${commit.hash}-${index}`,
    backgroundColor: selectedBg,
    inverse: selected,
  },
  ...graphChildren,
  ' ',
  h(Text, { color: accent, bold: selected }, commit.shortHash),
  ' ',
  h(Text, { dimColor: true }, commit.date),
  ' ',
  h(Text, undefined, message),
  refsTrunc ? h(Text, { color: accent }, refsTrunc) : null)
}

/**
 * Render the synthetic "(+) new commit" affordance shown above the real
 * commit list when the worktree is dirty. Pressing up at `selectedIndex 0`
 * focuses this row; pressing Enter pushes the status view so the user can
 * stage / commit.
 */
function renderPendingCommitRow(
  h: typeof ReactTypes.createElement,
  Text: LogInkComponents['Text'],
  worktree: NonNullable<LogInkContext['worktree']>,
  selected: boolean,
  theme: LogInkTheme
): ReactTypes.ReactElement {
  const parts: string[] = []
  if (worktree.stagedCount) {
    parts.push(`${worktree.stagedCount} staged`)
  }
  if (worktree.unstagedCount) {
    parts.push(`${worktree.unstagedCount} unstaged`)
  }
  if (worktree.untrackedCount) {
    parts.push(`${worktree.untrackedCount} untracked`)
  }
  const summary = parts.length ? parts.join(' · ') : 'pending changes'
  const label = `${theme.ascii ? '[+]' : '(+)'} New commit · ${summary}`

  return h(Text, {
    key: 'pending-commit-row',
    bold: true,
    color: theme.noColor ? undefined : theme.colors.accent,
    inverse: selected,
    backgroundColor: selected && !theme.noColor ? theme.colors.selection : undefined,
  }, truncate(label, 140))
}

// Row descriptor for the status surface's grouped layout. Each
// rendered row is either a group header (e.g. "▾ Unstaged (3)") or a
// file under that group; both are first-class cursor targets.
type StatusSurfaceRow =
  | { kind: 'header'; group: WorktreeFileGroup }
  | { kind: 'file'; group: WorktreeFileGroup; file: WorktreeFile; flatIndex: number }

function buildStatusSurfaceRows(groups: WorktreeFileGroup[]): StatusSurfaceRow[] {
  const rows: StatusSurfaceRow[] = []
  for (const group of groups) {
    rows.push({ kind: 'header', group })
    group.files.forEach((file, offset) => {
      rows.push({ kind: 'file', group, file, flatIndex: group.startIndex + offset })
    })
  }
  return rows
}

function renderConflictsSurface(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  context: LogInkContext,
  contextStatus: LogInkContextStatus,
  bodyRows: number,
  width: number,
  theme: LogInkTheme
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const focused = state.focus === 'commits'
  const loading = isLogInkContextKeyLoading(contextStatus, 'operation')
  const operation = context.operation
  const conflictedFiles = operation?.conflictedFiles || []
  const operationType = operation?.operation || 'none'

  // If no operation is in progress, show a fallback message.
  if (!loading && operationType === 'none') {
    return h(Box, {
      borderColor: focusBorderColor(theme, focused),
      borderStyle: theme.borderStyle,
      flexDirection: 'column',
      flexShrink: 0,
      paddingX: 1,
      width,
    },
    h(Box, { justifyContent: 'space-between' },
      h(Text, { bold: true }, panelTitle('Conflicts', focused)),
      h(Text, { dimColor: true }, 'no operation in progress')
    ),
    h(Text, { key: 'conflicts-empty', dimColor: true },
      'No merge, rebase, cherry-pick, or revert in progress.'
    ))
  }

  // All conflicts resolved — show the "continue" hint.
  if (!loading && conflictedFiles.length === 0 && operationType !== 'none') {
    return h(Box, {
      borderColor: focusBorderColor(theme, focused),
      borderStyle: theme.borderStyle,
      flexDirection: 'column',
      flexShrink: 0,
      paddingX: 1,
      width,
    },
    h(Box, { justifyContent: 'space-between' },
      h(Text, { bold: true }, panelTitle('Conflicts', focused)),
      h(Text, { dimColor: true }, `${operationType} — all conflicts resolved`)
    ),
    h(Text, { key: 'conflicts-hint', dimColor: true },
      `All conflicts resolved. Press C to continue the ${operationType}, or < to go back.`
    ))
  }

  const selected = Math.max(0, Math.min(state.selectedConflictFileIndex, Math.max(0, conflictedFiles.length - 1)))
  const listRows = Math.max(4, bodyRows - 4)
  const startIndex = Math.max(0, selected - Math.floor(listRows / 2))
  const visible = conflictedFiles.slice(startIndex, startIndex + listRows)
  const remaining = conflictedFiles.length
  const headerRight = loading
    ? 'loading conflicts'
    : `${operationType} — ${remaining} ${remaining === 1 ? 'conflict' : 'conflicts'} remaining`

  const statusLabel = (file: { indexStatus: string; worktreeStatus: string }): string => {
    const code = `${file.indexStatus}${file.worktreeStatus}`
    switch (code) {
      case 'UU': return 'both modified'
      case 'AA': return 'added by both'
      case 'DD': return 'both deleted'
      case 'AU': case 'UA': return 'added by one'
      case 'DU': return 'deleted by us'
      case 'UD': return 'deleted by them'
      default: return code
    }
  }

  const lines: ReactTypes.ReactNode[] = loading
    ? [h(Text, { key: 'conflicts-loading', dimColor: true }, formatLogInkLoading({ resource: 'conflicts' }))]
    : visible.map((file, offset) => {
      const index = startIndex + offset
      const isSelected = index === selected
      const cursor = isSelected ? '>' : ' '
      const code = `${file.indexStatus}${file.worktreeStatus}`
      const label = statusLabel(file)
      return h(Text, {
        key: `conflict-${index}`,
        bold: isSelected,
        dimColor: !isSelected,
      }, truncate(
        `${cursor} ${code} ${file.path}  (${label})`,
        width - 4
      ))
    })

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    flexShrink: 0,
    paddingX: 1,
    width,
  },
  h(Box, { justifyContent: 'space-between' },
    h(Text, { bold: true }, panelTitle('Conflicts', focused)),
    h(Text, { dimColor: true }, headerRight)
  ),
  ...lines)
}

function renderStatusSurface(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  context: LogInkContext,
  contextStatus: LogInkContextStatus,
  bodyRows: number,
  width: number,
  theme: LogInkTheme
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const focused = state.focus === 'commits'
  const worktree = context.worktree
  // Apply the status visibility mask (#776) at render time so the
  // rendered rows match the filtered count the input context already
  // uses for j/k navigation. `visibleFiles` may be a strict subset of
  // worktree.files when the user has narrowed via 1/2/3.
  const visibleFiles = applyStatusFilterMask(worktree?.files || [], state.statusFilterMask)
  // Group + canonical-sort. The runtime + input handler agree on this
  // order so a `selectedWorktreeFileIndex` of N always points to the
  // same file across all three (renderer / input / workflow handlers).
  const visibleGroups = groupWorktreeFiles(visibleFiles)
  const surfaceRows = buildStatusSurfaceRows(visibleGroups)
  const listRows = Math.max(4, bodyRows - 5)
  const selectedIndex = state.selectedWorktreeFileIndex
  const headerFocused = state.statusGroupHeaderFocused
  // Resolve the cursor's row index in the flat (header-and-file) row
  // list. Used to window the visible slice around the cursor.
  const cursorRowIndex = (() => {
    if (!surfaceRows.length) return 0
    const currentGroup = visibleGroups.find((group) =>
      selectedIndex >= group.startIndex && selectedIndex < group.startIndex + group.files.length
    )
    if (!currentGroup) return 0
    if (headerFocused) {
      const idx = surfaceRows.findIndex((row) => row.kind === 'header' && row.group === currentGroup)
      return idx >= 0 ? idx : 0
    }
    const idx = surfaceRows.findIndex((row) => row.kind === 'file' && row.flatIndex === selectedIndex)
    return idx >= 0 ? idx : 0
  })()
  const cleanHint = formatLogInkStatusEmpty({ hasChanges: Boolean(worktree?.files.length) })
  const windowStart = Math.max(
    0,
    Math.min(
      Math.max(0, surfaceRows.length - listRows),
      cursorRowIndex - Math.floor(listRows / 2)
    )
  )
  const isLoading = isLogInkContextKeyLoading(contextStatus, 'worktree')
  const renderedRows: ReactTypes.ReactNode[] = isLoading || !surfaceRows.length
    ? []
    : surfaceRows.slice(windowStart, windowStart + listRows).map((row, offset) => {
      const rowIndex = windowStart + offset
      if (row.kind === 'header') {
        const groupContainsCursor =
          selectedIndex >= row.group.startIndex &&
          selectedIndex < row.group.startIndex + row.group.files.length
        const headerSelected = focused && headerFocused && groupContainsCursor
        const arrow = theme.ascii ? '>' : '▾'
        const groupLabel = capitalizeGroupName(row.group.state)
        const text = `  ${arrow} ${groupLabel} (${row.group.files.length})`
        return h(Text, {
          key: `status-group-${row.group.state}-${rowIndex}`,
          bold: true,
          dimColor: !headerSelected && rowIndex > cursorRowIndex,
          backgroundColor: headerSelected && !theme.noColor ? theme.colors.selection : undefined,
          inverse: headerSelected,
        }, truncate(text, 140))
      }
      const isSelected = !headerFocused && row.flatIndex === selectedIndex
      const cursorPart = `${isSelected ? '>' : ' '} `
      const dotColor = getStageStatusDotColor(row.file.state, theme)
      const useDot = dotColor !== undefined
      const dotCells = useDot ? cellWidth(STAGE_STATUS_DOT) + 1 : 0
      const tail = `${row.file.indexStatus}${row.file.worktreeStatus} ${row.file.path}`
      const tailTrunc = truncate(tail, Math.max(0, 140 - cellWidth(cursorPart) - dotCells - 2))
      return h(Text, {
        key: `status-file-${row.flatIndex}-${rowIndex}`,
        dimColor: !isSelected && rowIndex > cursorRowIndex,
        backgroundColor: isSelected && focused && !theme.noColor ? theme.colors.selection : undefined,
        inverse: isSelected && focused,
      },
      `  ${cursorPart}`,
      ...(useDot ? [h(Text, { color: dotColor }, STAGE_STATUS_DOT), ' '] : []),
      tailTrunc)
    })
  // When the mask narrows the list to nothing but the underlying repo
  // is non-clean, surface why the panel looks empty so the user can
  // un-narrow rather than wonder if the repo is actually clean.
  const maskHidesAll =
    Boolean(worktree?.files.length) && visibleFiles.length === 0
  const fallbackLines = isLoading
    ? [formatLogInkLoading({ resource: 'worktree status' })]
    : visibleFiles.length
      ? []
      : maskHidesAll
        ? [`No files match the active filter (${formatStatusFilterMask(state.statusFilterMask)}). Press 1/2/3 to widen.`]
        : cleanHint
          ? [cleanHint]
          : ['Worktree clean']

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    flexShrink: 0,
    paddingX: 1,
    width,
  },
  h(Box, { justifyContent: 'space-between' },
    h(Text, { bold: true }, panelTitle('Worktree', focused)),
    h(Text, { dimColor: true }, worktree
      ? `${worktree.stagedCount} staged | ${worktree.unstagedCount} unstaged | ${worktree.untrackedCount} untracked`
      : 'status loading')
  ),
  // Mask indicator (#776). Only rendered when the mask is narrower
  // than the all-on default — keeps the chrome clean for users who
  // never touch the filter.
  ...(isStatusFilterMaskActive(state.statusFilterMask)
    ? [h(Text, { key: 'status-mask-indicator', dimColor: true },
        `filter: ${formatStatusFilterMask(state.statusFilterMask)}  (1/2/3 to toggle)`)]
    : []),
  ...renderedRows,
  ...fallbackLines.map((line, index) => h(Text, {
    key: `status-surface-fallback-${index}`,
    dimColor: index > 0,
  }, truncate(line, 140))))
}

function capitalizeGroupName(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function isStatusFilterMaskActive(mask: LogInkStatusFilterMask): boolean {
  return !mask.staged || !mask.unstaged || !mask.untracked
}

function formatStatusFilterMask(mask: LogInkStatusFilterMask): string {
  const active: string[] = []
  if (mask.staged) active.push('staged')
  if (mask.unstaged) active.push('unstaged')
  if (mask.untracked) active.push('untracked')
  return active.join(' + ') || 'none'
}

function formatHistoryFetchArgs(args: LogInkHistoryFetchArgs): string {
  const parts: string[] = []
  if (args.author) parts.push(`--author=${args.author}`)
  if (args.path) parts.push(`-- ${args.path}`)
  return parts.join(' ') || 'none'
}

function renderComposeSurface(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  context: LogInkContext,
  contextStatus: LogInkContextStatus,
  bodyRows: number,
  width: number,
  theme: LogInkTheme
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const compose = state.commitCompose
  const focused = state.focus === 'commits'
  const worktree = context.worktree
  const statusLine = isLogInkContextKeyLoading(contextStatus, 'worktree')
    ? 'Status loading'
    : worktree
      ? `${worktree.stagedCount} staged | ${worktree.unstagedCount} unstaged | ${worktree.untrackedCount} untracked`
      : 'No worktree info yet'
  const summaryCursor = compose.editing && compose.field === 'summary' ? '_' : ''
  const bodyCursor = compose.editing && compose.field === 'body' ? '_' : ''
  const bodyRowsAvailable = Math.max(4, bodyRows - 10)
  // Wrap each source line of the body to the panel width so long messages
  // line-wrap inside the compose surface instead of getting trimmed by an
  // outer truncate(line, 140). The 2-space indent eats 2 cells; chrome
  // (border + paddingX) eats 4 — same budget as renderCommitPanel.
  const bodyTextWidth = Math.max(8, width - 6)
  const bodyVisualLines = compose.body
    ? compose.body.split('\n').flatMap((line) => wrapCells(line, bodyTextWidth)).slice(0, bodyRowsAvailable)
    : ['<empty>']
  const summaryVisualLines = wrapCells(
    `${compose.summary || '<empty>'}${summaryCursor}`,
    Math.max(8, width - 11) // "Summary  " (9) + 2 chrome = 11
  )
  const stateLine = compose.editing
    ? 'Editing — Enter switches summary↔body, Esc exits edit mode.'
    : 'Press e to edit, c to commit, I for AI draft, esc to leave.'
  const hasStagedFiles = (worktree?.files || [])
    .some((file) => file.indexStatus !== ' ' && file.indexStatus !== '?')
  // Staged file list is rendered in the right Worktree panel
  // (renderComposeContextPanel); duplicating it here was confusing.
  // Keep only the actionable "stage something first" hint when nothing is
  // staged yet.
  const noStagedHint = !isLogInkContextKeyLoading(contextStatus, 'worktree')
    ? formatLogInkComposeEmpty({ hasStaged: hasStagedFiles })
    : undefined

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    flexShrink: 0,
    paddingX: 1,
    width,
  },
  h(Box, { justifyContent: 'space-between' },
    h(Text, { bold: true }, panelTitle('Compose commit', focused)),
    h(Text, { dimColor: true }, statusLine)
  ),
  h(Text, undefined, ''),
  h(Text, {
    bold: compose.field === 'summary' && compose.editing,
  }, `Summary  ${summaryVisualLines[0] || ''}`),
  ...summaryVisualLines.slice(1).map((line, index) => h(Text, {
    key: `compose-summary-${index}`,
    bold: compose.field === 'summary' && compose.editing,
  }, `         ${line}`)),
  h(Text, undefined, ''),
  h(Text, {
    bold: compose.field === 'body' && compose.editing,
  }, 'Body'),
  ...bodyVisualLines.map((line, index) => {
    const isLast = index === bodyVisualLines.length - 1
    return h(Text, {
      key: `compose-body-${index}`,
      dimColor: line === '<empty>',
    }, `  ${line}${bodyCursor && isLast ? bodyCursor : ''}`)
  }),
  // Loading indicator + post-action message belong inline with the draft
  // (they describe what just happened to the fields above). The state-
  // line ("Editing — Enter switches summary↔body…" / "Press e to edit
  // …") is footer-style guidance and now sits at the very bottom of the
  // pane so it doesn't visually separate the body from any
  // result/details.
  ...(compose.loading
    ? [
      h(Text, undefined, ''),
      h(Text, {
        key: 'compose-loading',
        bold: true,
        color: theme.noColor ? undefined : theme.colors.accent,
      }, theme.ascii
        ? '[...] Generating AI commit draft (this can take a moment)'
        : '⏳ Generating AI commit draft… (this can take a moment)'),
    ]
    : []),
  ...(compose.message ? [h(Text, undefined, ''), h(Text, { key: 'compose-msg' }, truncate(compose.message, 140))] : []),
  ...(compose.details || []).map((line, index) => h(Text, {
    key: `compose-detail-${index}`,
    dimColor: true,
  }, truncate(`  ${line}`, 140))),
  ...(!hasStagedFiles && noStagedHint
    ? [
      h(Text, { key: 'compose-no-staged-spacer' }, ''),
      h(Text, { key: 'compose-no-staged', dimColor: true }, truncate(noStagedHint, 140)),
    ]
    : []),
  h(Box, { flexGrow: 1 }),
  h(Text, { key: 'compose-stateline', dimColor: true }, truncate(stateLine, width - 4)))
}

function matchesPromotedFilter(haystacks: string[], filter: string): boolean {
  if (!filter.trim()) {
    return true
  }
  const needle = filter.toLowerCase()
  return haystacks.some((value) => value.toLowerCase().includes(needle))
}

function renderBranchesSurface(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  context: LogInkContext,
  contextStatus: LogInkContextStatus,
  bodyRows: number,
  width: number,
  theme: LogInkTheme
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const focused = state.focus === 'commits'
  const branches = context.branches
  const loading = isLogInkContextKeyLoading(contextStatus, 'branches')
  const sortedAll = sortBranches(branches?.localBranches || [], state.branchSort)
  const localBranches = state.filter
    ? sortedAll.filter((branch) =>
      matchesPromotedFilter([branch.shortName, branch.upstream || ''], state.filter)
    )
    : sortedAll
  const selected = Math.max(0, Math.min(state.selectedBranchIndex, Math.max(0, localBranches.length - 1)))
  const listRows = Math.max(4, bodyRows - 4)
  const startIndex = Math.max(0, selected - Math.floor(listRows / 2))
  const visible = localBranches.slice(startIndex, startIndex + listRows)
  const filterLabel = state.filter ? ` | filter: ${state.filter}` : ''
  const sortLabel = ` | ${formatSortIndicator(state.branchSort, { ascii: theme.ascii })}`
  const headerRight = loading
    ? 'loading branches'
    : `${localBranches.length}/${sortedAll.length} local | current: ${branches?.currentBranch || '<detached>'}${filterLabel}${sortLabel}`
  const emptyLabel = formatLogInkBranchesEmpty({ filter: state.filter })
  const loadingLabel = formatLogInkLoading({ resource: 'branches' })
  // Per-column width derived from the visible window (#833) so columns
  // align across rows regardless of name length. Padded to the longest
  // name in view so short rows fill out instead of leaving a gutter;
  // capped at 40 cells so one runaway long branch name doesn't blow
  // out the timestamp column entirely (longer names get truncated and
  // the timestamp stays where the user expects it).
  const nameColWidth = visible.length === 0
    ? 28
    : Math.min(40, Math.max(8, ...visible.map((branch) => branch.shortName.length)))
  const lines: ReactTypes.ReactNode[] = loading
    ? [h(Text, { key: 'branches-loading', dimColor: true }, loadingLabel)]
    : localBranches.length === 0
      ? [h(Text, { key: 'branches-empty', dimColor: true }, emptyLabel)]
      : visible.map((branch, offset) => {
        const index = startIndex + offset
        const isSelected = index === selected
        const cursor = isSelected ? '>' : ' '
        const marker = branchRowMarker(branch, { ascii: theme.ascii })
        const divergence = formatBranchDivergence(branch, { ascii: theme.ascii })
        const lastTouched = formatBranchLastTouched(branch.date, new Date())
        // Split the row into spans so the timestamp stays dim even on the
        // currently-selected (bold) row. The leading marker + name keep
        // their per-window-derived column widths; the timestamp is
        // right-padded so the divergence column stays aligned across rows.
        const namePadded = truncate(branch.shortName, nameColWidth).padEnd(nameColWidth)
        const timestampPadded = lastTouched.padEnd(8)
        const lineDim = !isSelected && !branch.current
        const head = `${cursor} ${marker} ${namePadded} `
        const trailingDivergence = divergence ? ` ${divergence}` : ''
        // Truncate the assembled line to the actual panel width so a
        // narrow inspector / sidebar focus doesn't push branch rows
        // onto a second visual line (#830).
        const fullText = `${head}${timestampPadded}${trailingDivergence}`
        const truncated = truncate(fullText, Math.max(20, width - 4))
        // If truncation chopped into the timestamp/divergence portion,
        // fall back to a single Text to keep the visible width honest.
        if (truncated !== fullText) {
          return h(Text, {
            key: `branch-${index}`,
            bold: isSelected,
            dimColor: lineDim,
          }, truncated)
        }
        return h(Text, {
          key: `branch-${index}`,
          bold: isSelected,
          dimColor: lineDim,
        },
        head,
        h(Text, { dimColor: true }, timestampPadded),
        trailingDivergence
        )
      })

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    flexShrink: 0,
    paddingX: 1,
    width,
  },
  h(Box, { justifyContent: 'space-between' },
    h(Text, { bold: true }, panelTitle('Branches', focused)),
    h(Text, { dimColor: true }, headerRight)
  ),
  ...renderPromotedFilterAffordance(h, Text, state, theme),
  ...lines)
}

function renderTagsSurface(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  context: LogInkContext,
  contextStatus: LogInkContextStatus,
  bodyRows: number,
  width: number,
  theme: LogInkTheme
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const focused = state.focus === 'commits'
  const loading = isLogInkContextKeyLoading(contextStatus, 'tags')
  const sortedAll = sortTags(context.tags?.tags || [], state.tagSort)
  const tags = state.filter
    ? sortedAll.filter((tag) => matchesPromotedFilter([tag.name, tag.subject], state.filter))
    : sortedAll
  const selected = Math.max(0, Math.min(state.selectedTagIndex, Math.max(0, tags.length - 1)))
  const listRows = Math.max(4, bodyRows - 4)
  const startIndex = Math.max(0, selected - Math.floor(listRows / 2))
  const visible = tags.slice(startIndex, startIndex + listRows)
  const filterLabel = state.filter ? ` | filter: ${state.filter}` : ''
  const sortLabel = ` | ${formatSortIndicator(state.tagSort, { ascii: theme.ascii })}`
  const headerRight = loading
    ? 'loading tags'
    : `${tags.length}/${sortedAll.length} tags${filterLabel}${sortLabel}`
  const emptyLabel = formatLogInkTagsEmpty({ filter: state.filter })
  const loadingLabel = formatLogInkLoading({ resource: 'tags' })
  // Per-window name column width (#833) so short tags don't leave a
  // wide gutter and long tags don't push the subject off-screen. Cap
  // matches the branches surface for visual consistency across the
  // promoted views.
  const tagNameColWidth = visible.length === 0
    ? 20
    : Math.min(40, Math.max(8, ...visible.map((tag) => tag.name.length)))
  const lines: ReactTypes.ReactNode[] = loading
    ? [h(Text, { key: 'tags-loading', dimColor: true }, loadingLabel)]
    : tags.length === 0
      ? [h(Text, { key: 'tags-empty', dimColor: true }, emptyLabel)]
      : visible.map((tag, offset) => {
        const index = startIndex + offset
        const isSelected = index === selected
        const cursor = isSelected ? '>' : ' '
        // P5.1 — link the tag name to its GitHub tree page when we know
        // the remote. Truncation runs on the visible (pre-OSC) text;
        // formatHyperlink wraps just the tag name, leaving width math
        // intact.
        const url = buildRefUrl(context.provider?.repository, tag.name)
        const namePadded = truncate(tag.name, tagNameColWidth).padEnd(tagNameColWidth)
        const lineText = truncate(
          `${cursor} ${namePadded} ${tag.subject}`,
          Math.max(20, width - 4)
        )
        if (!url || lineText.indexOf(namePadded) < 0) {
          return h(Text, {
            key: `tag-${index}`,
            bold: isSelected,
            dimColor: !isSelected,
          }, lineText)
        }
        const linkStart = lineText.indexOf(namePadded)
        const before = lineText.slice(0, linkStart)
        const after = lineText.slice(linkStart + namePadded.length)
        return h(Text, {
          key: `tag-${index}`,
          bold: isSelected,
          dimColor: !isSelected,
        }, before, formatHyperlink(namePadded, url), after)
      })

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    flexShrink: 0,
    paddingX: 1,
    width,
  },
  h(Box, { justifyContent: 'space-between' },
    h(Text, { bold: true }, panelTitle('Tags', focused)),
    h(Text, { dimColor: true }, headerRight)
  ),
  ...renderPromotedFilterAffordance(h, Text, state, theme),
  ...lines)
}

/**
 * Promoted reflog browser (#781). Mirrors `renderTagsSurface` visually
 * — same header / filter affordance / footer hint conventions — but
 * lays out four columns per row: relative date, action prefix, short
 * hash, and message. Filtering matches against all four (so typing
 * "checkout" narrows to checkout entries, "abc" narrows to a hash).
 *
 * Per-row layout uses fixed column widths derived from the visible
 * window so short-action rows don't leave a wide gutter and long
 * actions don't push the message off-screen. The cap mirrors the
 * tags surface's name-column treatment.
 */
function renderReflogSurface(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  context: LogInkContext,
  contextStatus: LogInkContextStatus,
  bodyRows: number,
  width: number,
  theme: LogInkTheme
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const focused = state.focus === 'commits'
  const loading = isLogInkContextKeyLoading(contextStatus, 'reflog')
  const allEntries = context.reflog?.entries || []
  const entries = state.filter
    ? allEntries.filter((entry) => matchesPromotedFilter(
      [entry.selector, entry.hash, entry.relativeDate, entry.subject],
      state.filter
    ))
    : allEntries
  const selected = Math.max(0, Math.min(state.selectedReflogIndex, Math.max(0, entries.length - 1)))
  const listRows = Math.max(4, bodyRows - 4)
  const startIndex = Math.max(0, selected - Math.floor(listRows / 2))
  const visible = entries.slice(startIndex, startIndex + listRows)
  const filterLabel = state.filter ? ` | filter: ${state.filter}` : ''
  const headerRight = loading
    ? 'loading reflog'
    : `${entries.length}/${allEntries.length} entries${filterLabel}`
  const emptyLabel = formatLogInkReflogEmpty({ filter: state.filter })
  const loadingLabel = formatLogInkLoading({ resource: 'reflog' })

  // Column widths derived from the visible window. The hash column is
  // fixed (short SHA is always 7 chars) and the date column caps so
  // "X minutes ago" / "Y hours ago" stays readable without dominating
  // the row. Action column scales to the longest visible action so
  // commit / checkout / merge align cleanly.
  const splitVisible = visible.map((entry) => ({
    entry,
    parts: splitReflogSubject(entry.subject),
  }))
  const dateColWidth = splitVisible.length === 0
    ? 16
    : Math.min(20, Math.max(6, ...splitVisible.map(({ entry }) => entry.relativeDate.length)))
  const actionColWidth = splitVisible.length === 0
    ? 12
    : Math.min(24, Math.max(6, ...splitVisible.map(({ parts }) => parts.action.length)))
  const hashColWidth = 8

  const lines: ReactTypes.ReactNode[] = loading
    ? [h(Text, { key: 'reflog-loading', dimColor: true }, loadingLabel)]
    : entries.length === 0
      ? [h(Text, { key: 'reflog-empty', dimColor: true }, emptyLabel)]
      : splitVisible.map(({ entry, parts }, offset) => {
        const index = startIndex + offset
        const isSelected = index === selected
        const cursor = isSelected ? '>' : ' '
        const datePadded = truncate(entry.relativeDate, dateColWidth).padEnd(dateColWidth)
        const actionPadded = truncate(parts.action, actionColWidth).padEnd(actionColWidth)
        const hashPadded = truncate(entry.hash, hashColWidth).padEnd(hashColWidth)
        const message = parts.message || entry.subject
        const lineText = truncate(
          `${cursor} ${datePadded} ${actionPadded} ${hashPadded} ${message}`,
          Math.max(20, width - 4)
        )
        return h(Text, {
          key: `reflog-${index}`,
          bold: isSelected,
          dimColor: !isSelected,
        }, lineText)
      })

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    flexShrink: 0,
    paddingX: 1,
    width,
  },
  h(Box, { justifyContent: 'space-between' },
    h(Text, { bold: true }, panelTitle('Reflog', focused)),
    h(Text, { dimColor: true }, headerRight)
  ),
  ...renderPromotedFilterAffordance(h, Text, state, theme),
  ...lines)
}

function renderStashSurface(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  context: LogInkContext,
  contextStatus: LogInkContextStatus,
  bodyRows: number,
  width: number,
  theme: LogInkTheme
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const focused = state.focus === 'commits'
  const loading = isLogInkContextKeyLoading(contextStatus, 'stashes')
  const allStashes = context.stashes?.stashes || []
  const stashes = state.filter
    ? allStashes.filter((stash) =>
      matchesPromotedFilter([stash.ref, stash.message], state.filter)
    )
    : allStashes
  const selected = Math.max(0, Math.min(state.selectedStashIndex, Math.max(0, stashes.length - 1)))
  const listRows = Math.max(4, bodyRows - 4)
  const startIndex = Math.max(0, selected - Math.floor(listRows / 2))
  const visible = stashes.slice(startIndex, startIndex + listRows)
  const filterLabel = state.filter ? ` | filter: ${state.filter}` : ''
  const headerRight = loading
    ? 'loading stashes'
    : `${stashes.length}/${allStashes.length} stashes${filterLabel}`
  const emptyLabel = formatLogInkStashEmpty({ filter: state.filter })
  const loadingLabel = formatLogInkLoading({ resource: 'stashes' })
  const lines: ReactTypes.ReactNode[] = loading
    ? [h(Text, { key: 'stash-loading', dimColor: true }, loadingLabel)]
    : stashes.length === 0
      ? [h(Text, { key: 'stash-empty', dimColor: true }, emptyLabel)]
      : visible.map((stash, offset) => {
        const index = startIndex + offset
        const isSelected = index === selected
        const cursor = isSelected ? '>' : ' '
        return h(Text, {
          key: `stash-${index}`,
          bold: isSelected,
          dimColor: !isSelected,
        }, truncate(`${cursor} ${stash.ref.padEnd(12)} ${stash.message}`, 140))
      })

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    flexShrink: 0,
    paddingX: 1,
    width,
  },
  h(Box, { justifyContent: 'space-between' },
    h(Text, { bold: true }, panelTitle('Stash', focused)),
    h(Text, { dimColor: true }, headerRight)
  ),
  ...renderPromotedFilterAffordance(h, Text, state, theme),
  ...lines)
}

function renderWorktreesSurface(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  context: LogInkContext,
  contextStatus: LogInkContextStatus,
  bodyRows: number,
  width: number,
  theme: LogInkTheme
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const focused = state.focus === 'commits'
  const loading = isLogInkContextKeyLoading(contextStatus, 'worktreeList')
  const allWorktrees = context.worktreeList?.worktrees || []
  const worktrees = state.filter
    ? allWorktrees.filter((entry) =>
      matchesPromotedFilter([entry.path, entry.branch || '', entry.head || ''], state.filter)
    )
    : allWorktrees
  const selected = Math.max(0, Math.min(state.selectedWorktreeListIndex, Math.max(0, worktrees.length - 1)))
  const listRows = Math.max(4, bodyRows - 4)
  const startIndex = Math.max(0, selected - Math.floor(listRows / 2))
  const visible = worktrees.slice(startIndex, startIndex + listRows)
  const filterLabel = state.filter ? ` | filter: ${state.filter}` : ''
  const headerRight = loading
    ? 'loading worktrees'
    : `${worktrees.length}/${allWorktrees.length} worktrees${filterLabel}`
  // Per-window branch column width (#833). Worktrees often track
  // branches with names varying widely in length (`main` vs.
  // `feat/tui-something-long`); fixed-width padding either left a
  // huge gutter on short rows or pushed the path column off-screen on
  // long ones. Cap matches the other promoted surfaces.
  const branchColWidth = visible.length === 0
    ? 28
    : Math.min(40, Math.max(8, ...visible.map((entry) => {
      const label = entry.branch ? entry.branch : entry.head || '<detached>'
      return label.length
    })))
  const lines: ReactTypes.ReactNode[] = loading
    ? [h(Text, { key: 'worktrees-loading', dimColor: true }, formatLogInkLoading({ resource: 'worktrees' }))]
    : worktrees.length === 0
      ? [h(Text, { key: 'worktrees-empty', dimColor: true }, 'No linked worktrees.')]
      : visible.map((entry, offset) => {
        const index = startIndex + offset
        const isSelected = index === selected
        const cursor = isSelected ? '>' : ' '
        const marker = entry.current ? '*' : ' '
        const branchLabel = entry.branch ? entry.branch : entry.head || '<detached>'
        const stateLabel = entry.dirty ? 'dirty' : 'clean'
        const branchPadded = truncate(branchLabel, branchColWidth).padEnd(branchColWidth)
        return h(Text, {
          key: `worktree-${index}`,
          bold: isSelected,
          dimColor: !isSelected && !entry.current,
        }, truncate(
          `${cursor} ${marker} ${branchPadded} ${stateLabel.padEnd(6)} ${entry.path}`,
          width - 4
        ))
      })

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    flexShrink: 0,
    paddingX: 1,
    width,
  },
  h(Box, { justifyContent: 'space-between' },
    h(Text, { bold: true }, panelTitle('Worktrees', focused)),
    h(Text, { dimColor: true }, headerRight)
  ),
  ...renderPromotedFilterAffordance(h, Text, state, theme),
  ...lines)
}

/**
 * Pull-request action panel (#783) — renders the current branch's PR
 * with header, checks table, reviews summary, and a body preview.
 * Action keys (m / x / a / R / c / O) are wired in inkInput.ts and
 * surfaced via the footer; this renderer is read-only.
 *
 * Three loading / fallback states matter:
 * - Provider data still loading → "Loading pull request..."
 * - GitHub remote present but no PR for the current branch → empty
 *   state hint pointing the user at `C` to create one.
 * - GitHub CLI missing / unauthenticated → unavailable hint.
 */
function renderPullRequestSurface(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  context: LogInkContext,
  contextStatus: LogInkContextStatus,
  bodyRows: number,
  width: number,
  theme: LogInkTheme
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const focused = state.focus === 'commits'
  const loading = isLogInkContextKeyLoading(contextStatus, 'pullRequest')
  const pullRequestOverview = context.pullRequest
  // Use the dedicated `pullRequest` overview only — the `provider`
  // shape carries a slimmer ProviderPullRequestStatus that lacks
  // url / headRefName / body / mergeable / reviews. The dedicated
  // overview hits `gh pr view --json` with the full enriched field
  // list (PULL_REQUEST_VIEW_JSON_FIELDS) so the panel has everything.
  const pr = pullRequestOverview?.currentPullRequest
  const muted = theme.noColor ? undefined : theme.colors.muted
  const accent = theme.noColor ? undefined : theme.colors.accent

  const containerProps = {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column' as const,
    flexShrink: 0,
    paddingX: 1,
    width,
  }

  if (loading && !pr) {
    return h(Box, containerProps,
      h(Box, { justifyContent: 'space-between' },
        h(Text, { bold: true }, panelTitle('Pull request', focused)),
        h(Text, { dimColor: true }, 'loading')
      ),
      h(Text, { dimColor: true }, formatLogInkLoading({ resource: 'pull request' })))
  }

  if (!pr) {
    const hint = pullRequestOverview?.message
      || 'No pull request detected for this branch. Press `C` (or `:create-pr`) to create one.'
    return h(Box, containerProps,
      h(Box, { justifyContent: 'space-between' },
        h(Text, { bold: true }, panelTitle('Pull request', focused)),
        h(Text, { dimColor: true }, 'no PR')
      ),
      h(Text, { dimColor: true }, truncate(hint, width - 4)))
  }

  const checks = summarizePullRequestChecks(pr.statusCheckRollup)
  const reviews = summarizePullRequestReviews(pr.reviews, pr.reviewDecision)
  const checkRows = buildPullRequestCheckRows(pr.statusCheckRollup, { ascii: theme.ascii })
  const checkColor = (s: 'success' | 'failure' | 'pending' | 'neutral' | 'skipped'): string | undefined => {
    if (theme.noColor) return undefined
    if (s === 'success') return theme.colors.success
    if (s === 'failure') return theme.colors.danger
    if (s === 'pending') return theme.colors.warning
    return theme.colors.muted
  }

  // Reserve a few rows for the header/section labels; the rest go to
  // the checks table. Body preview gets the leftover rows so the
  // surface stays vertically balanced even on tall terminals.
  const checkBudget = Math.max(3, Math.min(checkRows.length, Math.floor(bodyRows / 2)))
  const visibleChecks = checkRows.slice(0, checkBudget)
  const truncatedChecks = checkRows.length - visibleChecks.length
  const bodyPreviewBudget = Math.max(2, bodyRows - 8 - visibleChecks.length)
  const bodyLines = (pr.body || '').split(/\r?\n/).filter((line) => line.trim().length > 0)
  const visibleBodyLines = bodyLines.slice(0, bodyPreviewBudget)
  const truncatedBodyLines = bodyLines.length - visibleBodyLines.length

  const headerRight = `#${pr.number} · ${pr.headRefName} → ${pr.baseRefName}`
  const stateLine = formatPullRequestStateLine(pr)
  const author = pr.author ? `by @${pr.author}` : ''

  return h(Box, containerProps,
    h(Box, { justifyContent: 'space-between' },
      h(Text, { bold: true }, panelTitle('Pull request', focused)),
      h(Text, { dimColor: true }, headerRight)
    ),
    h(Text, undefined, truncate(pr.title, width - 4)),
    h(Text, { dimColor: true }, truncate(`${stateLine}${author ? ` · ${author}` : ''}`, width - 4)),
    h(Text, undefined, ''),

    // Checks section
    h(Text, { bold: true, color: accent }, 'Checks'),
    h(Text, { dimColor: true }, truncate(`  ${formatPullRequestChecksSummary(checks, { ascii: theme.ascii })}`, width - 4)),
    ...visibleChecks.map((row, index) => h(Text, {
      key: `pr-check-${index}`,
      color: checkColor(row.status),
    }, truncate(`  ${row.glyph} ${row.name.padEnd(28)} ${row.detail}`, width - 4))),
    ...(truncatedChecks > 0
      ? [h(Text, { key: 'pr-checks-trunc', dimColor: true }, truncate(`  … ${truncatedChecks} more`, width - 4))]
      : []),
    h(Text, undefined, ''),

    // Reviews section
    h(Text, { bold: true, color: accent }, 'Reviews'),
    h(Text, { dimColor: true }, truncate(`  ${formatPullRequestReviewsSummary(reviews)}`, width - 4)),
    h(Text, undefined, ''),

    // Body preview
    ...(visibleBodyLines.length > 0
      ? [
        h(Text, { key: 'pr-body-label', bold: true, color: accent }, 'Description'),
        ...visibleBodyLines.map((line, index) => h(Text, {
          key: `pr-body-${index}`,
          color: muted,
        }, truncate(`  ${line}`, width - 4))),
        ...(truncatedBodyLines > 0
          ? [h(Text, { key: 'pr-body-trunc', dimColor: true }, truncate(`  … ${truncatedBodyLines} more lines`, width - 4))]
          : []),
      ]
      : []))
}

/**
 * Filter input cursor for the promoted views (branches/tags/stash).
 * History already shows the same `filter: foo_` affordance in its header
 * — this mirrors that into the other surfaces so the user can see what
 * they're typing instead of watching the list silently shrink (P2.1).
 *
 * Returns an empty array when the surface isn't in filter mode so call
 * sites can spread it unconditionally.
 */
function renderPromotedFilterAffordance(
  h: typeof ReactTypes.createElement,
  Text: LogInkComponents['Text'],
  state: LogInkState,
  theme: LogInkTheme
): ReactTypes.ReactElement[] {
  if (!state.filterMode) {
    return []
  }
  const accent = theme.noColor ? undefined : theme.colors.accent
  return [
    h(Text, { key: 'promoted-filter-input', color: accent }, `filter: ${state.filter}_`),
  ]
}

function renderDiffSurface(
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
  bodyRows: number,
  width: number,
  theme: LogInkTheme
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const focused = state.focus === 'commits'
  const worktree = context.worktree
  const worktreeFile = worktree?.files[state.selectedWorktreeFileIndex]
  const visibleRows = Math.max(4, bodyRows - 4)

  // Stash diff branch: when the user opened the diff via Enter on a stash
  // row, render the stash patch text directly. The patch is parsed into
  // per-file sections so `]` / `[` jumps between files and `c`
  // cherry-picks the file at the cursor.
  if (state.diffSource === 'stash') {
    const lines = stashDiffLines || []
    const splitActive = isSplitDiffViable(state, width)
    const splitRequestedButTooNarrow = state.diffViewMode === 'split' && !splitActive
    const visibleLines = lines.slice(
      state.diffPreviewOffset,
      state.diffPreviewOffset + visibleRows
    )
    const stashFiles = parseStashDiffFiles(lines)
    const fileCount = stashFiles.length
    const currentFile = findStashFileForOffset(stashFiles, state.diffPreviewOffset)
    const currentFileIndex = currentFile
      ? Math.max(0, stashFiles.findIndex((file) => file.startLine === currentFile.startLine))
      : -1
    // Look up the active stash entry so the panel header can show a
    // human-identifier instead of the raw `stash@{<iso-date>}` ref.
    // The git ref is the timestamp form (we fetch with --date=iso for
    // stable parsing) which reads as noise in the title bar; the
    // message + branch + index combination is what the user wrote down
    // when they ran `git stash`. Body still shows the full ref so it
    // stays unambiguous.
    const stashIdentity = formatStashHeaderIdentity(state.stashDiffRef, context.stashes?.stashes)
    const baseHeaderLines: string[] = stashDiffLoading
      ? [`Loading diff for ${stashIdentity.subtitle}...`]
      : lines.length
        ? [
          stashIdentity.bodyLine,
          fileCount > 0 && currentFile
            ? `File ${currentFileIndex + 1}/${fileCount}: ${currentFile.path}`
            : 'No files in this stash.',
          `Lines ${Math.min(state.diffPreviewOffset + 1, lines.length)}-${Math.min(state.diffPreviewOffset + visibleLines.length, lines.length)}/${lines.length}`,
          '',
        ]
        : ['No diff to display for this stash.']
    const headerLines = splitRequestedButTooNarrow
      ? [...baseHeaderLines.slice(0, -1), 'Terminal too narrow for side-by-side; showing unified.', '']
      : baseHeaderLines

    // File header anchor map: absolute line index → owning stash file.
    // Lets the body-render pass restyle each `diff --git` row in O(1)
    // and decide which one is the *active* file (the one currently
    // containing `diffPreviewOffset`). The active header gets the
    // selection background to mark "the file the cursor is inside."
    const stashFileByStartLine = new Map(stashFiles.map((file) => [file.startLine, file]))
    const activeStartLine = currentFile?.startLine
    const stashBodyNodes: ReactTypes.ReactNode[] = stashDiffLoading || !lines.length
      ? []
      : splitActive
        ? renderSplitDiffBody(
          h, components, visibleLines, state.diffPreviewOffset, width, theme,
          'stash-diff-split'
        )
        : visibleLines.map((line, index) => {
          const absoluteIndex = state.diffPreviewOffset + index
          const headerFile = stashFileByStartLine.get(absoluteIndex)
          if (headerFile) {
            // Replace the verbose `diff --git a/<path> b/<path>` text
            // with a compact `▾ <path>` marker — the path itself is
            // the meaningful identifier, not the a/b duplication. The
            // active file's header gets selection styling so the user
            // sees at a glance which file the cursor is inside.
            const isActive = absoluteIndex === activeStartLine
            const arrow = theme.ascii ? '> ' : '▾ '
            return h(Text, {
              key: `stash-diff-line-${absoluteIndex}`,
              bold: true,
              color: theme.noColor ? undefined : theme.colors.accent,
              backgroundColor: isActive && focused && !theme.noColor ? theme.colors.selection : undefined,
              inverse: isActive && focused,
            }, truncate(`${arrow}${headerFile.path}`, width - 4))
          }
          return h(Text, {
            key: `stash-diff-line-${absoluteIndex}`,
            ...diffLineProps(line, theme),
          }, truncate(line, width - 4))
        })

    return h(Box, {
      borderColor: focusBorderColor(theme, focused),
      borderStyle: theme.borderStyle,
      flexDirection: 'column',
      flexShrink: 0,
      paddingX: 1,
      width,
    },
    h(Box, { justifyContent: 'space-between' },
      h(Text, { bold: true }, panelTitle(splitActive ? 'Stash diff (split)' : 'Stash diff', focused)),
      h(Text, { dimColor: true }, stashIdentity.subtitle)
    ),
    ...headerLines.map((line, index) => h(Text, {
      key: `stash-diff-header-${index}`,
      dimColor: index > 0,
    }, truncate(line, width - 4))),
    ...stashBodyNodes)
  }

  // Compare-two-refs branch (#779). Mirrors the stash diff above but
  // sourced from `git diff <base>..<head>`. No per-file cherry-pick or
  // hunk apply — comparing arbitrary refs doesn't have a sensible
  // mutate-from-here flow, so the surface is read-only navigation.
  if (state.diffSource === 'compare') {
    const lines = compareDiffLines || []
    const splitActive = isSplitDiffViable(state, width)
    const splitRequestedButTooNarrow = state.diffViewMode === 'split' && !splitActive
    const visibleLines = lines.slice(
      state.diffPreviewOffset,
      state.diffPreviewOffset + visibleRows
    )
    const baseLabel = state.compareBase?.label || state.compareBase?.ref || '<base>'
    const headLabel = state.compareHead?.label || state.compareHead?.ref || '<head>'
    const compareTitle = `${baseLabel} → ${headLabel}`
    const baseHeaderLines: string[] = compareDiffLoading
      ? [`Loading diff for ${compareTitle}...`]
      : lines.length && (lines.length > 1 || lines[0])
        ? [
          compareTitle,
          `Lines ${Math.min(state.diffPreviewOffset + 1, lines.length)}-${Math.min(state.diffPreviewOffset + visibleLines.length, lines.length)}/${lines.length}`,
          '',
        ]
        : ['No diff to display — refs may resolve to the same tree.']
    const headerLines = splitRequestedButTooNarrow
      ? [...baseHeaderLines.slice(0, -1), 'Terminal too narrow for side-by-side; showing unified.', '']
      : baseHeaderLines

    const compareBodyNodes: ReactTypes.ReactNode[] = compareDiffLoading || !lines.length || (lines.length === 1 && !lines[0])
      ? []
      : splitActive
        ? renderSplitDiffBody(
          h, components, visibleLines, state.diffPreviewOffset, width, theme,
          'compare-diff-split'
        )
        : visibleLines.map((line, index) => h(Text, {
          key: `compare-diff-line-${state.diffPreviewOffset + index}`,
          ...diffLineProps(line, theme),
        }, truncate(line, width - 4)))

    return h(Box, {
      borderColor: focusBorderColor(theme, focused),
      borderStyle: theme.borderStyle,
      flexDirection: 'column',
      flexShrink: 0,
      paddingX: 1,
      width,
    },
    h(Box, { justifyContent: 'space-between' },
      h(Text, { bold: true }, panelTitle(splitActive ? 'Compare (split)' : 'Compare', focused)),
      h(Text, { dimColor: true }, truncate(compareTitle, Math.max(20, Math.floor(width / 2))))
    ),
    ...headerLines.map((line, index) => h(Text, {
      key: `compare-diff-header-${index}`,
      dimColor: index > 0,
    }, truncate(line, width - 4))),
    ...compareBodyNodes)
  }

  // diffSource disambiguates: 'commit' was set when the user opened the
  // diff via history → Enter (read-only commit-diff explore), 'worktree'
  // was set when they came from status → Enter (stage / hunk / revert).
  // Falls back to the previous heuristic when no source is recorded so
  // older entry paths still render something sensible.
  const useCommitDiff = state.diffSource === 'commit' ||
    (state.diffSource === undefined && !worktreeFile && Boolean(selectedDetailFile))

  if (useCommitDiff) {
    const previewHunks = filePreview?.hunks || []
    const splitActive = isSplitDiffViable(state, width)
    const splitRequestedButTooNarrow = state.diffViewMode === 'split' && !splitActive
    const visiblePreviewHunks = previewHunks.slice(
      state.diffPreviewOffset,
      state.diffPreviewOffset + visibleRows
    )
    const hunkCount = commitDiffHunkOffsets?.length || 0
    const currentHunkIndex = hunkCount > 0
      ? Math.max(0, [...(commitDiffHunkOffsets || [])]
          .reverse()
          .findIndex((offset) => offset <= state.diffPreviewOffset))
      : 0
    const currentHunkLabel = hunkCount > 0
      ? `Hunk ${Math.min(hunkCount - currentHunkIndex, hunkCount)}/${hunkCount}`
      : 'No hunks for this file.'

    const baseHeaderLines: string[] = filePreviewLoading
      ? [`Loading diff for ${selectedDetailFile?.path || 'selected file'}...`]
      : previewHunks.length
        ? [
          `Selected file: ${selectedDetailFile?.path || ''}`,
          currentHunkLabel,
          `Lines ${Math.min(state.diffPreviewOffset + 1, previewHunks.length || 1)}-${Math.min(state.diffPreviewOffset + visiblePreviewHunks.length, previewHunks.length)}/${previewHunks.length}`,
          '',
        ]
        : ['No diff preview available for this file.']
    const headerLines = splitRequestedButTooNarrow
      ? [...baseHeaderLines.slice(0, -1), 'Terminal too narrow for side-by-side; showing unified.', '']
      : baseHeaderLines

    const commitBodyNodes: ReactTypes.ReactNode[] = filePreviewLoading || !previewHunks.length
      ? []
      : splitActive
        ? renderSplitDiffBody(
          h, components, visiblePreviewHunks, state.diffPreviewOffset, width, theme,
          'commit-diff-split'
        )
        : visiblePreviewHunks.map((line, index) => h(Text, {
          key: `diff-surface-line-${state.diffPreviewOffset + index}`,
          ...diffLineProps(line, theme),
        }, truncate(line, 140)))

    return h(Box, {
      borderColor: focusBorderColor(theme, focused),
      borderStyle: theme.borderStyle,
      flexDirection: 'column',
      flexShrink: 0,
      paddingX: 1,
      width,
    },
    h(Box, { justifyContent: 'space-between' },
      h(Text, { bold: true }, panelTitle(splitActive ? 'Diff (split)' : 'Diff', focused)),
      h(Text, { dimColor: true }, selectedDetailFile?.path || 'no file')
    ),
    ...headerLines.map((line, index) => h(Text, {
      key: `diff-surface-header-${index}`,
      dimColor: index > 0,
    }, truncate(line, 140))),
    ...commitBodyNodes)
  }

  const diffLines = worktreeDiff?.lines || []
  const selectedHunk = worktreeHunks?.hunks[state.selectedWorktreeHunkIndex]
  const visibleDiffLines = diffLines.slice(
    state.worktreeDiffOffset,
    state.worktreeDiffOffset + visibleRows
  )
  const headerLines: string[] = isLogInkContextKeyLoading(contextStatus, 'worktree')
    ? ['Loading file context...']
    : worktreeDiffLoading
      ? [`Loading diff for ${worktreeFile?.path || 'selected file'}...`]
      : worktreeFile
      ? [
        `Selected file: ${worktreeFile.path}`,
        worktreeHunksLoading
          ? 'Hunks loading...'
          : worktreeHunks?.hunks.length
            ? `Hunk ${state.selectedWorktreeHunkIndex + 1}/${worktreeHunks.hunks.length} ${selectedHunk?.state || ''}`
            : 'No stageable hunks for this file.',
        `Lines ${Math.min(state.worktreeDiffOffset + 1, diffLines.length || 1)}-${Math.min(state.worktreeDiffOffset + visibleDiffLines.length, diffLines.length)}/${diffLines.length}`,
        '',
      ]
      : ['No changed file selected.']

  const showDiffLines = Boolean(worktreeFile) &&
    !worktreeDiffLoading &&
    !isLogInkContextKeyLoading(contextStatus, 'worktree')

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    flexShrink: 0,
    paddingX: 1,
    width,
  },
  h(Box, { justifyContent: 'space-between' },
    h(Text, { bold: true }, panelTitle('Diff', focused)),
    h(Text, { dimColor: true }, worktreeFile ? worktreeFile.path : 'no file')
  ),
  ...headerLines.map((line, index) => h(Text, {
    key: `diff-surface-header-${index}`,
    dimColor: index > 0,
  }, truncate(line, 140))),
  ...(showDiffLines
    ? visibleDiffLines.map((line, index) => h(Text, {
      key: `diff-surface-line-${state.worktreeDiffOffset + index}`,
      ...diffLineProps(line, theme),
    }, truncate(line, 140)))
    : []))
}

function renderDetailPanel(
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

function renderHistoryInspector(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  context: LogInkContext,
  _contextStatus: LogInkContextStatus,
  detail: GitCommitDetail | undefined,
  loading: boolean,
  _filePreview: GitCommitFilePreview | undefined,
  _filePreviewLoading: boolean,
  width: number,
  tabbed: boolean,
  theme: LogInkTheme,
  focused: boolean
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const selected = getSelectedInkCommit(state)

  if (!detail) {
    const fallbackLines = [
      selected?.message || 'No commit selected.',
      '',
      loading ? 'Loading commit details...' : 'Commit details unavailable.',
    ]
    return h(Box, {
      borderColor: focusBorderColor(theme, focused),
      borderStyle: theme.borderStyle,
      flexDirection: 'column',
      width,
      paddingX: 1,
    },
    h(Text, { bold: true }, panelTitle('Inspector', focused)),
    ...fallbackLines.map((line, index) => h(Text, {
      key: `detail-${index}`,
      dimColor: index > 1,
    }, truncate(line, width - 4))),
    ...renderInspectorActionsSection(h, Text, 'history-commit', width, theme, {
      cursorIndex: state.inspectorActionIndex,
      cursorActive: focused && state.inspectorTab === 'actions',
    }))
  }

  const statLine = `${detail.stats.filesChanged} files  +${detail.stats.insertions}/-${detail.stats.deletions}`
  // P5.1 — link the commit hash and each ref out to GitHub when we know
  // the remote. OSC 8 escapes embed inline; supportsHyperlinks() decides
  // whether to wrap or fall through to plain text.
  const repository = context.provider?.repository
  const commitLink = formatHyperlink(
    compactHash(detail.hash),
    buildCommitUrl(repository, detail.hash)
  )
  const refNodes = detail.refs.length
    ? renderInspectorRefs(h, Text, detail.refs, repository)
    : null

  // Inspector reorder (PR — drop duplicative Workflows trailer):
  //  1. Commit message (the headline of what you're looking at)
  //  2. Metadata (hash / author / date / refs / stats)
  //  3. Body preview (up to 8 lines now that the trailer is gone)
  //  4. Changed files list (cursored entry highlights)
  //  5. Actions cheat-sheet (per-entity keystrokes; destructive marked)
  // The Workflows: trailer that used to repeat the repo / branch /
  // status from the top header and left sidebar is intentionally gone.
  const headerNodes: ReactTypes.ReactElement[] = [
    h(Text, { key: 'detail-msg' }, truncate(detail.message, width - 4)),
    h(Text, { key: 'detail-spacer-1' }, ''),
    h(Text, { key: 'detail-commit', dimColor: true }, 'Commit: ', commitLink),
    h(Text, { key: 'detail-author', dimColor: true }, truncate(`Author: ${detail.author}`, width - 4)),
    h(Text, { key: 'detail-date', dimColor: true }, truncate(`Date:   ${detail.date}`, width - 4)),
    refNodes
      ? h(Text, { key: 'detail-refs', dimColor: true }, 'Refs:   ', ...refNodes)
      : h(Text, { key: 'detail-refs', dimColor: true }, 'Refs:   none'),
    h(Text, { key: 'detail-stat', dimColor: true }, truncate(`Stats:  ${statLine}`, width - 4)),
    h(Text, { key: 'detail-spacer-2' }, ''),
    ...(detail.body ? detail.body.split('\n').slice(0, 8) : ['No commit body.']).map((line, index) =>
      h(Text, {
        key: `detail-body-${index}`,
        dimColor: true,
      }, truncate(line, width - 4))
    ),
    h(Text, { key: 'detail-spacer-3' }, ''),
    h(Text, { key: 'detail-files-title' }, 'Changed files:'),
  ]

  // Single-cursor invariant: the file list owns the cursor when the
  // inspector tab is active; the actions list owns it when the actions
  // tab is active. Pass `focused` only for the matching tab so users
  // never see two simultaneous selection highlights inside the panel.
  const fileListFocused = focused && state.inspectorTab === 'inspector'
  const fileListMaxRows = Math.max(4, Math.min(detail.files.length, 10))
  const fileListNodes = renderCommitFileList(
    h, Text, detail.files, state.selectedFileIndex, fileListFocused, fileListMaxRows, width, theme
  )

  // Tab indicator. Renders in BOTH tabbed (short-terminal) mode and
  // tall-stacked mode so the user can always see which tab the cursor
  // owns and learn the `[/]` toggle. Without this on tall terminals,
  // the actions list looked like a static cheat-sheet — there was no
  // visible signal that the cursor could move into it.
  //
  // Spacing between tab labels comes from the labels' own padding
  // (the active label is bracketed `[Inspector]` while the inactive
  // one is space-padded ` Inspector `, so adjacency reads cleanly).
  // Earlier revisions stuck a raw `' '` between the Text children to
  // pad them visually — that crashes Ink at first paint with
  // "Text string ' ' must be rendered inside <Text> component"
  // because Box only accepts component children, never bare strings.
  const activeTab = state.inspectorTab
  const tabHeader = h(Box, { key: 'inspector-tabs', flexDirection: 'row' },
    h(Text, {
      bold: activeTab === 'inspector',
      dimColor: activeTab !== 'inspector',
    }, activeTab === 'inspector' ? '[Inspector]' : ' Inspector '),
    h(Text, {
      bold: activeTab === 'actions',
      dimColor: activeTab !== 'actions',
    }, activeTab === 'actions' ? '[Actions]' : ' Actions '),
    ...(focused
      ? [h(Text, { key: 'inspector-tabs-hint', dimColor: true }, '  · ←/→ switch')]
      : []))

  // Tabbed mode (short terminals): render only the active tab's
  // content under the tab header.
  if (tabbed) {
    return h(Box, {
      borderColor: focusBorderColor(theme, focused),
      borderStyle: theme.borderStyle,
      flexDirection: 'column',
      width,
      paddingX: 1,
    },
    h(Text, { bold: true }, panelTitle('Inspector', focused)),
    tabHeader,
    h(Text, { key: 'inspector-tabs-spacer' }, ''),
    ...(activeTab === 'inspector'
      ? [...headerNodes, ...fileListNodes]
      : renderInspectorActionsSection(h, Text, 'history-commit', width, theme, {
          cursorIndex: state.inspectorActionIndex,
          cursorActive: focused,
        })))
  }

  // Tall mode: stack both sections so the user can read everything at
  // once, but show the tab header so the active section (and the
  // `[/]` switch affordance) is visible.
  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    width,
    paddingX: 1,
  },
  h(Text, { bold: true }, panelTitle('Inspector', focused)),
  tabHeader,
  h(Text, { key: 'inspector-tabs-spacer' }, ''),
  ...headerNodes,
  ...fileListNodes,
  ...renderInspectorActionsSection(h, Text, 'history-commit', width, theme, {
    cursorIndex: state.inspectorActionIndex,
    cursorActive: focused && state.inspectorTab === 'actions',
  }))
}

/**
 * Render the trailing "Actions:" section that surfaces which keystrokes
 * apply to whatever the inspector is focused on. Keys are colored with
 * `theme.colors.accent` so they pop as the actionable element. Destructive
 * actions get the danger color plus a `[!]` marker so they don't blend
 * into the cherry-pick / yank rows.
 *
 * Truncates labels when the inspector is narrow (down to the 26-cell
 * minimum from `getLogInkLayout`) so an overflowing label never wraps and
 * collides with the next row.
 */
function renderInspectorActionsSection(
  h: typeof ReactTypes.createElement,
  Text: LogInkComponents['Text'],
  context: InspectorActionContext,
  width: number,
  theme: LogInkTheme,
  options: { cursorIndex?: number; cursorActive?: boolean } = {}
): ReactTypes.ReactElement[] {
  const actions = getInspectorActions(context)
  if (!actions.length) return []

  // Width budget for each row: subtract padding + " " gutter, the key
  // column (left-padded to 5 cells so labels align), the "  " gap
  // between key and label, and the optional "  [!]" suffix (5 cells).
  const KEY_COLUMN = 5
  const GAP = '  '
  const DESTRUCTIVE_SUFFIX = '  [!]'
  const labelBudget = Math.max(
    4,
    width - 4 /* border + padX */ - KEY_COLUMN - GAP.length - DESTRUCTIVE_SUFFIX.length
  )

  const cursorIndex = options.cursorIndex ?? 0
  const cursorActive = options.cursorActive ?? false

  const nodes: ReactTypes.ReactElement[] = [
    h(Text, { key: 'actions-spacer' }, ''),
    h(Text, { key: 'actions-title' }, cursorActive ? '[Actions]' : 'Actions:'),
    ...actions.map((action: InspectorAction, index) => {
      const isSelected = cursorActive && index === cursorIndex
      const keyCell = action.key.padEnd(KEY_COLUMN)
      const label = truncate(action.label, labelBudget)
      const children: Array<string | ReactTypes.ReactElement> = [
        h(Text, {
          key: `actions-${index}-key`,
          color: action.destructive ? theme.colors.danger : theme.colors.accent,
        }, keyCell),
        GAP,
        label,
      ]
      if (action.destructive) {
        children.push(h(Text, {
          key: `actions-${index}-mark`,
          color: theme.colors.danger,
          dimColor: false,
        }, DESTRUCTIVE_SUFFIX))
      }
      return h(Text, {
        key: `actions-${index}`,
        backgroundColor: isSelected && !theme.noColor ? theme.colors.selection : undefined,
        inverse: isSelected,
      }, ...children)
    }),
  ]

  return nodes
}

/**
 * Build a commit URL for the repo when GitHub provider info is available.
 * Returns undefined for unsupported remotes — formatHyperlink falls through
 * to plain text in that case.
 */
function buildCommitUrl(
  repository: ProviderRepository | undefined,
  hash: string
): string | undefined {
  if (!repository) return undefined
  return buildProviderUrl(repository, { type: 'commit', commit: hash })
}

/**
 * Build a branch URL for a ref name. Strips the `HEAD -> ` and `tag: `
 * prefixes git decoration uses. For everything else we treat the ref as a
 * branch — GitHub's `/tree/<ref>` resolves both branches and tags.
 */
function buildRefUrl(
  repository: ProviderRepository | undefined,
  ref: string
): string | undefined {
  if (!repository) return undefined
  const stripped = ref.replace(/^HEAD -> /, '').replace(/^tag: /, '').trim()
  if (!stripped) return undefined
  return buildProviderUrl(repository, { type: 'branch', branch: stripped })
}

/**
 * Render `refs` as a comma-separated sequence of <Text> fragments, each
 * wrapped in OSC 8 (no-op when the terminal can't render hyperlinks).
 */
function renderInspectorRefs(
  h: typeof ReactTypes.createElement,
  Text: LogInkComponents['Text'],
  refs: string[],
  repository: ProviderRepository | undefined
): ReactTypes.ReactElement[] {
  const out: ReactTypes.ReactElement[] = []
  refs.forEach((ref, index) => {
    if (index > 0) {
      out.push(h(Text, { key: `ref-sep-${index}` }, ', '))
    }
    out.push(h(Text, { key: `ref-${index}` }, formatHyperlink(ref, buildRefUrl(repository, ref))))
  })
  return out
}

function renderCommitDiffDetail(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  detail: GitCommitDetail | undefined,
  loading: boolean,
  width: number,
  theme: LogInkTheme,
  focused: boolean
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const selected = getSelectedInkCommit(state)

  if (!detail) {
    const fallbackLines = [
      selected?.message || 'No commit selected.',
      '',
      loading ? 'Loading commit details...' : 'Commit details unavailable.',
    ]
    return h(Box, {
      borderColor: focusBorderColor(theme, focused),
      borderStyle: theme.borderStyle,
      flexDirection: 'column',
      width,
      paddingX: 1,
    },
    h(Text, { bold: true }, panelTitle('Commit', focused)),
    ...fallbackLines.map((line, index) => h(Text, {
      key: `commit-diff-${index}`,
      dimColor: index > 1,
    }, truncate(line, width - 4))))
  }

  const statLine = `${detail.stats.filesChanged} files  +${detail.stats.insertions}/-${detail.stats.deletions}`
  const headerLines = [
    detail.message,
    '',
    `${compactHash(detail.hash)}  ${detail.date}  ${detail.author}`,
    detail.refs.length ? `Refs: ${detail.refs.join(', ')}` : 'Refs: none',
    statLine,
    '',
  ]
  const bodyLines = detail.body ? detail.body.split('\n').slice(0, 5) : []
  const filesHeader = ['Files:']
  const fileListMaxRows = Math.max(4, Math.min(detail.files.length, 12))
  const fileListNodes = renderCommitFileList(
    h, Text, detail.files, state.selectedFileIndex, focused, fileListMaxRows, width, theme
  )
  const hint = focused
    ? 'j/k pick file · enter swaps the center diff'
    : 'tab focuses the file list'

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    width,
    paddingX: 1,
  },
  h(Text, { bold: true }, panelTitle('Commit', focused)),
  ...headerLines.map((line, index) => h(Text, {
    key: `commit-diff-header-${index}`,
    bold: index === 0,
    dimColor: index > 0 && index < headerLines.length - 1,
  }, truncate(line, width - 4))),
  ...bodyLines.map((line, index) => h(Text, {
    key: `commit-diff-body-${index}`,
    dimColor: true,
  }, truncate(line, width - 4))),
  ...(bodyLines.length ? [h(Text, { key: 'commit-diff-body-spacer' }, '')] : []),
  ...filesHeader.map((line, index) => h(Text, {
    key: `commit-diff-files-${index}`,
    bold: true,
  }, truncate(line, width - 4))),
  ...fileListNodes,
  h(Text, undefined, ''),
  h(Text, { dimColor: true }, truncate(hint, width - 4)))
}

function renderComposeContextPanel(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  context: LogInkContext,
  contextStatus: LogInkContextStatus,
  width: number,
  theme: LogInkTheme,
  focused: boolean
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const worktree = context.worktree
  const compose = state.commitCompose
  const loadingWorktree = isLogInkContextKeyLoading(contextStatus, 'worktree')
  const summary = loadingWorktree
    ? 'Worktree status loading'
    : worktree
      ? `${worktree.stagedCount} staged · ${worktree.unstagedCount} unstaged · ${worktree.untrackedCount} untracked`
      : 'No worktree information yet'
  const stagedFiles = (worktree?.files || [])
    .filter((file) => file.indexStatus !== ' ' && file.indexStatus !== '?')
    .slice(0, 12)
  const unstagedFiles = (worktree?.files || [])
    .filter((file) => file.worktreeStatus !== ' ' && file.indexStatus !== '?')
    .slice(0, 6)

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    width,
    paddingX: 1,
  },
  h(Text, { bold: true }, panelTitle('Worktree', focused)),
  h(Text, { dimColor: true }, truncate(summary, width - 4)),
  h(Text, undefined, ''),
  ...(compose.loading
    ? [h(Text, {
      key: 'compose-context-loading',
      bold: true,
      color: theme.noColor ? undefined : theme.colors.accent,
    }, truncate(theme.ascii ? '[...] AI draft in progress' : '⏳ AI draft in progress', width - 4))]
    : []),
  ...(stagedFiles.length
    ? [
      // Section header carries the total count to match the status
      // surface's "▾ Staged (n)" treatment (#840). The visible
      // file list is sliced at 12 rows; using `worktree.stagedCount`
      // (the total) avoids a misleading "Staged (12)" label when
      // there are actually more staged files below the slice.
      h(Text, { key: 'compose-context-staged-title', bold: true },
        `Staged (${worktree?.stagedCount ?? stagedFiles.length})`),
      ...stagedFiles.map((file, index) => h(Text, {
        key: `compose-context-staged-${index}`,
        color: theme.noColor ? undefined : theme.colors.gitAdded,
      }, truncate(`  ${file.indexStatus} ${file.path}`, width - 4))),
      h(Text, { key: 'compose-context-staged-spacer' }, ''),
    ]
    : []),
  ...(unstagedFiles.length
    ? [
      h(Text, { key: 'compose-context-unstaged-title', bold: true },
        `Unstaged (${worktree?.unstagedCount ?? unstagedFiles.length})`),
      ...unstagedFiles.map((file, index) => h(Text, {
        key: `compose-context-unstaged-${index}`,
        color: theme.noColor ? undefined : theme.colors.gitModified,
      }, truncate(`  ${file.worktreeStatus} ${file.path}`, width - 4))),
    ]
    : !stagedFiles.length && !loadingWorktree
      ? [h(Text, { dimColor: true }, 'No worktree changes detected.')]
      : []))
}

/**
 * Render a list of changed files with status-code colors and stats. Used
 * by both the history inspector and the commit-diff detail panel so the
 * two surfaces stay visually consistent.
 *
 * `focused` only controls whether the cursor row is inverse-highlighted —
 * keys j/k and Enter dispatch via the input handler regardless.
 */
function renderCommitFileList(
  h: typeof ReactTypes.createElement,
  Text: LogInkComponents['Text'],
  files: GitCommitDetail['files'],
  selectedIndex: number,
  focused: boolean,
  maxRows: number,
  width: number,
  theme: LogInkTheme
): ReactTypes.ReactElement[] {
  if (!files.length) {
    return [h(Text, { key: 'commit-file-list-empty', dimColor: true }, 'No changed files found.')]
  }

  const clamped = Math.max(0, Math.min(selectedIndex, files.length - 1))
  const startIndex = Math.max(0, clamped - Math.floor(maxRows / 2))
  const visible = files.slice(startIndex, startIndex + maxRows)

  return visible.map((file, offset) => {
    const index = startIndex + offset
    const isSelected = index === clamped
    const cursor = isSelected ? '>' : ' '
    const stats = formatChangedFileStats(file)
    const renamed = file.oldPath ? ` (was ${file.oldPath})` : ''
    const statusCode = file.status.padEnd(3)
    const label = `${cursor} ${statusCode} ${file.path}${renamed}${stats ? `  ${stats}` : ''}`

    return h(Text, {
      key: `commit-file-${index}`,
      color: statusCodeColor(file.status, theme),
      inverse: isSelected && focused && !theme.noColor,
      bold: isSelected,
    }, truncate(label, width - 4))
  })
}

function renderPreviewPanel(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  title: string,
  lines: PreviewLine[],
  width: number,
  theme: LogInkTheme,
  focused: boolean
): ReactTypes.ReactElement {
  const { Box, Text } = components
  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    width,
    paddingX: 1,
  },
  h(Text, { bold: true }, panelTitle(title, focused)),
  ...lines.map((line, index) => {
    const isHeading = line.emphasis === 'heading' && index > 0
    return h(Text, {
      key: `preview-${index}`,
      bold: isHeading,
      dimColor: line.emphasis === 'dim',
    }, truncate(line.text, width - 4))
  }))
}

function renderBranchPreviewPanel(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  context: LogInkContext,
  contextStatus: LogInkContextStatus,
  width: number,
  theme: LogInkTheme,
  focused: boolean
): ReactTypes.ReactElement {
  const { Box, Text } = components
  if (isLogInkContextKeyLoading(contextStatus, 'branches')) {
    return renderPreviewPanel(h, { Box, Text }, 'Branch preview',
      [{ text: formatLogInkLoading({ resource: 'branches' }), emphasis: 'dim' }],
      width, theme, focused)
  }
  const all = context.branches?.localBranches || []
  const visible = state.filter
    ? all.filter((branch) =>
      matchesPromotedFilter([branch.shortName, branch.upstream || ''], state.filter))
    : all
  const index = Math.max(0, Math.min(state.selectedBranchIndex, Math.max(0, visible.length - 1)))
  const branch = visible[index]
  return renderPreviewPanel(h, { Box, Text }, 'Branch preview',
    formatBranchPreview(branch), width, theme, focused)
}

function renderTagPreviewPanel(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  context: LogInkContext,
  contextStatus: LogInkContextStatus,
  width: number,
  theme: LogInkTheme,
  focused: boolean
): ReactTypes.ReactElement {
  const { Box, Text } = components
  if (isLogInkContextKeyLoading(contextStatus, 'tags')) {
    return renderPreviewPanel(h, { Box, Text }, 'Tag preview',
      [{ text: formatLogInkLoading({ resource: 'tags' }), emphasis: 'dim' }],
      width, theme, focused)
  }
  const all = context.tags?.tags || []
  const visible = state.filter
    ? all.filter((tag) => matchesPromotedFilter([tag.name, tag.subject], state.filter))
    : all
  const index = Math.max(0, Math.min(state.selectedTagIndex, Math.max(0, visible.length - 1)))
  const tag = visible[index]
  return renderPreviewPanel(h, { Box, Text }, 'Tag preview',
    formatTagPreview(tag), width, theme, focused)
}

function renderStashPreviewPanel(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  context: LogInkContext,
  contextStatus: LogInkContextStatus,
  width: number,
  theme: LogInkTheme,
  focused: boolean
): ReactTypes.ReactElement {
  const { Box, Text } = components
  if (isLogInkContextKeyLoading(contextStatus, 'stashes')) {
    return renderPreviewPanel(h, { Box, Text }, 'Stash preview',
      [{ text: formatLogInkLoading({ resource: 'stashes' }), emphasis: 'dim' }],
      width, theme, focused)
  }
  const all = context.stashes?.stashes || []
  const visible = state.filter
    ? all.filter((stash) => matchesPromotedFilter([stash.ref, stash.message], state.filter))
    : all
  const index = Math.max(0, Math.min(state.selectedStashIndex, Math.max(0, visible.length - 1)))
  const stash = visible[index]
  return renderPreviewPanel(h, { Box, Text }, 'Stash preview',
    formatStashPreview(stash), width, theme, focused)
}

function renderCommitPanel(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  context: LogInkContext,
  contextStatus: LogInkContextStatus,
  width: number,
  theme: LogInkTheme,
  focused: boolean
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const compose = state.commitCompose
  const loading = compose.loading
  const stagedCount = context.worktree?.stagedCount || 0
  const unstagedCount = context.worktree?.unstagedCount || 0
  const statusLine = isLogInkContextKeyLoading(contextStatus, 'worktree')
    ? 'Status loading'
    : `${stagedCount} staged | ${unstagedCount} unstaged`
  const summaryCursor = compose.editing && compose.field === 'summary' ? '_' : ''
  const bodyCursor = compose.editing && compose.field === 'body' ? '_' : ''
  const bodyTextWidth = Math.max(8, width - 6) // 4 for chrome + 2 for indent
  // Wrap each source line of the body so long messages don't get cut off
  // by the previous truncate(line, width - 4). The 12-line cap is generous
  // — most commit bodies fit, and the panel's column layout absorbs the
  // height naturally.
  const bodyHasContent = Boolean(compose.body)
  const bodyVisualLines: string[] = bodyHasContent
    ? compose.body.split('\n').flatMap((line) => wrapCells(line, bodyTextWidth)).slice(0, 12)
    : ['<empty>']
  const summaryWrapped = wrapCells(`${compose.summary || '<empty>'}${summaryCursor}`, bodyTextWidth)
  const summaryFirst = `${compose.field === 'summary' && compose.editing ? '>' : ' '} Summary: ${summaryWrapped[0] || ''}`
  const summaryRest = summaryWrapped.slice(1).map((line) => `           ${line}`)
  const headerLines = [
    statusLine,
    '',
    summaryFirst,
    ...summaryRest,
    `${compose.field === 'body' && compose.editing ? '>' : ' '} Body:`,
    ...bodyVisualLines.map((line, index) => {
      const isLast = index === bodyVisualLines.length - 1
      return `  ${line}${bodyCursor && isLast ? bodyCursor : ''}`
    }),
    '',
  ]
  const trailerLines = [
    ...(compose.message ? ['', compose.message] : []),
    ...(compose.details || []).map((line) => `  ${line}`),
  ]
  const stateLine = compose.editing
    ? 'Enter/tab edits fields, Esc exits edit mode.'
    : 'e edit | c commit | I AI draft'

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    width,
    paddingX: 1,
  },
  h(Text, { bold: true }, panelTitle('Commit', focused)),
  ...headerLines.map((line, index) => h(Text, {
    key: `commit-header-${index}`,
    dimColor: index < 2 || line.startsWith('  ') || line === '<empty>',
  }, truncate(line, width - 4))),
  // Loading indicator + commit result/details stay inline with the body
  // (they describe what just happened to the fields above). The action
  // hint ("e edit | c commit | I AI draft") moves to the bottom of the
  // pane to read as footer guidance, matching the compose surface.
  ...(loading
    ? [h(Text, {
      key: 'commit-loading',
      bold: true,
      color: theme.noColor ? undefined : theme.colors.accent,
    }, truncate(theme.ascii ? '[...] Generating AI draft' : '⏳ Generating AI draft…', width - 4))]
    : []),
  ...trailerLines.map((line, index) => h(Text, {
    key: `commit-trailer-${index}`,
    dimColor: line.startsWith('  '),
  }, truncate(line, width - 4))),
  h(Box, { flexGrow: 1 }),
  loading
    ? null
    : h(Text, { key: 'commit-state', dimColor: true }, truncate(stateLine, width - 4)))
}

function renderInputPromptPanel(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  width: number,
  theme: LogInkTheme,
  focused: boolean
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const prompt = state.inputPrompt
  if (!prompt) {
    return h(Box, { width })
  }

  const accent = theme.noColor ? undefined : theme.colors.accent
  // Multi-line prompts (#806) split on newline and render one Text
  // row per buffer line — the cursor sits at the end of the last
  // line via the trailing `_`. Single-line prompts collapse to the
  // original one-row layout for muscle-memory continuity.
  const promptLines = prompt.multiline ? prompt.value.split('\n') : [prompt.value]
  if (promptLines.length === 0) {
    promptLines.push('')
  }
  const valueRows = promptLines.map((line, index) => {
    const isLast = index === promptLines.length - 1
    const display = isLast ? `${line}_` : line
    return h(Text, {
      key: `prompt-line-${index}`,
      bold: true,
      color: accent,
    }, truncate(display, width - 4))
  })
  const hint = prompt.multiline
    ? 'Enter newline · Ctrl+d submit · Esc cancel · Ctrl+u clear'
    : 'Enter submit · Esc cancel · Ctrl+u clear'

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    width,
    paddingX: 1,
  },
  h(Text, { bold: true }, panelTitle('Prompt', focused)),
  h(Text, { dimColor: true }, truncate(prompt.label, width - 4)),
  h(Text, undefined, ''),
  ...valueRows,
  h(Text, undefined, ''),
  h(Text, { dimColor: true }, hint))
}

function renderConfirmationPanel(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  width: number,
  theme: LogInkTheme,
  focused: boolean
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const action = getLogInkWorkflowActionById(state.pendingConfirmationId)
  const mutationLabel = state.pendingMutationConfirmation === 'revert-hunk'
    ? 'Revert selected hunk'
    : state.pendingMutationConfirmation === 'revert-file'
      ? 'Revert selected file'
      : state.pendingMutationConfirmation === 'discard-draft'
        ? 'Quit and discard the in-progress commit draft'
        : undefined
  const label = action?.label || mutationLabel || 'Workflow action'
  const warning = state.pendingMutationConfirmation === 'discard-draft'
    ? 'You have an unsaved commit draft. Press y to discard it and quit.'
    : state.pendingMutationConfirmation
    ? 'This discards local changes and cannot be undone by Coco.'
    : action?.kind === 'ai'
    ? `AI action requires confirmation. Estimated ${action.estimatedTokens || '<unknown>'} tokens.`
    : 'Destructive Git action requires confirmation.'

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    width,
    paddingX: 1,
  },
  h(Text, { bold: true }, panelTitle('Confirm', focused)),
  h(Text, undefined, truncate(label, width - 4)),
  h(Text, { dimColor: true }, truncate(warning, width - 4)),
  h(Text, undefined, ''),
  h(Text, undefined, 'Press y to confirm or n/Esc to cancel.'))
}

/**
 * First-launch onboarding overlay (P1.3). Shown once per machine, gated
 * by an XDG-style cache marker so subsequent launches go straight to the
 * normal UI. Auto-dismisses on the next keystroke.
 *
 * Replaces the whole layout for the first render rather than overlaying
 * a transient banner — Ink doesn't support floating elements, and a full
 * takeover keeps the message readable on small terminals while still
 * being instantly dismissible.
 */
function renderOnboardingOverlay(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  rows: number,
  columns: number,
  theme: LogInkTheme,
  appLabel: string
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const accent = theme.noColor ? undefined : theme.colors.accent
  const tips = [
    { keys: '?', text: 'open the help panel' },
    { keys: ':', text: 'open the command palette' },
    { keys: 'g h', text: 'jump to history (g s status, g d diff, g c compose, g b branches, g t tags, g z stash)' },
    { keys: '<  esc', text: 'pop the navigation stack / go back' },
    { keys: '/', text: 'filter the active list' },
    { keys: 'q  ctrl+c', text: 'quit' },
  ]
  const maxKeys = tips.reduce((max, tip) => Math.max(max, tip.keys.length), 0)
  const lineWidth = Math.max(40, columns - 4)

  return h(Box, {
    flexDirection: 'column',
    height: rows,
    paddingX: 2,
    paddingY: 1,
  },
  h(Text, { bold: true, color: accent }, `Welcome to ${appLabel}`),
  h(Text, { dimColor: true }, 'A quick keyboard tour — press any key to dismiss.'),
  h(Text, undefined, ''),
  ...tips.map((tip, index) => h(Text, { key: `onboarding-tip-${index}` },
    h(Text, { color: accent, bold: true }, `  ${tip.keys.padEnd(maxKeys)}  `),
    h(Text, undefined, truncate(tip.text, lineWidth - maxKeys - 4)))),
  h(Text, undefined, ''),
  h(Text, { dimColor: true }, 'This tip is shown once per machine. Press any key to continue.'))
}

/**
 * Which-key style chord overlay (P1.1). When the user presses a chord
 * prefix (currently just `g`), the dispatcher sets `state.pendingKey`
 * and waits for the second key. This panel surfaces the available
 * continuations so newcomers don't have to memorize the chord set.
 *
 * Renders in the detail panel slot; auto-dismisses when the chord
 * completes or `pendingKey` is otherwise cleared.
 */
function renderChordOverlay(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  width: number,
  theme: LogInkTheme,
  focused: boolean
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const prefix = state.pendingKey || ''
  const continuations = getLogInkChordContinuations(prefix)
  const accent = theme.noColor ? undefined : theme.colors.accent

  const lines: ReactTypes.ReactNode[] = [
    h(Text, { key: 'chord-title', bold: true }, panelTitle(`${prefix} … jump`, focused)),
    h(Text, { key: 'chord-spacer' }, ''),
  ]

  if (continuations.length === 0) {
    lines.push(h(Text, {
      key: 'chord-empty',
      dimColor: true,
    }, truncate(`No bindings registered for the ${prefix} prefix.`, width - 4)))
  } else {
    for (const entry of continuations) {
      lines.push(h(Text, { key: `chord-${entry.key}` },
        h(Text, { color: accent, bold: true }, `  ${entry.key}  `),
        h(Text, undefined, truncate(`${entry.label.padEnd(10)} ${entry.description}`, width - 9))
      ))
    }
  }

  lines.push(h(Text, { key: 'chord-foot-spacer' }, ''))
  lines.push(h(Text, {
    key: 'chord-hint',
    dimColor: true,
  }, truncate('press the second key to jump · esc cancels', width - 4)))

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    width,
    paddingX: 1,
  }, ...lines)
}

function renderHelpPanel(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  width: number,
  theme: LogInkTheme,
  focused: boolean
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const children: ReactTypes.ReactNode[] = [
    h(Text, { bold: true, key: 'title' }, panelTitle('Help', focused)),
  ]

  const sections = getLogInkHelpSections({
    activeView: state.activeView,
    focus: state.focus,
  })

  for (const section of sections) {
    children.push(h(Text, { key: `${section.title}-spacer` }, ''))
    children.push(h(Text, { bold: true, key: section.title }, section.title))
    section.bindings.forEach((binding) => {
      children.push(h(Text, { key: `${section.title}:${binding.id}` },
        truncate(`${formatBindingKeys(binding).padEnd(14)} ${binding.description}`, width - 4)
      ))
    })
  }

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    width,
    paddingX: 1,
  }, ...children)
}

function renderCommandPalette(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  width: number,
  theme: LogInkTheme,
  focused: boolean
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const all = getLogInkPaletteCommands()
  const filtered = filterLogInkPaletteCommands(all, state.paletteFilter, state.paletteRecent)
  const recentSet = new Set(state.paletteRecent)
  const showingRecent = !state.paletteFilter.trim() && state.paletteRecent.length > 0

  const selectedIndex = filtered.length === 0
    ? 0
    : Math.max(0, Math.min(state.paletteSelectedIndex, filtered.length - 1))

  // Slide a window of rows around the selection so the cursor stays visible
  // even with hundreds of bindings.
  const listRows = 14
  const startIndex = Math.max(0, selectedIndex - Math.floor(listRows / 2))
  const visible = filtered.slice(startIndex, startIndex + listRows)

  const inputLine = `> ${state.paletteFilter}_`
  const matchSummary = filtered.length === 0
    ? 'no matches'
    : `${filtered.length} ${filtered.length === 1 ? 'match' : 'matches'}`
  const hint = '↑/↓ select · enter run · esc close'

  const itemLines = filtered.length === 0
    ? [h(Text, { key: 'palette-empty', dimColor: true }, 'No commands match the current filter.')]
    : visible.map((command, offset) => {
      const index = startIndex + offset
      const isSelected = index === selectedIndex
      const cursor = isSelected ? '>' : ' '
      const recentMarker = showingRecent && recentSet.has(command.id) ? '·' : ' '
      const kindMarker = command.kind === 'workflow'
        ? command.workflowKind === 'ai'
          ? '[AI]'
          : command.requiresConfirmation
            ? '[confirm]'
            : '[action]'
        : ''
      const line = `${cursor} ${recentMarker} ${command.keys.padEnd(8)} ${command.label.padEnd(20)} ${kindMarker ? `${kindMarker} ` : ''}${command.description}`
      return h(Text, {
        key: `palette-${command.kind}-${command.id}`,
        bold: isSelected,
        dimColor: !isSelected,
      }, truncate(line, width - 4))
    })

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    width,
    paddingX: 1,
  },
  h(Box, { justifyContent: 'space-between' },
    h(Text, { bold: true }, panelTitle('Command palette', focused)),
    h(Text, { dimColor: true }, matchSummary)
  ),
  h(Text, { color: theme.colors.accent }, truncate(inputLine, width - 4)),
  h(Text, { dimColor: true }, truncate(hint, width - 4)),
  h(Text, undefined, ''),
  ...(showingRecent
    ? [h(Text, { key: 'palette-recent-hint', dimColor: true }, '· marks recently-used')]
    : []),
  ...itemLines)
}

function renderFooter(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  context: LogInkContext,
  theme: LogInkTheme,
  idleTip?: string
): ReactTypes.ReactElement {
  const { Box, Text } = components
  // Sidebar item count drives the per-tab footer hints — when items are
  // present the footer surfaces in-sidebar ops (checkout / apply / pop /
  // drop), otherwise it falls back to the generic "enter open" hint.
  const sidebarItemCount = (() => {
    switch (state.sidebarTab) {
      case 'branches': return context.branches?.localBranches.length
      case 'tags': return context.tags?.tags.length
      case 'stashes': return context.stashes?.stashes.length
      case 'worktrees': return context.worktreeList?.worktrees.length
      default: return undefined
    }
  })()
  const hints = getLogInkFooterHints({
    activeView: state.activeView,
    diffSource: state.diffSource,
    diffViewMode: state.diffViewMode,
    filterMode: state.filterMode,
    focus: state.focus,
    pendingKey: state.pendingKey,
    showCommandPalette: state.showCommandPalette,
    showHelp: state.showHelp,
    sidebarTab: state.sidebarTab,
    sidebarItemCount,
    compareBaseSet: Boolean(state.compareBase),
  })
  // Real status messages always win; idle tips only fill the slot when it
  // would otherwise be empty.
  const trailing = state.statusMessage || idleTip || ''
  const status = trailing ? `  ${trailing}` : ''
  const contextualText = `${hints.contextual.join('   ')}${status}`
  const globalText = hints.global.join(' · ')

  return h(Box, {
    flexDirection: 'row',
    height: 2,
    justifyContent: 'space-between',
    paddingX: 1,
  },
  h(Text, { color: theme.colors.muted, dimColor: true }, contextualText),
  h(Text, { color: theme.colors.muted, dimColor: true }, globalText))
}
