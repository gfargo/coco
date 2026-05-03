import { GitLogCommitRow, GitLogRow, getCommitRows } from './data'
import {
  CommitComposeAction,
  CommitComposeState,
  applyCommitComposeAction,
  createCommitComposeState,
} from './commitCompose'
import { PromotedSelectionsSnapshot } from './inkSelectionRectify'
import {
  BranchSortMode,
  DEFAULT_BRANCH_SORT_MODE,
  DEFAULT_TAG_SORT_MODE,
  TagSortMode,
  cycleBranchSort,
  cycleTagSort,
} from './inkSorting'

export type LogInkFocus = 'sidebar' | 'commits' | 'detail'

export type LogInkSidebarTab = 'status' | 'branches' | 'tags' | 'stashes' | 'worktrees'
export type LogInkView = 'history' | 'status' | 'diff' | 'compose' | 'branches' | 'tags' | 'stash' | 'worktrees' | 'pull-request'
export type LogInkMutationConfirmation = 'revert-file' | 'revert-hunk' | 'discard-draft'
/**
 * Tracks which kind of diff the user pushed into. `commit` means they
 * came from history → Enter on a commit (read-only commit-diff explore
 * mode). `worktree` means they came from status → Enter on a file
 * (stage / hunk / revert mode). The renderer routes the inspector and
 * input handlers off this field so a dirty worktree can't bleed staging
 * UI into a commit-diff view.
 */
export type LogInkDiffSource = 'commit' | 'worktree' | 'stash'
/**
 * Diff rendering mode (#785). `unified` is the historical single-column
 * patch view; `split` lays the same lines out side-by-side (removals on
 * the left, additions on the right) for wide terminals. The toggle is
 * scoped to the diff view (`d` key) and falls back to unified at render
 * time when the terminal is too narrow — the user's preference is
 * preserved either way.
 */
export type LogInkDiffViewMode = 'unified' | 'split'

/**
 * Inspector tab (#806 follow-up). On tall terminals the inspector
 * stacks the commit-detail block and the actions block together. On
 * short terminals (rows below the layout's tabbed threshold) only one
 * tab renders at a time and the user toggles between them with `[/]`
 * while the inspector is focused. The field is always present in
 * state so the user can pre-set their preference; the renderer
 * decides whether to honor it (short terminal) or stack both
 * (tall terminal).
 */
export type LogInkInspectorTab = 'inspector' | 'actions'

export type CreateLogInkStateOptions = {
  activeView?: LogInkView
}

export type LogInkState = {
  /**
   * Top of `viewStack`. Maintained as a denormalized field so existing call
   * sites can read the active view without dereferencing the stack.
   */
  activeView: LogInkView
  /**
   * Navigation stack. Always non-empty; bottom is the root view, top is
   * `activeView`. Push/pop/replace actions keep both fields in sync.
   */
  viewStack: LogInkView[]
  rows: GitLogRow[]
  commits: GitLogCommitRow[]
  filteredCommits: GitLogCommitRow[]
  selectedIndex: number
  selectedFileIndex: number
  selectedWorktreeFileIndex: number
  selectedWorktreeHunkIndex: number
  /**
   * Cursor positions for the promoted top-level views (branches/tags/stash).
   * Persisted on the root state so navigating away and back keeps the user's
   * place in each list.
   */
  selectedBranchIndex: number
  selectedTagIndex: number
  selectedStashIndex: number
  selectedWorktreeListIndex: number
  /**
   * Sort modes for the promoted views (P4.2). `s` cycles through the
   * available modes; the surface header shows a `▼ <mode>` indicator.
   * Defaults match the existing display order so opting out is a no-op.
   */
  branchSort: BranchSortMode
  tagSort: TagSortMode
  commitCompose: CommitComposeState
  diffPreviewOffset: number
  worktreeDiffOffset: number
  filter: string
  filterMode: boolean
  fullGraph: boolean
  showHelp: boolean
  showCommandPalette: boolean
  /**
   * Command-palette interaction state. `paletteFilter` is the user-typed
   * fuzzy query. `paletteSelectedIndex` is a cursor into the filtered list.
   * `paletteRecent` keeps recently-executed command IDs so the palette can
   * float them to the top when the filter is empty.
   */
  paletteFilter: string
  paletteSelectedIndex: number
  paletteRecent: string[]
  workflowActionId?: string
  pendingConfirmationId?: string
  /**
   * Optional payload carried into the y-confirm path. When the user
   * answers `y`, the confirmation handler forwards this value to the
   * runtime workflow runner so workflows that need a captured target
   * (selected file path, sha+path, etc.) can resolve it without re-
   * walking state.
   */
  pendingConfirmationPayload?: string
  pendingMutationConfirmation?: LogInkMutationConfirmation
  pendingKey?: string
  focus: LogInkFocus
  sidebarTab: LogInkSidebarTab
  /**
   * The user's last *explicit* sidebar tab choice. Only changes when
   * the user picks a tab themselves (number-key, [/], or palette). The
   * auto-switch in `withPushedView` (compose / status views) updates
   * `sidebarTab` for display only — `userSidebarTab` stays put so:
   *
   *  - Per-repo persistence (#21) only writes when the user actually
   *    changes the tab, never on incidental view pushes.
   *  - Popping back from compose / status restores the tab the user
   *    had open before they opened those surfaces.
   */
  userSidebarTab: LogInkSidebarTab
  /**
   * When true, the cursor sits on the active sidebar tab's *header*
   * rather than on an item inside the list. Pressing Enter drills
   * into the dedicated view (`g b`/`g t`/`g z`/`g w`/`g s`) instead
   * of firing a per-entity action.
   *
   * Triggered by pressing ↑ at item index 0; cleared by pressing ↓
   * (cursor re-enters the list at index 0). Persists across ←/→ tab
   * switches so the user can scan headers tab-to-tab and drill in.
   * Resets whenever focus leaves the sidebar so the next sidebar
   * focus starts on items.
   */
  sidebarHeaderFocused: boolean
  statusMessage?: string
  /**
   * Set by `navigateOpenDiffForCommit` / `navigateOpenDiffForWorktreeFile`
   * to disambiguate the diff view when both a worktree file and a commit
   * are selectable. Cleared when the diff view is popped or replaced.
   */
  diffSource?: LogInkDiffSource
  /**
   * Stash ref (e.g. `stash@{0}`) currently being inspected in the diff
   * view. Set by `navigateOpenDiffForStash`; cleared when the diff view
   * is popped or replaced.
   */
  stashDiffRef?: string
  /**
   * When true, the cursor sits on the synthetic "(+) new commit" row
   * that the history panel renders above the real commits whenever the
   * worktree is dirty. `getSelectedInkCommit` returns undefined in this
   * state, so the inspector and diff panels fall through to the worktree
   * summary view.
   *
   * The reducer transitions in/out via the `move` action: pressing up
   * (delta -1) at `selectedIndex === 0` flips the flag on; pressing
   * down (delta +1) while focused unflips it. The history renderer is
   * responsible for hiding the synthetic row when the worktree is clean.
   */
  pendingCommitFocused?: boolean
  /**
   * Active text-input prompt overlay. Drives create-branch / create-tag /
   * etc. flows where we need a free-text value before running an action.
   * When set, all keystrokes route into the prompt until Enter (submit)
   * or Esc (cancel) is pressed.
   */
  inputPrompt?: LogInkInputPromptState
  /**
   * Visibility mask for the status surface (#776). Each flag controls
   * whether files of that staging category are rendered. Default: all
   * three on. Pressing `1`/`2`/`3` while the status view is active
   * toggles the matching bit; if a toggle would zero the mask, it snaps
   * back to all-on so the user always has something to look at.
   */
  statusFilterMask: LogInkStatusFilterMask
  /**
   * Server-side history filter, set when the user submits a filter that
   * begins with `path:` or `author:` (#776). The runtime re-runs
   * `getLogRows` with the matching `--author=` / `-- <path>` args; the
   * panel header surfaces what's active. Cleared when the filter is
   * cleared.
   */
  historyFetchArgs?: LogInkHistoryFetchArgs
  /**
   * Diff view rendering mode (#785). `unified` (default) keeps the
   * historical single-column patch view; `split` lays removals on the
   * left and additions on the right. The renderer falls back to
   * unified at paint time when the terminal is too narrow — this field
   * stores the user's preference, not the effective render mode.
   */
  diffViewMode: LogInkDiffViewMode
  /**
   * Inspector tab — see `LogInkInspectorTab`. Defaults to 'inspector'
   * so first paint shows the commit metadata; the user toggles via
   * `[/]` when the inspector is focused on a short terminal.
   */
  inspectorTab: LogInkInspectorTab
}

export type LogInkStatusFilterMask = {
  staged: boolean
  unstaged: boolean
  untracked: boolean
}

export type LogInkHistoryFetchArgs = {
  author?: string
  path?: string
}

export const DEFAULT_LOG_INK_STATUS_FILTER_MASK: LogInkStatusFilterMask = {
  staged: true,
  unstaged: true,
  untracked: true,
}

/**
 * Detect a history server-side filter prefix (#776). Returns the parsed
 * `LogInkHistoryFetchArgs` for `path:<value>` and `author:<value>`
 * prefixes, or `undefined` for a plain (client-side) filter. The whole
 * remainder of the string (post-prefix) becomes the value — paths and
 * author names commonly contain spaces, and we don't try to parse
 * shell-like syntax.
 */
export function parseLogInkHistoryFetchPrefix(filter: string): LogInkHistoryFetchArgs | undefined {
  const trimmed = filter.trim()
  if (trimmed.startsWith('path:')) {
    const value = trimmed.slice('path:'.length).trim()
    return value ? { path: value } : undefined
  }
  if (trimmed.startsWith('author:')) {
    const value = trimmed.slice('author:'.length).trim()
    return value ? { author: value } : undefined
  }
  return undefined
}

export type LogInkInputPromptKind =
  | 'create-branch'
  | 'create-branch-here'
  | 'create-tag'
  | 'create-tag-here'
  | 'rename-branch'
  | 'set-upstream'
  | 'create-stash'
  | 'reset-mode'
  | 'pr-merge-strategy'
  | 'pr-comment'
  | 'pr-request-changes'

export type LogInkInputPromptState = {
  kind: LogInkInputPromptKind
  label: string
  value: string
  /**
   * Free-form text mode (#806). When true:
   *   - Enter inserts a literal newline into `value`
   *   - Ctrl+D submits (Unix EOF convention — more reliable across
   *     terminals + Ink than Ctrl+Enter, which most terminals
   *     deliver as plain Enter)
   *   - Backspace, Ctrl+U, Esc behave the same as single-line mode
   * Opt-in per prompt — structured prompts (branch / tag / stash
   * names, merge strategies, reset modes) stay single-line so muscle
   * memory survives.
   */
  multiline?: boolean
}

export type LogInkAction =
  | { type: 'appendRows'; rows: GitLogRow[] }
  | { type: 'replaceRows'; rows: GitLogRow[] }
  | { type: 'appendFilter'; value: string; promotedSelections?: PromotedSelectionsSnapshot }
  | { type: 'backspaceFilter'; promotedSelections?: PromotedSelectionsSnapshot }
  | { type: 'clearFilter'; promotedSelections?: PromotedSelectionsSnapshot }
  | { type: 'clearFilterText'; promotedSelections?: PromotedSelectionsSnapshot }
  | { type: 'commitCompose'; action: CommitComposeAction }
  | { type: 'focusNext' }
  | { type: 'focusPrevious' }
  | { type: 'move'; delta: number }
  | { type: 'selectCommitByHash'; hash: string }
  | { type: 'moveDetailFile'; delta: number; fileCount: number }
  | { type: 'moveWorktreeFile'; delta: number; fileCount: number }
  | { type: 'moveBranch'; delta: number; count: number }
  | { type: 'resetBranchSelection' }
  | { type: 'setSidebarHeaderFocused'; value: boolean }
  | { type: 'setInspectorTab'; value: LogInkInspectorTab }
  | { type: 'cycleInspectorTab'; delta: -1 | 1 }
  | { type: 'moveTag'; delta: number; count: number }
  | { type: 'moveStash'; delta: number; count: number }
  | { type: 'moveWorktreeListEntry'; delta: number; count: number }
  | { type: 'moveToBottom' }
  | { type: 'moveToTop' }
  | { type: 'nextSidebarTab' }
  | { type: 'page'; delta: number }
  | { type: 'pageDetailPreview'; delta: number; previewLineCount: number }
  | { type: 'pageWorktreeDiff'; delta: number; lineCount: number }
  | { type: 'previousSidebarTab' }
  | { type: 'setFilter'; value: string; promotedSelections?: PromotedSelectionsSnapshot }
  | { type: 'setActiveView'; value: LogInkView }
  | { type: 'pushView'; value: LogInkView }
  | { type: 'popView' }
  | { type: 'replaceView'; value: LogInkView }
  | { type: 'navigateHome' }
  | { type: 'navigateOpenDiffForCommit'; sha: string; commitIndex: number; fileIndex?: number }
  | { type: 'navigateOpenDiffForWorktreeFile'; fileIndex: number }
  | { type: 'navigateOpenDiffForStash'; ref: string; stashIndex?: number }
  | { type: 'navigateOpenComposeForFile'; fileIndex: number }
  | { type: 'jumpWorktreeHunk'; delta: number; hunkOffsets: number[] }
  | { type: 'jumpCommitDiffHunk'; delta: number; hunkOffsets: number[] }
  | { type: 'focusPendingCommit' }
  | { type: 'unfocusPendingCommit' }
  | { type: 'setFocus'; value: LogInkFocus }
  | { type: 'setPendingKey'; value?: string }
  | { type: 'setSidebarTab'; value: LogInkSidebarTab }
  | { type: 'restoreSidebarTab'; value: LogInkSidebarTab }
  | { type: 'setStatus'; value?: string }
  | { type: 'setWorkflowAction'; value?: string }
  | { type: 'setPendingConfirmation'; value?: string; payload?: string }
  | { type: 'setPendingMutationConfirmation'; value?: LogInkMutationConfirmation }
  | { type: 'appendPaletteFilter'; value: string }
  | { type: 'backspacePaletteFilter' }
  | { type: 'clearPaletteFilter' }
  | { type: 'movePaletteSelection'; delta: number; commandCount: number }
  | { type: 'recordPaletteRecent'; value: string }
  | { type: 'toggleFilterMode' }
  | { type: 'toggleGraph' }
  | { type: 'toggleHelp' }
  | { type: 'toggleCommandPalette' }
  | { type: 'cycleBranchSort' }
  | { type: 'cycleTagSort' }
  | { type: 'openInputPrompt'; kind: LogInkInputPromptKind; label: string; initial?: string; multiline?: boolean }
  | { type: 'appendInputPrompt'; value: string }
  | { type: 'backspaceInputPrompt' }
  | { type: 'clearInputPromptText' }
  | { type: 'closeInputPrompt' }
  | { type: 'toggleStatusFilterMask'; kind: keyof LogInkStatusFilterMask }
  | { type: 'setHistoryFetchArgs'; value?: LogInkHistoryFetchArgs }
  | { type: 'toggleDiffViewMode' }
  | { type: 'setDiffViewMode'; value: LogInkDiffViewMode }

const FOCUS_ORDER: LogInkFocus[] = ['sidebar', 'commits', 'detail']
const SIDEBAR_TABS: LogInkSidebarTab[] = ['status', 'branches', 'tags', 'stashes', 'worktrees']

function searchableFields(commit: GitLogCommitRow): string[] {
  return [
    commit.shortHash,
    commit.hash,
    commit.date,
    commit.author,
    commit.message,
    ...commit.refs,
  ]
}

function scoreField(field: string, term: string): number | undefined {
  const value = field.toLowerCase()
  const normalized = term.toLowerCase()

  if (!normalized) {
    return 0
  }

  if (value === normalized) {
    return 1000
  }

  if (value.startsWith(normalized)) {
    return 800 - Math.min(value.length - normalized.length, 200)
  }

  const substringIndex = value.indexOf(normalized)

  if (substringIndex >= 0) {
    return 600 - Math.min(substringIndex, 200)
  }

  let searchIndex = 0
  let distance = 0

  for (const character of normalized) {
    const nextIndex = value.indexOf(character, searchIndex)

    if (nextIndex < 0) {
      return undefined
    }

    distance += nextIndex - searchIndex
    searchIndex = nextIndex + 1
  }

  return 300 - Math.min(distance, 200)
}

export function scoreLogInkCommitFilter(commit: GitLogCommitRow, filter: string): number | undefined {
  const terms = filter.trim().split(/\s+/).filter(Boolean)

  if (terms.length === 0) {
    return 0
  }

  const fields = searchableFields(commit)
  let score = 0

  for (const term of terms) {
    const bestFieldScore = fields.reduce<number | undefined>((best, field) => {
      const fieldScore = scoreField(field, term)

      if (fieldScore === undefined) {
        return best
      }

      return best === undefined ? fieldScore : Math.max(best, fieldScore)
    }, undefined)

    if (bestFieldScore === undefined) {
      return undefined
    }

    score += bestFieldScore
  }

  return score
}

function filterCommits(commits: GitLogCommitRow[], filter: string): GitLogCommitRow[] {
  return commits
    .map((commit, index) => ({
      commit,
      index,
      score: scoreLogInkCommitFilter(commit, filter),
    }))
    .filter((entry): entry is { commit: GitLogCommitRow; index: number; score: number } =>
      entry.score !== undefined
    )
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.commit)
}

function clampIndex(index: number, length: number): number {
  if (length === 0) {
    return 0
  }

  return Math.max(0, Math.min(index, length - 1))
}

function cycleValue<T>(values: T[], current: T, delta: number): T {
  const currentIndex = Math.max(0, values.indexOf(current))
  const nextIndex = (currentIndex + delta + values.length) % values.length

  return values[nextIndex]
}

const HOME_VIEW: LogInkView = 'history'

function topOfStack(stack: LogInkView[]): LogInkView {
  return stack[stack.length - 1]
}

function withPushedView(state: LogInkState, value: LogInkView): LogInkState {
  if (topOfStack(state.viewStack) === value) {
    return { ...state, pendingKey: undefined }
  }

  const viewStack = [...state.viewStack, value]
  return {
    ...state,
    activeView: value,
    viewStack,
    // The compose + status views' right detail panels already show
    // worktree info, so keeping the left sidebar on the Status tab
    // duplicates that information. Auto-switch to Branches when entering
    // either view; the user can swap back with [/] if they want.
    //
    // We update only the rendered `sidebarTab` here, never
    // `userSidebarTab`, so this auto-switch is invisible to per-repo
    // persistence and pop-view restores the previous tab.
    sidebarTab: value === 'compose' || value === 'status' ? 'branches' : state.sidebarTab,
    worktreeDiffOffset: value === 'diff' ? state.worktreeDiffOffset : 0,
    selectedWorktreeHunkIndex: value === 'diff' ? state.selectedWorktreeHunkIndex : 0,
    diffSource: value === 'diff' ? state.diffSource : undefined,
    stashDiffRef: value === 'diff' ? state.stashDiffRef : undefined,
    pendingCommitFocused: value === 'history' ? state.pendingCommitFocused : false,
    pendingKey: undefined,
  }
}

function withPoppedView(state: LogInkState): LogInkState {
  if (state.viewStack.length <= 1) {
    return { ...state, pendingKey: undefined }
  }

  const viewStack = state.viewStack.slice(0, -1)
  const next = topOfStack(viewStack)
  return {
    ...state,
    activeView: next,
    viewStack,
    // Restore the user's last explicit tab choice so popping out of
    // compose / status (which auto-switch the sidebar to Branches)
    // returns the user to whatever they actually had open before.
    sidebarTab: state.userSidebarTab,
    worktreeDiffOffset: next === 'diff' ? state.worktreeDiffOffset : 0,
    selectedWorktreeHunkIndex: next === 'diff' ? state.selectedWorktreeHunkIndex : 0,
    diffSource: next === 'diff' ? state.diffSource : undefined,
    stashDiffRef: next === 'diff' ? state.stashDiffRef : undefined,
    pendingCommitFocused: next === 'history' ? state.pendingCommitFocused : false,
    pendingKey: undefined,
  }
}

function withReplacedView(state: LogInkState, value: LogInkView): LogInkState {
  if (topOfStack(state.viewStack) === value) {
    return { ...state, pendingKey: undefined }
  }

  const viewStack = [...state.viewStack.slice(0, -1), value]
  return {
    ...state,
    activeView: value,
    viewStack,
    worktreeDiffOffset: value === 'diff' ? state.worktreeDiffOffset : 0,
    selectedWorktreeHunkIndex: value === 'diff' ? state.selectedWorktreeHunkIndex : 0,
    diffSource: value === 'diff' ? state.diffSource : undefined,
    stashDiffRef: value === 'diff' ? state.stashDiffRef : undefined,
    pendingCommitFocused: value === 'history' ? state.pendingCommitFocused : false,
    pendingKey: undefined,
  }
}

function withFilter(
  state: LogInkState,
  filter: string,
  promotedSelections?: PromotedSelectionsSnapshot
): LogInkState {
  const filteredCommits = filterCommits(state.commits, filter)
  // P4.5: rectify promoted-view selections when the filter changes. Prefer
  // the runtime-supplied snapshot — which preserves the cursor on the same
  // item when it's still in the filtered list and only snaps to result[0]
  // when the previously-selected item dropped out. Falls back to the older
  // "snap to 0" behavior when no snapshot was provided (test paths,
  // dispatchers without context).
  const filterChanged = state.filter !== filter
  const branchIndex = promotedSelections?.branchIndex ??
    (filterChanged ? 0 : state.selectedBranchIndex)
  const tagIndex = promotedSelections?.tagIndex ??
    (filterChanged ? 0 : state.selectedTagIndex)
  const stashIndex = promotedSelections?.stashIndex ??
    (filterChanged ? 0 : state.selectedStashIndex)

  return {
    ...state,
    filter,
    filteredCommits,
    selectedIndex: clampIndex(state.selectedIndex, filteredCommits.length),
    selectedFileIndex: 0,
    selectedBranchIndex: branchIndex,
    selectedTagIndex: tagIndex,
    selectedStashIndex: stashIndex,
    diffPreviewOffset: 0,
    pendingKey: undefined,
  }
}

function replaceRows(state: LogInkState, rows: GitLogRow[]): LogInkState {
  // Wholesale row replacement after a server-side re-fetch (#776).
  // Resets the cursor to the top because the new commit set may not
  // share any hashes with the old one (e.g. switching from `--all` to
  // `-- some/path` typically dumps the previous selection).
  const commits = getCommitRows(rows)
  const filteredCommits = filterCommits(commits, state.filter)
  return {
    ...state,
    rows,
    commits,
    filteredCommits,
    selectedIndex: 0,
    selectedFileIndex: 0,
    pendingCommitFocused: false,
    pendingKey: undefined,
  }
}

function appendRows(state: LogInkState, rows: GitLogRow[]): LogInkState {
  const selected = getSelectedInkCommit(state)
  const nextRows = [...state.rows, ...rows]
  const seen = new Set<string>()
  const commits = getCommitRows(nextRows).filter((commit) => {
    if (seen.has(commit.hash)) {
      return false
    }

    seen.add(commit.hash)
    return true
  })
  const filteredCommits = filterCommits(commits, state.filter)
  const selectedIndex = selected
    ? filteredCommits.findIndex((commit) => commit.hash === selected.hash)
    : state.selectedIndex

  return {
    ...state,
    rows: nextRows,
    commits,
    filteredCommits,
    selectedIndex: selectedIndex >= 0
      ? selectedIndex
      : clampIndex(state.selectedIndex, filteredCommits.length),
    pendingKey: undefined,
  }
}

function nextHunkOffset(currentOffset: number, hunkOffsets: number[], delta: number): number {
  if (hunkOffsets.length === 0) {
    return currentOffset
  }

  if (delta > 0) {
    const nextOffset = hunkOffsets.find((offset) => offset > currentOffset)
    return nextOffset === undefined ? currentOffset : nextOffset
  }

  const previousOffset = [...hunkOffsets].reverse().find((offset) => offset < currentOffset)
  return previousOffset === undefined ? currentOffset : previousOffset
}

function nextHunkIndex(currentOffset: number, hunkOffsets: number[], delta: number): number {
  const offset = nextHunkOffset(currentOffset, hunkOffsets, delta)

  return Math.max(0, hunkOffsets.indexOf(offset))
}

export function getLogInkSidebarTabs(): LogInkSidebarTab[] {
  return [...SIDEBAR_TABS]
}

export function createLogInkState(
  rows: GitLogRow[],
  options: CreateLogInkStateOptions = {}
): LogInkState {
  const commits = getCommitRows(rows)
  const initialView: LogInkView = options.activeView || 'history'

  return {
    activeView: initialView,
    viewStack: [initialView],
    rows,
    commits,
    filteredCommits: commits,
    selectedIndex: 0,
    selectedFileIndex: 0,
    selectedWorktreeFileIndex: 0,
    selectedWorktreeHunkIndex: 0,
    selectedBranchIndex: 0,
    selectedTagIndex: 0,
    selectedStashIndex: 0,
    selectedWorktreeListIndex: 0,
    branchSort: DEFAULT_BRANCH_SORT_MODE,
    tagSort: DEFAULT_TAG_SORT_MODE,
    paletteFilter: '',
    paletteSelectedIndex: 0,
    paletteRecent: [],
    commitCompose: createCommitComposeState(),
    diffPreviewOffset: 0,
    worktreeDiffOffset: 0,
    filter: '',
    filterMode: false,
    fullGraph: false,
    showHelp: false,
    showCommandPalette: false,
    workflowActionId: undefined,
    pendingConfirmationId: undefined,
    pendingConfirmationPayload: undefined,
    pendingMutationConfirmation: undefined,
    pendingKey: undefined,
    focus: 'commits',
    sidebarTab: 'status',
    userSidebarTab: 'status',
    sidebarHeaderFocused: false,
    statusFilterMask: { ...DEFAULT_LOG_INK_STATUS_FILTER_MASK },
    diffViewMode: 'unified',
    inspectorTab: 'inspector',
  }
}

export function getSelectedInkCommit(state: LogInkState): GitLogCommitRow | undefined {
  if (state.pendingCommitFocused) {
    // The cursor is on the synthetic "(+) new commit" row, not a real
    // commit; callers (detail loaders, diff intents) should treat this as
    // "no commit selected" and route to the worktree summary instead.
    return undefined
  }
  return state.filteredCommits[state.selectedIndex]
}

export function applyLogInkAction(state: LogInkState, action: LogInkAction): LogInkState {
  switch (action.type) {
    case 'appendRows':
      return appendRows(state, action.rows)
    case 'replaceRows':
      return replaceRows(state, action.rows)
    case 'appendFilter':
      return withFilter(state, `${state.filter}${action.value}`, action.promotedSelections)
    case 'backspaceFilter':
      return withFilter(state, state.filter.slice(0, -1), action.promotedSelections)
    case 'clearFilter':
      return withFilter({
        ...state,
        filterMode: false,
      }, '', action.promotedSelections)
    case 'clearFilterText':
      // Clears the filter input but stays in filterMode so the user can
      // keep typing. P2.4 / P4.4: pairs with the two-stage Esc semantics.
      return withFilter(state, '', action.promotedSelections)
    case 'commitCompose':
      return {
        ...state,
        commitCompose: applyCommitComposeAction(state.commitCompose, action.action),
        pendingKey: undefined,
      }
    case 'focusNext':
      return {
        ...state,
        focus: cycleValue(FOCUS_ORDER, state.focus, 1),
        // Reset header focus when leaving the sidebar so the next
        // re-entry starts on items rather than mid-flag.
        sidebarHeaderFocused: false,
        pendingKey: undefined,
      }
    case 'focusPrevious':
      return {
        ...state,
        focus: cycleValue(FOCUS_ORDER, state.focus, -1),
        sidebarHeaderFocused: false,
        pendingKey: undefined,
      }
    case 'move':
      return {
        ...state,
        selectedIndex: clampIndex(state.selectedIndex + action.delta, state.filteredCommits.length),
        selectedFileIndex: 0,
        diffPreviewOffset: 0,
        pendingCommitFocused: false,
        pendingKey: undefined,
      }
    case 'selectCommitByHash': {
      // Locates a commit by its full or short hash within the active
      // filtered list and snaps the cursor to it. Used by the
      // branch/tag auto-jump effect (#806 follow-up): cursoring a
      // branch in the sidebar tracks the history view to that
      // branch's tip without the user manually scrolling. No-op when
      // the hash isn't in the loaded list (the runtime surfaces a
      // status hint in that case).
      const target = action.hash
      const index = state.filteredCommits.findIndex((commit) =>
        commit.hash === target || commit.shortHash === target
      )
      if (index < 0) {
        return state
      }
      return {
        ...state,
        selectedIndex: index,
        selectedFileIndex: 0,
        diffPreviewOffset: 0,
        pendingCommitFocused: false,
        pendingKey: undefined,
      }
    }
    case 'focusPendingCommit':
      return {
        ...state,
        pendingCommitFocused: true,
        selectedFileIndex: 0,
        diffPreviewOffset: 0,
        pendingKey: undefined,
      }
    case 'unfocusPendingCommit':
      return {
        ...state,
        pendingCommitFocused: false,
        selectedIndex: 0,
        selectedFileIndex: 0,
        diffPreviewOffset: 0,
        pendingKey: undefined,
      }
    case 'moveDetailFile':
      return {
        ...state,
        selectedFileIndex: clampIndex(state.selectedFileIndex + action.delta, action.fileCount),
        diffPreviewOffset: 0,
        pendingKey: undefined,
      }
    case 'moveWorktreeFile': {
      const next = withReplacedView(state, 'status')
      return {
        ...next,
        selectedWorktreeFileIndex: clampIndex(
          state.selectedWorktreeFileIndex + action.delta,
          action.fileCount
        ),
        selectedWorktreeHunkIndex: 0,
        worktreeDiffOffset: 0,
      }
    }
    case 'moveBranch':
      return {
        ...state,
        selectedBranchIndex: clampIndex(state.selectedBranchIndex + action.delta, action.count),
        pendingKey: undefined,
      }
    case 'resetBranchSelection':
      // Snap the branches sidebar / view cursor back to position 0.
      // Used after a successful checkout (#806 follow-up): combined
      // with the "current branch pinned at top" rule from #809, this
      // lands the user's cursor on the just-checked-out branch.
      return {
        ...state,
        selectedBranchIndex: 0,
        pendingKey: undefined,
      }
    case 'setSidebarHeaderFocused':
      return {
        ...state,
        sidebarHeaderFocused: action.value,
        pendingKey: undefined,
      }
    case 'setInspectorTab':
      return {
        ...state,
        inspectorTab: action.value,
        pendingKey: undefined,
      }
    case 'cycleInspectorTab': {
      // Two-tab toggle — `delta` is symmetrical so direction does not
      // matter, but we keep the action shape consistent with the
      // sidebar's `nextSidebarTab` / `previousSidebarTab` so callers
      // can mirror the sidebar pattern verbatim.
      const next: LogInkInspectorTab = state.inspectorTab === 'inspector' ? 'actions' : 'inspector'
      return {
        ...state,
        inspectorTab: next,
        pendingKey: undefined,
      }
    }
    case 'moveTag':
      return {
        ...state,
        selectedTagIndex: clampIndex(state.selectedTagIndex + action.delta, action.count),
        pendingKey: undefined,
      }
    case 'moveStash':
      return {
        ...state,
        selectedStashIndex: clampIndex(state.selectedStashIndex + action.delta, action.count),
        pendingKey: undefined,
      }
    case 'moveWorktreeListEntry':
      return {
        ...state,
        selectedWorktreeListIndex: clampIndex(state.selectedWorktreeListIndex + action.delta, action.count),
        pendingKey: undefined,
      }
    case 'cycleBranchSort':
      return {
        ...state,
        branchSort: cycleBranchSort(state.branchSort),
        // Snap to the top of the (newly ordered) list so the user always
        // sees what's now most relevant under the new mode.
        selectedBranchIndex: 0,
        pendingKey: undefined,
      }
    case 'cycleTagSort':
      return {
        ...state,
        tagSort: cycleTagSort(state.tagSort),
        selectedTagIndex: 0,
        pendingKey: undefined,
      }
    case 'openInputPrompt':
      return {
        ...state,
        inputPrompt: {
          kind: action.kind,
          label: action.label,
          value: action.initial || '',
          multiline: action.multiline,
        },
        pendingKey: undefined,
      }
    case 'appendInputPrompt':
      return state.inputPrompt
        ? { ...state, inputPrompt: { ...state.inputPrompt, value: `${state.inputPrompt.value}${action.value}` } }
        : state
    case 'backspaceInputPrompt':
      return state.inputPrompt
        ? { ...state, inputPrompt: { ...state.inputPrompt, value: state.inputPrompt.value.slice(0, -1) } }
        : state
    case 'clearInputPromptText':
      return state.inputPrompt
        ? { ...state, inputPrompt: { ...state.inputPrompt, value: '' } }
        : state
    case 'closeInputPrompt':
      return { ...state, inputPrompt: undefined, pendingKey: undefined }
    case 'toggleStatusFilterMask': {
      const next = { ...state.statusFilterMask, [action.kind]: !state.statusFilterMask[action.kind] }
      // If the user just zeroed the mask, snap back to all-on rather
      // than rendering an empty pane. Keeps the affordance reversible
      // without requiring a "reset" key.
      const allOff = !next.staged && !next.unstaged && !next.untracked
      return {
        ...state,
        statusFilterMask: allOff ? { ...DEFAULT_LOG_INK_STATUS_FILTER_MASK } : next,
        selectedWorktreeFileIndex: 0,
        pendingKey: undefined,
      }
    }
    case 'setHistoryFetchArgs':
      return { ...state, historyFetchArgs: action.value, pendingKey: undefined }
    case 'toggleDiffViewMode':
      // Reset the scroll offsets so the new mode opens at the top — long
      // lines wrap differently in split mode (the renderer truncates per
      // column instead of per row), so the saved offset can land on a
      // different visual line. Snap to the top is simpler than mapping
      // unified offsets to split offsets.
      return {
        ...state,
        diffViewMode: state.diffViewMode === 'unified' ? 'split' : 'unified',
        diffPreviewOffset: 0,
        worktreeDiffOffset: 0,
        pendingKey: undefined,
      }
    case 'setDiffViewMode':
      return {
        ...state,
        diffViewMode: action.value,
        diffPreviewOffset: 0,
        worktreeDiffOffset: 0,
        pendingKey: undefined,
      }
    case 'moveToBottom':
      return {
        ...state,
        selectedIndex: clampIndex(state.filteredCommits.length - 1, state.filteredCommits.length),
        selectedFileIndex: 0,
        diffPreviewOffset: 0,
        pendingCommitFocused: false,
        pendingKey: undefined,
      }
    case 'moveToTop':
      return {
        ...state,
        selectedIndex: 0,
        selectedFileIndex: 0,
        diffPreviewOffset: 0,
        pendingCommitFocused: false,
        pendingKey: undefined,
      }
    case 'nextSidebarTab': {
      const next = cycleValue(SIDEBAR_TABS, state.sidebarTab, 1)
      return {
        ...state,
        sidebarTab: next,
        userSidebarTab: next,
        pendingKey: undefined,
      }
    }
    case 'page':
      return {
        ...state,
        selectedIndex: clampIndex(state.selectedIndex + action.delta, state.filteredCommits.length),
        selectedFileIndex: 0,
        diffPreviewOffset: 0,
        pendingKey: undefined,
      }
    case 'pageDetailPreview':
      return {
        ...state,
        diffPreviewOffset: clampIndex(
          state.diffPreviewOffset + action.delta,
          action.previewLineCount
        ),
        pendingKey: undefined,
      }
    case 'pageWorktreeDiff':
      return {
        ...state,
        worktreeDiffOffset: clampIndex(state.worktreeDiffOffset + action.delta, action.lineCount),
        pendingKey: undefined,
      }
    case 'jumpWorktreeHunk':
      return {
        ...state,
        worktreeDiffOffset: nextHunkOffset(
          state.worktreeDiffOffset,
          action.hunkOffsets,
          action.delta
        ),
        selectedWorktreeHunkIndex: nextHunkIndex(
          state.worktreeDiffOffset,
          action.hunkOffsets,
          action.delta
        ),
        pendingKey: undefined,
      }
    case 'jumpCommitDiffHunk':
      return {
        ...state,
        diffPreviewOffset: nextHunkOffset(
          state.diffPreviewOffset,
          action.hunkOffsets,
          action.delta
        ),
        pendingKey: undefined,
      }
    case 'previousSidebarTab': {
      const previous = cycleValue(SIDEBAR_TABS, state.sidebarTab, -1)
      return {
        ...state,
        sidebarTab: previous,
        userSidebarTab: previous,
        pendingKey: undefined,
      }
    }
    case 'setFilter':
      return withFilter(state, action.value, action.promotedSelections)
    case 'setActiveView':
      return withReplacedView(state, action.value)
    case 'pushView':
      return withPushedView(state, action.value)
    case 'popView':
      return withPoppedView(state)
    case 'replaceView':
      return withReplacedView(state, action.value)
    case 'navigateHome': {
      if (state.viewStack.length === 1 && topOfStack(state.viewStack) === HOME_VIEW) {
        return { ...state, pendingKey: undefined }
      }
      return {
        ...state,
        activeView: HOME_VIEW,
        viewStack: [HOME_VIEW],
        worktreeDiffOffset: 0,
        selectedWorktreeHunkIndex: 0,
        pendingCommitFocused: false,
        pendingKey: undefined,
      }
    }
    case 'navigateOpenDiffForCommit': {
      const next = withPushedView(state, 'diff')
      const filteredCommits = state.filteredCommits
      const idx = filteredCommits.findIndex((commit) => commit.hash === action.sha)
      const selectedIndex = idx >= 0 ? idx : action.commitIndex
      return {
        ...next,
        selectedIndex: clampIndex(selectedIndex, filteredCommits.length),
        selectedFileIndex: Math.max(0, action.fileIndex ?? 0),
        diffPreviewOffset: 0,
        diffSource: 'commit',
      }
    }
    case 'navigateOpenDiffForWorktreeFile': {
      const next = withPushedView(state, 'diff')
      return {
        ...next,
        selectedWorktreeFileIndex: Math.max(0, action.fileIndex),
        selectedWorktreeHunkIndex: 0,
        worktreeDiffOffset: 0,
        diffSource: 'worktree',
      }
    }
    case 'navigateOpenDiffForStash': {
      const next = withPushedView(state, 'diff')
      return {
        ...next,
        diffSource: 'stash',
        stashDiffRef: action.ref,
        selectedStashIndex: Math.max(0, action.stashIndex ?? state.selectedStashIndex),
        // Reset the diff scroll offset so the stash patch always opens
        // at the top, mirroring `navigateOpenDiffForCommit`. Without
        // this, opening a stash inherits whatever offset the previous
        // diff had, landing the user mid-patch.
        diffPreviewOffset: 0,
        worktreeDiffOffset: 0,
      }
    }
    case 'navigateOpenComposeForFile': {
      const next = withPushedView(state, 'status')
      return {
        ...next,
        selectedWorktreeFileIndex: Math.max(0, action.fileIndex),
        selectedWorktreeHunkIndex: 0,
        worktreeDiffOffset: 0,
      }
    }
    case 'setFocus':
      return {
        ...state,
        focus: action.value,
        // Reset sidebar header focus when leaving the sidebar so a
        // re-entry starts on items rather than mid-flag.
        sidebarHeaderFocused: action.value === 'sidebar' ? state.sidebarHeaderFocused : false,
        pendingKey: undefined,
      }
    case 'setPendingKey':
      return {
        ...state,
        pendingKey: action.value,
      }
    case 'setSidebarTab':
      return {
        ...state,
        sidebarTab: action.value,
        userSidebarTab: action.value,
        focus: 'sidebar',
        pendingKey: undefined,
      }
    case 'restoreSidebarTab':
      // Mount-time restore from per-repo persistence (#21). Updates the
      // tab + the user-choice mirror without forcing focus into the
      // sidebar — that's the focus-steal regression flagged in the PR
      // review. Users land on commits as usual; their saved tab is
      // visible in the sidebar but doesn't grab the cursor.
      return {
        ...state,
        sidebarTab: action.value,
        userSidebarTab: action.value,
        pendingKey: undefined,
      }
    case 'setStatus':
      return {
        ...state,
        statusMessage: action.value,
        pendingKey: undefined,
      }
    case 'setWorkflowAction':
      return {
        ...state,
        workflowActionId: action.value,
        pendingConfirmationId: undefined,
        pendingConfirmationPayload: undefined,
        pendingMutationConfirmation: undefined,
        pendingKey: undefined,
      }
    case 'setPendingConfirmation':
      return {
        ...state,
        pendingConfirmationId: action.value,
        pendingConfirmationPayload: action.value ? action.payload : undefined,
        workflowActionId: action.value ? undefined : state.workflowActionId,
        pendingMutationConfirmation: action.value ? undefined : state.pendingMutationConfirmation,
        pendingKey: undefined,
      }
    case 'setPendingMutationConfirmation':
      return {
        ...state,
        pendingMutationConfirmation: action.value,
        pendingConfirmationId: action.value ? undefined : state.pendingConfirmationId,
        pendingConfirmationPayload: action.value ? undefined : state.pendingConfirmationPayload,
        workflowActionId: action.value ? undefined : state.workflowActionId,
        pendingKey: undefined,
      }
    case 'toggleFilterMode':
      return {
        ...state,
        filterMode: !state.filterMode,
        showCommandPalette: false,
        showHelp: false,
        pendingKey: undefined,
      }
    case 'toggleGraph':
      return {
        ...state,
        fullGraph: !state.fullGraph,
        pendingKey: undefined,
      }
    case 'toggleHelp':
      return {
        ...state,
        showHelp: !state.showHelp,
        showCommandPalette: false,
        pendingKey: undefined,
      }
    case 'toggleCommandPalette': {
      const opening = !state.showCommandPalette
      return {
        ...state,
        showCommandPalette: opening,
        showHelp: false,
        // Reset palette interaction state on every open/close so the next
        // session starts from a clean slate.
        paletteFilter: '',
        paletteSelectedIndex: 0,
        pendingKey: undefined,
      }
    }
    case 'appendPaletteFilter':
      return {
        ...state,
        paletteFilter: `${state.paletteFilter}${action.value}`,
        paletteSelectedIndex: 0,
        pendingKey: undefined,
      }
    case 'backspacePaletteFilter':
      return {
        ...state,
        paletteFilter: state.paletteFilter.slice(0, -1),
        paletteSelectedIndex: 0,
        pendingKey: undefined,
      }
    case 'clearPaletteFilter':
      return {
        ...state,
        paletteFilter: '',
        paletteSelectedIndex: 0,
        pendingKey: undefined,
      }
    case 'movePaletteSelection':
      return {
        ...state,
        paletteSelectedIndex: clampIndex(
          state.paletteSelectedIndex + action.delta,
          action.commandCount
        ),
        pendingKey: undefined,
      }
    case 'recordPaletteRecent': {
      const next = [action.value, ...state.paletteRecent.filter((id) => id !== action.value)]
      return {
        ...state,
        paletteRecent: next.slice(0, 8),
        pendingKey: undefined,
      }
    }
    default:
      return state
  }
}

/**
 * Navigation intents — high-level transitions the rest of the app calls
 * instead of pushing/popping the view stack directly. Each intent returns
 * either a `LogInkAction` to dispatch, or `null` if the intent is not
 * applicable (e.g. compose with a clean working tree, or a commit sha that
 * is not in the current view).
 *
 * Future phases of the TUI shell (palette, cross-view keymaps) enumerate
 * these intents to drive the UI.
 */

export function intentGoHome(state: LogInkState): LogInkAction | null {
  if (state.viewStack.length === 1 && state.activeView === HOME_VIEW) {
    return null
  }
  return { type: 'navigateHome' }
}

export function intentOpenDiffForCommit(
  state: LogInkState,
  sha: string
): LogInkAction | null {
  const filteredIndex = state.filteredCommits.findIndex((commit) => commit.hash === sha)

  if (filteredIndex < 0) {
    return null
  }

  return { type: 'navigateOpenDiffForCommit', sha, commitIndex: filteredIndex }
}

export function intentOpenDiffForWorktreeFile(
  path: string,
  worktreeFiles: string[]
): LogInkAction | null {
  const idx = worktreeFiles.indexOf(path)

  if (idx < 0) {
    return null
  }

  return { type: 'navigateOpenDiffForWorktreeFile', fileIndex: idx }
}

export function intentOpenDiffForStash(
  ref: string,
  stashIndex?: number
): LogInkAction | null {
  if (!ref) {
    return null
  }
  return { type: 'navigateOpenDiffForStash', ref, stashIndex }
}

export function intentOpenComposeForFile(
  path: string,
  worktreeFiles: string[]
): LogInkAction | null {
  if (worktreeFiles.length === 0) {
    return null
  }

  const idx = worktreeFiles.indexOf(path)

  if (idx < 0) {
    return null
  }

  return { type: 'navigateOpenComposeForFile', fileIndex: idx }
}
