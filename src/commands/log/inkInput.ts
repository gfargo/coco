import { extractDiffHunk } from '../../workstation/chrome/hunkExtraction'
import {
    InspectorAction,
    InspectorActionContext,
    getInspectorActions,
} from '../../workstation/chrome/inspectorActions'
import {
    LogInkPaletteCommand,
    filterLogInkPaletteCommands,
    getLogInkPaletteCommands,
} from './inkKeymap'
import {
    LogInkAction,
    LogInkCompareRef,
    LogInkSidebarTab,
    LogInkState,
    parseLogInkHistoryFetchPrefix,
} from './inkViewModel'
import {
    getLogInkWorkflowActionById,
    getLogInkWorkflowActionByKey,
} from './inkWorkflows'
import { sidebarTabHasSelectableItems } from '../../workstation/chrome/sidebarSelection'

export type LogInkInputKey = {
  backspace?: boolean
  ctrl?: boolean
  delete?: boolean
  downArrow?: boolean
  escape?: boolean
  leftArrow?: boolean
  meta?: boolean
  pageDown?: boolean
  pageUp?: boolean
  return?: boolean
  rightArrow?: boolean
  shift?: boolean
  tab?: boolean
  upArrow?: boolean
}

export type LogInkInputEvent =
  | { type: 'action'; action: LogInkAction }
  | { type: 'exit' }
  | { type: 'refreshContext' }
  | { type: 'toggleSelectedFileStage' }
  | { type: 'toggleSelectedHunkStage' }
  | { type: 'revertSelectedFile' }
  | { type: 'revertSelectedHunk' }
  | { type: 'createManualCommit' }
  | { type: 'runAiCommitDraft' }
  | { type: 'startCreatePullRequest' }
  | { type: 'startChangelogView' }
  | { type: 'regenerateChangelog' }
  | { type: 'yankChangelog' }
  | { type: 'openChangelogInEditor' }
  | { type: 'openComposeInEditor' }
  | { type: 'startCommitSplit' }
  | { type: 'applyCommitSplit' }
  | { type: 'cancelCommitSplit' }
  | { type: 'runWorkflowAction'; id: string; payload?: string }
  | { type: 'openFileInEditor'; path: string }
  | { type: 'yankFromActiveView'; short?: boolean }
  | { type: 'yankText'; value: string; label: string }

export type LogInkInputContext = {
  detailFileCount?: number
  worktreeHunkOffsets?: number[]
  previewLineCount?: number
  worktreeDiffLineCount?: number
  worktreeFileCount?: number
  /**
   * `@@` line offsets within `filePreview.hunks` for the selected commit's
   * file. Lets diff-view j/k/PageUp/PageDown navigate the commit's hunks when
   * no worktree file is in scope.
   */
  commitDiffHunkOffsets?: number[]
  branchCount?: number
  /**
   * Short name of the cursored branch (#779). Used by `m` to capture
   * the compare-base ref and by Enter (when compareBase is set) to
   * resolve the head ref from the branches view.
   */
  branchSelectedShortName?: string
  tagCount?: number
  /**
   * Name of the cursored tag (#779). Same role as
   * `branchSelectedShortName` but scoped to the tags view.
   */
  tagSelectedName?: string
  stashCount?: number
  reflogCount?: number
  /** Hash of the cursored reflog entry (#781). Used by Enter to drill into the diff. */
  reflogSelectedHash?: string
  /** Number of registered submodules (#932). Drives j/k navigation on the submodules view. */
  submoduleCount?: number
  /** Repo-relative path of the cursored submodule (#932). Reserved for future per-entry actions. */
  submoduleSelectedPath?: string
  /** Number of issues in the triage list view (#882 phase 3). Drives j/k navigation. */
  issueCount?: number
  /** URL of the cursored issue (#882 phase 3). Used by `O` to open in the browser. */
  issueSelectedUrl?: string
  /** Number of PRs in the triage list view (#882 phase 3). Drives j/k navigation. */
  pullRequestTriageCount?: number
  /** URL of the cursored PR in the triage list view (#882 phase 3). */
  pullRequestTriageSelectedUrl?: string
  worktreeListCount?: number
  /** Ref of the stash currently under the cursor (e.g. `stash@{0}`). */
  stashSelectedRef?: string
  /**
   * Per-file `diff --git` line offsets inside the active stash diff.
   * Used by `]` / `[` to jump to next / previous file within a stash
   * patch.
   */
  stashDiffFileOffsets?: number[]
  /**
   * Path of the file currently under the diff-view cursor in a stash
   * patch. Used by `c` (cherry-pick) to know which path to materialize.
   */
  stashDiffSelectedPath?: string
  /**
   * Path of the cursored file in the worktree (status / worktree diff
   * views). Used by `o` (open in $EDITOR).
   */
  worktreeSelectedPath?: string
  /**
   * Sectioned view of the visible (mask-filtered) worktree files for
   * the status surface, in canonical order (staged → unstaged →
   * untracked). Drives ←/→ group jumps and the ↑-at-top-of-group →
   * header-focus transition. Empty / undefined when status isn't the
   * active view.
   */
  statusGroups?: Array<{
    state: 'staged' | 'unstaged' | 'untracked'
    count: number
    startIndex: number
  }>
  /**
   * Number of actions in the active Inspector Actions list. Used to
   * clamp the cursor in the actions tab. Undefined / 0 when no
   * actions are available for the current state — the tab still
   * renders but the cursor model is a no-op.
   */
  inspectorActionCount?: number
  /**
   * Path of the cursored file in a commit-diff explore. Used by `c`
   * (cherry-pick file from commit).
   */
  commitDiffSelectedPath?: string
  /**
   * Hash of the commit being explored — pairs with commitDiffSelectedPath
   * so the cherry-pick handler knows which sha to checkout from.
   */
  commitDiffSelectedSha?: string
  /**
   * True when the worktree has any staged, unstaged, or untracked changes.
   * Drives the synthetic "(+) new commit" row at the top of the history
   * list — pressing up at `selectedIndex === 0` transitions onto it; the
   * row is hidden entirely when the worktree is clean.
   */
  worktreeDirty?: boolean
  /**
   * Lines of the active diff (stash or commit) when the user is on a
   * diff explore. Used by the H / gH hunk-apply handler to slice the
   * cursored hunk out of the patch text and ship it to `git apply`.
   * Stash uses the full `git stash show -p` output; commit-diff uses
   * the per-file `filePreview.hunks` array (hunks-only). The handler
   * doesn't care which — `extractDiffHunk` walks `@@` headers either
   * way.
   */
  diffLinesForHunkApply?: string[]
  /**
   * Number of conflicted files in the current operation. Drives j/k
   * navigation on the conflicts view.
   */
  conflictFileCount?: number
  /**
   * Path of the file currently under the cursor in the conflicts view.
   * Used by `o` (open in $EDITOR) and `s` (stage/resolve).
   */
  conflictSelectedPath?: string
  /**
   * Number of lines in `state.changelogView.text`. Used by the
   * changelog view's scroll bindings (`j/k`, `pgup/pgdn`) to clamp
   * `pageChangelog` deltas. Undefined when the view hasn't been loaded
   * or generation failed — the scroll handlers no-op in that case.
   */
  changelogLineCount?: number
  /**
   * Total rendered line count of the split-plan overlay content.
   * Used by the overlay's scroll bindings to clamp `pageSplitPlan`
   * deltas. The runtime computes this from `state.splitPlan.plan`
   * groups before dispatching to the input handler.
   */
  splitPlanLineCount?: number
  /**
   * Short sha of the bisect's "first bad commit" terminator, when
   * present (#879 item 3). Drives `y` on the bisect-complete panel —
   * the headline answer is the value the user wants to copy.
   */
  bisectCompletionSha?: string
  /**
   * True when a bisect session is in progress (#879 item 4). Used to
   * disambiguate the bisect view's `s` keystroke: with bisect active
   * it means "skip current candidate"; without it means "start a new
   * bisect via the in-TUI wizard".
   */
  bisectActive?: boolean
}

function action(actionValue: LogInkAction): LogInkInputEvent {
  return {
    type: 'action',
    action: actionValue,
  }
}

/**
 * Resolve which inspector action context applies for the current
 * state. Today only history commits expose actions in the inspector
 * (the renderer hard-coded `'history-commit'`); future PRs can fan
 * this out to branch / tag / stash / worktree contexts as the
 * inspector gains entity-aware sections. Returns `undefined` when no
 * actions section should be shown (so the cursor model stays a
 * no-op).
 */
export function resolveInspectorActionContext(
  state: LogInkState
): InspectorActionContext | undefined {
  if (state.activeView === 'history' && !state.pendingCommitFocused) {
    return 'history-commit'
  }
  return undefined
}

export function getInspectorActionsForState(state: LogInkState): InspectorAction[] {
  const ctx = resolveInspectorActionContext(state)
  return ctx ? getInspectorActions(ctx) : []
}

/**
 * Synthesize the events that fire when the user presses Enter on a
 * cursored inspector action (#791 follow-up). Mirrors
 * `getLogInkPaletteExecuteEvents` — each action's `key` field
 * routes to the same dispatch the corresponding keystroke would
 * trigger from the history view's commit cursor. Per-key dispatch
 * (rather than recursively re-running the keystroke through
 * `getLogInkInputEvents`) avoids the gating problem: most history
 * keystroke handlers require `state.focus === 'commits'`, but the
 * inspector executor fires from `state.focus === 'detail'`.
 */
export function getInspectorActionExecuteEvents(
  inspectorAction: InspectorAction,
  state: LogInkState
): LogInkInputEvent[] {
  const commit = state.filteredCommits[state.selectedIndex]
  const requireCommit = (
    fn: (sha: string, commitIndex: number) => LogInkInputEvent[]
  ): LogInkInputEvent[] => {
    if (!commit) {
      return [action({ type: 'setStatus', value: 'No commit selected' })]
    }
    return fn(commit.hash, state.selectedIndex)
  }

  switch (inspectorAction.key) {
    case 'enter':
      return requireCommit((sha, commitIndex) => [
        action({ type: 'navigateOpenDiffForCommit', sha, commitIndex }),
      ])
    case 'c':
      return requireCommit(() => [
        action({ type: 'setPendingConfirmation', value: 'cherry-pick-commit' }),
      ])
    case 'R':
      return requireCommit(() => [
        action({ type: 'setPendingConfirmation', value: 'revert-commit' }),
      ])
    case 'Z':
      return requireCommit(() => [
        action({
          type: 'openInputPrompt',
          kind: 'reset-mode',
          label: 'Reset mode (soft / mixed / hard)',
        }),
      ])
    case 'i':
      return requireCommit(() => [
        action({ type: 'setPendingConfirmation', value: 'interactive-rebase' }),
      ])
    case 'y':
      return requireCommit(() => [{ type: 'yankFromActiveView' }])
    case 'Y':
      return requireCommit(() => [{ type: 'yankFromActiveView', short: true }])
    case 'O':
      return [{ type: 'runWorkflowAction', id: 'open-pr' }]
    default:
      return [action({
        type: 'setStatus',
        value: `Action ${inspectorAction.key} not yet wired`,
      })]
  }
}

/**
 * Build the events needed to apply the hunk under the diff cursor. The
 * runtime workflow handler expects payload format `<target>\n<patch>`
 * — splitting on the first newline keeps the patch body intact for
 * targets like `worktree` and `index` (no newlines in the prefix).
 *
 * Returns [] when the user isn't on a commit-diff / stash-diff explore,
 * or when no hunk can be extracted at the current cursor offset
 * (e.g. cursor sits on a `diff --git` header before the first `@@`).
 * Callers fall back to a contextual status message when this returns [].
 */
function buildApplyHunkEvents(
  state: LogInkState,
  context: LogInkInputContext,
  target: 'worktree' | 'index'
): LogInkInputEvent[] {
  if (state.activeView !== 'diff') return []
  if (state.diffSource !== 'commit' && state.diffSource !== 'stash') return []
  const lines = context.diffLinesForHunkApply
  if (!lines || lines.length === 0) return []
  const path = state.diffSource === 'stash'
    ? context.stashDiffSelectedPath
    : context.commitDiffSelectedPath
  if (!path) return []
  const extracted = extractDiffHunk({
    lines,
    cursorOffset: state.diffPreviewOffset,
    path,
  })
  if (!extracted) return []
  const id = target === 'index' ? 'apply-hunk-index' : 'apply-hunk-worktree'
  return [{
    type: 'runWorkflowAction',
    id,
    payload: `${target}\n${extracted.patchText}`,
  }]
}

/**
 * Per-entity action-target predicates. The promoted views (`branches`,
 * `tags`, `stash`, `worktrees`) each scope a set of ops to their
 * dedicated surface. The same ops also fire when the user has the
 * sidebar focused on the matching tab — that's how in-sidebar
 * selection (#791 follow-up) lets the user checkout / apply / drop
 * without leaving the workstation view.
 */
function isBranchActionTarget(state: LogInkState): boolean {
  return (state.activeView === 'branches' && state.focus === 'commits') ||
    (state.focus === 'sidebar' && state.sidebarTab === 'branches')
}

function isTagActionTarget(state: LogInkState): boolean {
  return (state.activeView === 'tags' && state.focus === 'commits') ||
    (state.focus === 'sidebar' && state.sidebarTab === 'tags')
}

function isStashActionTarget(state: LogInkState): boolean {
  return (state.activeView === 'stash' && state.focus === 'commits') ||
    (state.focus === 'sidebar' && state.sidebarTab === 'stashes')
}

/**
 * Reflog has no sidebar tab — only the dedicated promoted view (#781).
 * The condition stays as a single helper anyway so navigation handlers
 * can read it the same way they do for the other promoted views.
 */
function isReflogActionTarget(state: LogInkState): boolean {
  return state.activeView === 'reflog' && state.focus === 'commits'
}

/**
 * Submodules has no sidebar tab either — only the dedicated promoted
 * view (#932). Same shape as `isReflogActionTarget`.
 */
function isSubmodulesActionTarget(state: LogInkState): boolean {
  return state.activeView === 'submodules' && state.focus === 'commits'
}

/**
 * Issue triage list (#882 phase 3). Same shape as the other promoted
 * read-only views — j/k move the cursor when the commits pane is
 * focused on the dedicated view.
 */
function isIssueActionTarget(state: LogInkState): boolean {
  return state.activeView === 'issues' && state.focus === 'commits'
}

/**
 * Pull-request triage list (#882 phase 3). Distinct from the existing
 * `pull-request` single-PR action panel — this is the multi-PR list
 * surface and its cursor lives in `selectedPullRequestTriageIndex`.
 */
function isPullRequestTriageActionTarget(state: LogInkState): boolean {
  return state.activeView === 'pull-request-triage' && state.focus === 'commits'
}

function isWorktreeActionTarget(state: LogInkState): boolean {
  return (state.activeView === 'worktrees' && state.focus === 'commits') ||
    (state.focus === 'sidebar' && state.sidebarTab === 'worktrees')
}

/**
 * Compare-flow target views (#779). The `m` mark + Enter-as-compare
 * overrides only fire on rows that represent a single ref the user
 * could pass to `git diff <ref>..<ref>` — branches, tags, and history
 * commits. The reflog view is intentionally excluded because reflog
 * entries are *moves* of HEAD, not refs a user typically diffs against.
 */
function isCompareFlowTarget(state: LogInkState): boolean {
  if (state.focus !== 'commits') return false
  return state.activeView === 'branches' ||
    state.activeView === 'tags' ||
    state.activeView === 'history'
}

/**
 * Resolve the cursored ref for the compare flow (#779). Pulls the
 * concrete ref + label off context for branches / tags, and reads the
 * commit row from state for history. Returns undefined when no usable
 * ref is under the cursor (e.g., the views are empty, or the focus is
 * on the synthetic "(+) new commit" row).
 */
function getCursoredCompareRef(
  state: LogInkState,
  context: LogInkInputContext
): LogInkCompareRef | undefined {
  if (state.activeView === 'branches' && context.branchSelectedShortName) {
    return {
      kind: 'branch',
      ref: context.branchSelectedShortName,
      label: context.branchSelectedShortName,
    }
  }
  if (state.activeView === 'tags' && context.tagSelectedName) {
    return {
      kind: 'tag',
      ref: context.tagSelectedName,
      label: context.tagSelectedName,
    }
  }
  if (state.activeView === 'history' && !state.pendingCommitFocused) {
    const commit = state.filteredCommits[state.selectedIndex]
    if (commit) {
      return {
        kind: 'commit',
        ref: commit.hash,
        label: `${commit.shortHash} ${commit.message}`.trim(),
      }
    }
  }
  return undefined
}

/**
 * Item count for the active sidebar tab — used by the generic
 * sidebar-Enter handler to decide whether to defer to the per-entity
 * Enter (when items are present and the user is cursoring through
 * them) or to drill into the dedicated view (when the tab is empty
 * or has no per-entity Enter handler defined).
 */
function getSidebarItemCount(
  sidebarTab: LogInkSidebarTab,
  context: LogInkInputContext
): number | undefined {
  switch (sidebarTab) {
    case 'branches': return context.branchCount
    case 'tags': return context.tagCount
    case 'stashes': return context.stashCount
    case 'worktrees': return context.worktreeListCount
    default: return undefined
  }
}

/**
 * Translate a palette command into the same events its keystroke would have
 * produced. Phase 6 makes `:` a real launcher: this is the single mapping
 * from palette IDs to dispatchable behavior.
 */
export function getLogInkPaletteExecuteEvents(
  command: LogInkPaletteCommand,
  state: LogInkState
): LogInkInputEvent[] {
  if (command.kind === 'workflow') {
    if (command.requiresConfirmation) {
      return [action({ type: 'setPendingConfirmation', value: command.id })]
    }
    // Non-confirm workflows are dispatched directly through the runtime
    // workflow runner — same path the keyboard takes. Previously this
    // emitted `setWorkflowAction` only, which set state but never fired
    // the action because nothing in the runtime consumes
    // `workflowActionId`.
    return [{ type: 'runWorkflowAction', id: command.id }]
  }

  // Binding-derived commands. Map each LogInkCommandId to the same events
  // the keystroke would emit. Order matches the keymap registry.
  switch (command.id) {
    case 'moveUp':
      return [action({ type: 'move', delta: -1 })]
    case 'moveDown':
      return [action({ type: 'move', delta: 1 })]
    case 'pageUp':
      return [action({ type: 'page', delta: -10 })]
    case 'pageDown':
      return [action({ type: 'page', delta: 10 })]
    case 'moveToTop':
      return [
        action({ type: 'moveToTop' }),
        action({ type: 'setStatus', value: 'jumped to first commit' }),
      ]
    case 'moveToBottom':
      return [
        action({ type: 'moveToBottom' }),
        action({ type: 'setStatus', value: 'jumped to last commit' }),
      ]
    case 'nextMatch':
      return [action({ type: 'move', delta: 1 })]
    case 'previousMatch':
      return [action({ type: 'move', delta: -1 })]
    case 'previousSidebarTab':
      return [action({ type: 'previousSidebarTab' })]
    case 'nextSidebarTab':
      return [action({ type: 'nextSidebarTab' })]
    case 'previousHunk':
    case 'nextHunk':
      // Palette execution can't reach the live worktree/commit hunk offsets
      // (those live in runtime state, not the reducer). Surface a hint and
      // let the user press the keystroke directly in diff view.
      return [action({
        type: 'setStatus',
        value: 'open the diff view and press [ or ] to jump hunks',
      })]
    case 'focusNext':
      return [action({ type: 'focusNext' })]
    case 'focusPrevious':
      return [action({ type: 'focusPrevious' })]
    case 'search':
      return [action({ type: 'toggleFilterMode' })]
    case 'toggleGraph':
      return [action({ type: 'toggleGraph' })]
    case 'navigateHome':
      return [action({ type: 'navigateHome' })]
    case 'navigateStatus':
      return [action({ type: 'pushView', value: 'status' })]
    case 'navigateDiff':
      return [action({ type: 'pushView', value: 'diff' })]
    case 'navigateCompose':
      return [action({ type: 'pushView', value: 'compose' })]
    case 'navigateBranches':
      return [action({ type: 'pushView', value: 'branches' })]
    case 'navigateTags':
      return [action({ type: 'pushView', value: 'tags' })]
    case 'navigateStash':
      return [action({ type: 'pushView', value: 'stash' })]
    case 'navigateWorktrees':
      return [action({ type: 'pushView', value: 'worktrees' })]
    case 'navigatePullRequest':
      return [action({ type: 'pushView', value: 'pull-request' })]
    case 'navigatePullRequestTriage':
      return [action({ type: 'pushView', value: 'pull-request-triage' })]
    case 'navigateIssues':
      return [action({ type: 'pushView', value: 'issues' })]
    case 'navigateConflicts':
      return [action({ type: 'pushView', value: 'conflicts' })]
    case 'navigateReflog':
      return [action({ type: 'pushView', value: 'reflog' })]
    case 'navigateBisect':
      return [action({ type: 'pushView', value: 'bisect' })]
    case 'navigateSubmodules':
      return [action({ type: 'pushView', value: 'submodules' })]
    case 'markForCompare':
      // Palette context can't reach the cursored ref (filtered branch /
      // tag lists live in runtime state, not the reducer). Surface a
      // hint and let the user press `m` directly on the row. The
      // inline keypress handler further down in this file does the
      // actual work and has access to the necessary context.
      return [action({
        type: 'setStatus',
        value: 'open branches / tags / history and press m on the cursored ref',
      })]
    case 'navigateBack':
      return [action({ type: 'popView' })]
    case 'openSelected': {
      // From history → diff for selected commit; from status → diff for
      // selected file. Mirrors the enter-key behavior.
      if (state.activeView === 'history' && state.filteredCommits.length > 0) {
        const selected = state.filteredCommits[state.selectedIndex]
        if (selected) {
          return [action({
            type: 'navigateOpenDiffForCommit',
            sha: selected.hash,
            commitIndex: state.selectedIndex,
          })]
        }
      }
      if (state.activeView === 'status') {
        return [action({
          type: 'navigateOpenDiffForWorktreeFile',
          fileIndex: state.selectedWorktreeFileIndex,
        })]
      }
      return []
    }
    case 'refresh':
      return [{ type: 'refreshContext' }]
    case 'revertSelection':
      return [action({ type: 'setPendingMutationConfirmation', value: 'revert-file' })]
    case 'editCommit':
      return [
        ...(state.activeView !== 'compose'
          ? [action({ type: 'pushView', value: 'compose' })]
          : []),
        action({ type: 'commitCompose', action: { type: 'setEditing', value: true } }),
      ]
    case 'commit':
      return [
        ...(state.activeView !== 'compose'
          ? [action({ type: 'pushView', value: 'compose' })]
          : []),
        { type: 'createManualCommit' },
      ]
    case 'help':
      return [action({ type: 'toggleHelp' })]
    case 'commandPalette':
      // Re-toggling closes; the dispatcher will close after execute anyway.
      return []
    case 'workflowActions':
      // Aggregate entry; individual workflows are surfaced separately.
      return []
    case 'quit':
      if (hasUnsavedComposeDraft(state)) {
        return [action({ type: 'setPendingMutationConfirmation', value: 'discard-draft' })]
      }
      return [{ type: 'exit' }]
    case 'clearSearch':
      return [action({ type: 'clearFilter' })]
    case 'cycleSort':
      if (isBranchActionTarget(state)) {
        return [action({ type: 'cycleBranchSort' })]
      }
      if (isTagActionTarget(state)) {
        return [action({ type: 'cycleTagSort' })]
      }
      return [action({
        type: 'setStatus',
        value: 'Sort cycle is available in the branches and tags views',
      })]
    case 'yankClipboard':
      // The runtime resolves the value/label against the live filtered
      // list — palette execute simply fires the same event the keystroke
      // would. Empty active views (no commits / no branches / etc.) are
      // surfaced by the runtime as a "Nothing to yank" status.
      return [{ type: 'yankFromActiveView' }]
    default:
      return []
  }
}

const SIDEBAR_TAB_BY_NUMBER: Record<string, LogInkSidebarTab> = {
  '1': 'status',
  '2': 'branches',
  '3': 'tags',
  '4': 'stashes',
  '5': 'worktrees',
}

/**
 * Returns true when the compose surface holds an unsaved commit message
 * (any text in summary or body and no in-flight AI draft). Used by the
 * quit confirmation flow (P2.3) so users can't lose drafts via a stray
 * `q` / Ctrl+C.
 */
function hasUnsavedComposeDraft(state: LogInkState): boolean {
  const compose = state.commitCompose
  if (compose.loading) {
    return false
  }
  return Boolean(compose.summary.trim() || compose.body.trim())
}

/**
 * Submit the active input prompt — used by Enter on single-line
 * prompts and by Ctrl+D on multi-line prompts (#806). Most prompt
 * kinds dispatch a workflow whose id matches the kind
 * (`create-branch`, `rename-branch`, etc.). A few are exceptions:
 *   - `reset-mode` (#777) collects soft/mixed/hard and forwards the
 *     mode as the payload to `reset-to-commit`.
 *   - `pr-merge-strategy` (#783) validates the strategy and routes to
 *     `merge-pr` via the y-confirm path.
 *   - `pr-comment` dispatches `comment-pr` directly — the body itself
 *     is the affirmative action.
 *   - `pr-request-changes` routes to `request-changes-pr` via
 *     y-confirm because the review is publicly visible.
 * Each exception validates here so a typo doesn't surface as a
 * "workflow not yet wired" status downstream.
 *
 * Empty values yield a hint instead of a no-op so the user knows what
 * to do — the same UX whether they pressed Enter (single-line) or
 * Ctrl+D (multi-line).
 */
function submitInputPrompt(state: LogInkState): LogInkInputEvent[] {
  if (!state.inputPrompt) return []
  const value = state.inputPrompt.value.trim()
  if (!value) {
    return [action({ type: 'setStatus', value: 'enter a value or press esc to cancel' })]
  }
  if (state.inputPrompt.kind === 'reset-mode') {
    const mode = value.toLowerCase()
    if (mode !== 'soft' && mode !== 'mixed' && mode !== 'hard') {
      return [action({
        type: 'setStatus',
        value: `Unknown reset mode: ${value}. Use soft, mixed, or hard.`,
      })]
    }
    return [
      { type: 'runWorkflowAction', id: 'reset-to-commit', payload: mode },
      action({ type: 'closeInputPrompt' }),
    ]
  }
  if (state.inputPrompt.kind === 'pr-merge-strategy') {
    const strategy = value.toLowerCase()
    if (strategy !== 'merge' && strategy !== 'squash' && strategy !== 'rebase') {
      return [action({
        type: 'setStatus',
        value: `Unknown merge strategy: ${value}. Use merge, squash, or rebase.`,
      })]
    }
    return [
      action({ type: 'setPendingConfirmation', value: 'merge-pr', payload: strategy }),
      action({ type: 'closeInputPrompt' }),
    ]
  }
  if (state.inputPrompt.kind === 'pr-comment') {
    return [
      { type: 'runWorkflowAction', id: 'comment-pr', payload: value },
      action({ type: 'closeInputPrompt' }),
    ]
  }
  // #882 phase 4 — triage-view mutation prompts. Each kind routes to
  // its by-number workflow id; the runner reads the cursored item
  // from state + filtered list and runs the matching `gh` action.
  if (state.inputPrompt.kind === 'triage-issue-comment') {
    return [
      { type: 'runWorkflowAction', id: 'triage-issue-comment', payload: value },
      action({ type: 'closeInputPrompt' }),
    ]
  }
  if (state.inputPrompt.kind === 'triage-issue-label') {
    return [
      { type: 'runWorkflowAction', id: 'triage-issue-label', payload: value },
      action({ type: 'closeInputPrompt' }),
    ]
  }
  if (state.inputPrompt.kind === 'triage-issue-assign') {
    return [
      { type: 'runWorkflowAction', id: 'triage-issue-assign', payload: value },
      action({ type: 'closeInputPrompt' }),
    ]
  }
  if (state.inputPrompt.kind === 'triage-pr-comment') {
    return [
      { type: 'runWorkflowAction', id: 'triage-pr-comment', payload: value },
      action({ type: 'closeInputPrompt' }),
    ]
  }
  if (state.inputPrompt.kind === 'triage-pr-label') {
    return [
      { type: 'runWorkflowAction', id: 'triage-pr-label', payload: value },
      action({ type: 'closeInputPrompt' }),
    ]
  }
  if (state.inputPrompt.kind === 'triage-pr-assign') {
    return [
      { type: 'runWorkflowAction', id: 'triage-pr-assign', payload: value },
      action({ type: 'closeInputPrompt' }),
    ]
  }
  // #882 phase 5 — destructive prompt submissions route through the
  // y-confirm path (not directly to runWorkflowAction) so the user
  // gets a final "are you sure?" before anything ships. The
  // collected value (strategy / body) rides along as the
  // confirmation payload.
  if (state.inputPrompt.kind === 'triage-pr-merge-strategy') {
    const strategy = value.toLowerCase()
    if (strategy !== 'merge' && strategy !== 'squash' && strategy !== 'rebase') {
      return [action({
        type: 'setStatus',
        value: `Unknown merge strategy: ${value}. Use merge, squash, or rebase.`,
      })]
    }
    return [
      action({ type: 'setPendingConfirmation', value: 'triage-pr-merge', payload: strategy }),
      action({ type: 'closeInputPrompt' }),
    ]
  }
  if (state.inputPrompt.kind === 'triage-pr-request-changes') {
    return [
      action({ type: 'setPendingConfirmation', value: 'triage-pr-request-changes', payload: value }),
      action({ type: 'closeInputPrompt' }),
    ]
  }
  if (state.inputPrompt.kind === 'pr-request-changes') {
    return [
      action({ type: 'setPendingConfirmation', value: 'request-changes-pr', payload: value }),
      action({ type: 'closeInputPrompt' }),
    ]
  }
  if (state.inputPrompt.kind === 'bisect-run-command') {
    // #879 item 5 — the typed command is the workflow payload. The
    // runtime hands it to `git bisect run sh -c '<command>'` so shell
    // features (pipes, env vars, flag-laden invocations) work as the
    // user expects.
    return [
      { type: 'runWorkflowAction', id: 'bisect-run', payload: value },
      action({ type: 'closeInputPrompt' }),
    ]
  }
  if (state.inputPrompt.kind === 'create-pr') {
    // Multi-line content: line 1 is the PR title, lines 2+ are the body
    // (leading blank line tolerated). The generic empty-value guard
    // above (line ~627) covers truly-empty submissions; the workflow
    // handler in app.ts has the belt-and-suspenders title check for
    // the "newline-then-body" edge.
    return [
      { type: 'runWorkflowAction', id: 'create-pr', payload: value },
      action({ type: 'closeInputPrompt' }),
    ]
  }
  const id = state.inputPrompt.kind
  return [
    { type: 'runWorkflowAction', id, payload: value },
    action({ type: 'closeInputPrompt' }),
  ]
}

export function getLogInkInputEvents(
  state: LogInkState,
  inputValue: string,
  key: LogInkInputKey = {},
  context: LogInkInputContext = {}
): LogInkInputEvent[] {
  if (key.ctrl && inputValue === 'c') {
    if (hasUnsavedComposeDraft(state) && !state.pendingMutationConfirmation) {
      return [action({ type: 'setPendingMutationConfirmation', value: 'discard-draft' })]
    }
    return [{ type: 'exit' }]
  }

  // Input prompt is the most modal — when active, every keystroke routes
  // into the prompt until Enter (submit) or Esc (cancel). Sits above the
  // filter/confirmation/compose handlers so a prompt opened from inside
  // any of those still captures focus cleanly.
  if (state.inputPrompt) {
    const isMultiline = Boolean(state.inputPrompt.multiline)

    if (key.escape) {
      return [
        action({ type: 'closeInputPrompt' }),
        action({ type: 'setStatus', value: 'cancelled' }),
      ]
    }
    // Multi-line prompts (#806): Ctrl+D submits (Unix EOF convention,
    // mirrors `git commit -m -` and HEREDOC patterns). Plain Enter
    // inserts a newline so the user can compose review bodies / PR
    // comments naturally without opening $EDITOR.
    if (isMultiline && key.ctrl && inputValue === 'd') {
      return submitInputPrompt(state)
    }
    if (isMultiline && key.return) {
      return [action({ type: 'appendInputPrompt', value: '\n' })]
    }
    if (key.return) {
      return submitInputPrompt(state)
    }
    if (key.backspace || key.delete) {
      return [action({ type: 'backspaceInputPrompt' })]
    }
    if (key.ctrl && inputValue === 'u') {
      return [action({ type: 'clearInputPromptText' })]
    }
    if (inputValue && !key.ctrl && !key.meta) {
      return [action({ type: 'appendInputPrompt', value: inputValue })]
    }
    return []
  }

  if (state.commitCompose.editing) {
    if (key.escape) {
      return [action({ type: 'commitCompose', action: { type: 'setEditing', value: false } })]
    }

    if (key.tab) {
      return [action({ type: 'commitCompose', action: { type: 'toggleField' } })]
    }

    if (key.return) {
      return [
        action({
          type: 'commitCompose',
          action: state.commitCompose.field === 'summary'
            ? { type: 'setField', value: 'body' }
            : { type: 'setEditing', value: false },
        }),
      ]
    }

    if (key.backspace || key.delete) {
      return [action({ type: 'commitCompose', action: { type: 'backspace' } })]
    }

    if (key.ctrl && inputValue === 'u') {
      return [action({ type: 'commitCompose', action: { type: 'clearField' } })]
    }

    if (inputValue && !key.ctrl && !key.meta) {
      return [action({ type: 'commitCompose', action: { type: 'append', value: inputValue } })]
    }

    return []
  }

  if (state.filterMode) {
    if (key.return) {
      // History server-side filter prefixes (#776): on Enter, if the
      // active view is history and the filter matches `path:<value>`
      // or `author:<value>`, hand the parsed args to the runtime
      // (which re-runs `getLogRows`) and clear the textual filter.
      // For any other view or any non-prefix filter, Enter just exits
      // filter mode like before.
      if (state.activeView === 'history') {
        const fetchArgs = parseLogInkHistoryFetchPrefix(state.filter)
        if (fetchArgs) {
          return [
            action({ type: 'setHistoryFetchArgs', value: fetchArgs }),
            action({ type: 'clearFilter' }),
          ]
        }
      }
      return [action({ type: 'toggleFilterMode' })]
    }

    // Two-stage Esc (P2.4 / P4.4): first Esc with a non-empty filter
    // clears the input but keeps filterMode active so the user can keep
    // typing; second Esc exits filterMode entirely. Matches vim and
    // most modal TUIs.
    if (key.escape) {
      if (state.filter.length > 0) {
        return [action({ type: 'clearFilterText' })]
      }
      return [action({ type: 'toggleFilterMode' })]
    }

    if (key.backspace || key.delete) {
      return [action({ type: 'backspaceFilter' })]
    }

    if (key.ctrl && inputValue === 'u') {
      // Ctrl+U is the canonical "blow away the filter" key. When the
      // history view also has server-side fetch args active (#776),
      // drop those too — otherwise the user has no obvious way to
      // unwind a `path:` / `author:` fetch and the visible filter
      // appears stuck.
      return state.historyFetchArgs
        ? [
          action({ type: 'clearFilter' }),
          action({ type: 'setHistoryFetchArgs', value: undefined }),
        ]
        : [action({ type: 'clearFilter' })]
    }

    if (inputValue && !key.ctrl && !key.meta) {
      return [action({ type: 'appendFilter', value: inputValue })]
    }

    return []
  }

  if (state.pendingConfirmationId) {
    if (inputValue === 'y') {
      const workflowAction = getLogInkWorkflowActionById(state.pendingConfirmationId)

      if (workflowAction?.id === 'ai-commit-summary') {
        return [
          { type: 'runAiCommitDraft' },
          action({ type: 'setPendingConfirmation', value: undefined }),
        ]
      }

      // Destructive + provider workflow actions (delete-branch, delete-tag,
      // drop-stash, remove-worktree, abort-operation, create-pr, …) defer
      // to the runtime — it has the live context needed to identify the
      // selected item and run the right action function.
      if (workflowAction) {
        return [
          { type: 'runWorkflowAction', id: workflowAction.id, payload: state.pendingConfirmationPayload },
          action({ type: 'setPendingConfirmation', value: undefined }),
        ]
      }

      return [
        action({ type: 'setPendingConfirmation', value: undefined }),
        action({ type: 'setStatus', value: 'workflow action queued' }),
      ]
    }

    if (inputValue === 'n' || key.escape) {
      return [
        action({ type: 'setPendingConfirmation', value: undefined }),
        action({ type: 'setStatus', value: 'workflow action cancelled' }),
      ]
    }

    return []
  }

  if (state.pendingMutationConfirmation) {
    if (inputValue === 'y') {
      if (state.pendingMutationConfirmation === 'discard-draft') {
        return [
          action({ type: 'setPendingMutationConfirmation', value: undefined }),
          { type: 'exit' },
        ]
      }
      return [
        state.pendingMutationConfirmation === 'revert-hunk'
          ? { type: 'revertSelectedHunk' }
          : { type: 'revertSelectedFile' },
        action({ type: 'setPendingMutationConfirmation', value: undefined }),
      ]
    }

    if (inputValue === 'n' || key.escape) {
      const cancelMessage = state.pendingMutationConfirmation === 'discard-draft'
        ? 'kept draft — press q again to quit without saving'
        : 'revert cancelled'
      return [
        action({ type: 'setPendingMutationConfirmation', value: undefined }),
        action({ type: 'setStatus', value: cancelMessage }),
      ]
    }

    return []
  }

  // Split-plan overlay intercept (#907). When the overlay is open we
  // claim every keystroke — no fall-through to the underlying compose
  // surface, no accidental `c` commits, no chord prefixes. The overlay
  // owns the screen until the user accepts (`y`/Enter), cancels (Esc),
  // or scrolls (`j/k`/PgUp/PgDn). Status / loading / applying phases
  // intercept keystrokes equally; the only state-dependent variation
  // is that `y`/Enter is a no-op while loading or applying (nothing
  // to accept yet, or accept already in flight).
  if (state.splitPlan) {
    const lineCount = context.splitPlanLineCount || 0

    if (key.escape) {
      // Esc during loading is a soft cancel — we can't actually abort
      // the in-flight LLM call (runs in a sibling promise), but we
      // close the overlay and the runtime ignores the resolved plan
      // when it eventually lands (it checks `state.splitPlan?.status`
      // before dispatching setSplitPlanReady).
      return [{ type: 'cancelCommitSplit' }]
    }

    // Apply only fires from the 'ready' state. While loading we have
    // no plan; while applying we'd race the in-flight apply call. The
    // intercept consumes the keystroke either way so users don't
    // fall back into the compose surface.
    if ((inputValue === 'y' || key.return) && state.splitPlan.status === 'ready') {
      return [{ type: 'applyCommitSplit' }]
    }

    // `r` retries from the error state (or regenerates from ready,
    // for parity with the changelog surface). Re-runs the LLM call.
    // While loading or applying, retry is a no-op — we don't want to
    // stack workflows.
    if (inputValue === 'r' && state.splitPlan.status === 'ready') {
      return [{ type: 'startCommitSplit' }]
    }

    if (state.splitPlan.status === 'ready' && lineCount > 0) {
      // Line-step scroll: j/k OR ↑/↓ arrows. Both feel natural —
      // vim users reach for j/k, everyone else for arrows.
      if (inputValue === 'j' || key.downArrow) {
        return [action({ type: 'pageSplitPlan', delta: 1, lineCount })]
      }
      if (inputValue === 'k' || key.upArrow) {
        return [action({ type: 'pageSplitPlan', delta: -1, lineCount })]
      }
      // Page-step scroll: PgDn/PgUp, plus space/b as vim-style aliases.
      // Some terminals don't deliver PgDn/PgUp cleanly through Ink
      // (the original report from #919 was that PgUp/PgDn didn't seem
      // to work) — space/b gives a reliable fallback that works on
      // every terminal.
      if (key.pageDown || inputValue === ' ') {
        return [action({ type: 'pageSplitPlan', delta: 10, lineCount })]
      }
      if (key.pageUp || inputValue === 'b') {
        return [action({ type: 'pageSplitPlan', delta: -10, lineCount })]
      }
      // gg / G for top / bottom — matches the rest of the workstation
      // (history view, diff view, etc. all use gg/G for first/last).
      if (inputValue === 'G') {
        return [action({ type: 'pageSplitPlan', delta: lineCount, lineCount })]
      }
      if (inputValue === 'g') {
        // gg chord: first `g` sets pendingKey, second `g` jumps to top.
        if (state.pendingKey === 'g') {
          return [action({ type: 'pageSplitPlan', delta: -lineCount, lineCount })]
        }
        return [action({ type: 'setPendingKey', value: 'g' })]
      }
    }

    // Catch-all: consume the keystroke so it doesn't reach the
    // underlying compose surface. Returning an empty array keeps the
    // overlay open without dispatching any state change.
    return []
  }

  if (state.showCommandPalette) {
    const filtered = filterLogInkPaletteCommands(
      getLogInkPaletteCommands(),
      state.paletteFilter,
      state.paletteRecent
    )

    if (key.escape) {
      // Two-stage Esc inside the palette: first Esc with non-empty
      // input clears the filter; second Esc closes the palette. P2.4.
      if (state.paletteFilter.length > 0) {
        return [action({ type: 'clearPaletteFilter' })]
      }
      return [action({ type: 'toggleCommandPalette' })]
    }

    if (key.return) {
      const index = Math.max(0, Math.min(state.paletteSelectedIndex, filtered.length - 1))
      const selected = filtered[index]
      if (!selected) {
        return [action({ type: 'toggleCommandPalette' })]
      }
      return [
        action({ type: 'recordPaletteRecent', value: selected.id }),
        action({ type: 'toggleCommandPalette' }),
        ...getLogInkPaletteExecuteEvents(selected, state),
      ]
    }

    if (key.upArrow || (key.ctrl && inputValue === 'p')) {
      return [action({
        type: 'movePaletteSelection',
        delta: -1,
        commandCount: filtered.length,
      })]
    }

    if (key.downArrow || (key.ctrl && inputValue === 'n')) {
      return [action({
        type: 'movePaletteSelection',
        delta: 1,
        commandCount: filtered.length,
      })]
    }

    if (key.backspace || key.delete) {
      return [action({ type: 'backspacePaletteFilter' })]
    }

    if (key.ctrl && inputValue === 'u') {
      return [action({ type: 'clearPaletteFilter' })]
    }

    if (inputValue && !key.ctrl && !key.meta) {
      return [action({ type: 'appendPaletteFilter', value: inputValue })]
    }

    return []
  }

  if (key.escape && state.showHelp) {
    return [action({ type: 'toggleHelp' })]
  }

  // #879 item 4 — Esc cancels an in-flight bisect-start wizard. Runs
  // BEFORE the generic `popView` so we both clear the wizard state
  // and walk back to the bisect view in one keystroke. Without this
  // ordering Esc would pop history back to bisect but the wizard
  // mode would stick around, and the next Enter on history would
  // still try to capture a sha.
  if (key.escape && state.bisectPickMode) {
    const events: LogInkInputEvent[] = [
      action({ type: 'clearBisectPickMode' }),
      action({ type: 'setStatus', value: 'Bisect start cancelled' }),
    ]
    if (state.viewStack.length > 1) {
      events.push(action({ type: 'popView' }))
    }
    return events
  }

  if (key.escape && state.viewStack.length > 1) {
    return [action({ type: 'popView' })]
  }

  if (inputValue === 'q') {
    if (hasUnsavedComposeDraft(state)) {
      return [action({ type: 'setPendingMutationConfirmation', value: 'discard-draft' })]
    }
    return [{ type: 'exit' }]
  }

  if (inputValue === '?') {
    return [action({ type: 'toggleHelp' })]
  }

  if (inputValue === '/') {
    return [action({ type: 'toggleFilterMode' })]
  }

  if (state.pendingKey === 'g' && inputValue === 'h') {
    return [
      action({ type: 'navigateHome' }),
      action({ type: 'setStatus', value: 'jumped to history' }),
    ]
  }

  if (state.pendingKey === 'g' && inputValue === 's') {
    return [
      action({ type: 'pushView', value: 'status' }),
      action({ type: 'setStatus', value: 'jumped to status' }),
    ]
  }

  if (state.pendingKey === 'g' && inputValue === 'd') {
    return [
      action({ type: 'pushView', value: 'diff' }),
      action({ type: 'setStatus', value: 'jumped to diff' }),
    ]
  }

  if (state.pendingKey === 'g' && inputValue === 'c') {
    return [
      action({ type: 'pushView', value: 'compose' }),
      action({ type: 'setStatus', value: 'jumped to compose' }),
    ]
  }

  if (state.pendingKey === 'g' && inputValue === 'b') {
    return [
      action({ type: 'pushView', value: 'branches' }),
      action({ type: 'setStatus', value: 'jumped to branches' }),
    ]
  }

  if (state.pendingKey === 'g' && inputValue === 't') {
    return [
      action({ type: 'pushView', value: 'tags' }),
      action({ type: 'setStatus', value: 'jumped to tags' }),
    ]
  }

  if (state.pendingKey === 'g' && inputValue === 'z') {
    return [
      action({ type: 'pushView', value: 'stash' }),
      action({ type: 'setStatus', value: 'jumped to stash' }),
    ]
  }

  if (state.pendingKey === 'g' && inputValue === 'w') {
    return [
      action({ type: 'pushView', value: 'worktrees' }),
      action({ type: 'setStatus', value: 'jumped to worktrees' }),
    ]
  }

  // `gp` jumps to the dedicated pull-request action panel (#783).
  // Lowercase `p` matches the pattern of other navigation chords
  // (gh / gs / gd / gc / gb / gt / gz / gw). The panel renders the
  // current branch's PR via `gh pr view --json` enriched fields and
  // exposes m / x / a / R / c action keys scoped to the view.
  if (state.pendingKey === 'g' && inputValue === 'p') {
    return [
      action({ type: 'pushView', value: 'pull-request' }),
      action({ type: 'setStatus', value: 'jumped to pull request' }),
    ]
  }

  // `gP` chord (#882 phase 3): jump to the multi-PR triage list.
  // Capital P disambiguates from `gp` (current-branch PR panel).
  // Pleasingly symmetric with `gi` for issues — both lead to the
  // read-only list views shipped in #882.
  if (state.pendingKey === 'g' && inputValue === 'P') {
    return [
      action({ type: 'pushView', value: 'pull-request-triage' }),
      action({ type: 'setStatus', value: 'jumped to PR triage' }),
    ]
  }

  // `gi` chord (#882 phase 3): jump to the issue triage list.
  if (state.pendingKey === 'g' && inputValue === 'i') {
    return [
      action({ type: 'pushView', value: 'issues' }),
      action({ type: 'setStatus', value: 'jumped to issues' }),
    ]
  }

  if (state.pendingKey === 'g' && inputValue === 'x') {
    return [
      action({ type: 'pushView', value: 'conflicts' }),
      action({ type: 'setStatus', value: 'jumped to conflicts' }),
    ]
  }

  // `gr` chord: jump to the reflog browser (#781). Recovery view —
  // chronological list of reflog entries with Enter to drill into the
  // commit-diff for the entry's hash. Loaded lazily by the runtime.
  if (state.pendingKey === 'g' && inputValue === 'r') {
    return [
      action({ type: 'pushView', value: 'reflog' }),
      action({ type: 'setStatus', value: 'jumped to reflog' }),
    ]
  }

  // `gB` chord: jump to the bisect workflow view (#784). Capital B
  // disambiguates from `gb` (branches). Always navigates — even when
  // bisect is inactive — so the user can see the empty-state hint and
  // know how to start one. The view's surface tells them the next step.
  if (state.pendingKey === 'g' && inputValue === 'B') {
    return [
      action({ type: 'pushView', value: 'bisect' }),
      action({ type: 'setStatus', value: 'jumped to bisect' }),
    ]
  }

  // `gM` chord: jump to the dedicated submodules view (#932). Capital
  // M disambiguates from `gm` (not currently a chord, but the
  // single-letter `m` already means "mark compare base"). Always
  // navigates — even when no submodules are registered — so the
  // empty-state copy can tell the user how to add one.
  if (state.pendingKey === 'g' && inputValue === 'M') {
    return [
      action({ type: 'pushView', value: 'submodules' }),
      action({ type: 'setStatus', value: 'jumped to submodules' }),
    ]
  }

  // `gH` chord: apply the cursored hunk to the index (`git apply
  // --cached`). Sibling of bare `H` which targets the worktree.
  // Discoverable via the footer hint on diff views and the help
  // overlay; the explicit chord keeps `H` (single keystroke) for
  // the more common worktree case.
  if (state.pendingKey === 'g' && inputValue === 'H') {
    const events = buildApplyHunkEvents(state, context, 'index')
    if (events.length) {
      return [action({ type: 'setPendingKey', value: undefined }), ...events]
    }
    return [
      action({ type: 'setPendingKey', value: undefined }),
      action({ type: 'setStatus', value: 'gH applies a hunk in commit-diff or stash-diff view' }),
    ]
  }

  // `gT` chord: create a lightweight tag at the cursored commit on the
  // history view. Bare `T` is taken (delete-tag on the tags view) so we
  // use the chord. Mirrors `gH` exactly — uppercase letter after the
  // `g` chord prefix, distinct from the lowercase `gt` chord which
  // jumps to the tags view. The prompt is the affirmative gate.
  if (state.pendingKey === 'g' && inputValue === 'T') {
    if (
      state.activeView === 'history' &&
      state.focus === 'commits' &&
      state.filteredCommits.length > 0 &&
      !state.pendingCommitFocused
    ) {
      return [
        action({ type: 'setPendingKey', value: undefined }),
        action({
          type: 'openInputPrompt',
          kind: 'create-tag-here',
          label: 'New tag name (at cursored commit)',
        }),
      ]
    }
    return [
      action({ type: 'setPendingKey', value: undefined }),
      action({ type: 'setStatus', value: 'gT creates a tag at the cursored commit on the history view' }),
    ]
  }

  // #784 — bisect view action keys. Scoped to `state.activeView ===
  // 'bisect' && state.focus === 'commits'` so the single-letter keys
  // stay free everywhere else. `g` and `b` collide with the global
  // chord prefix and the `gb` continuation respectively — placed
  // BEFORE the bare-`g` chord trigger below so a `g` keystroke on
  // the bisect view marks good rather than entering chord mode. The
  // user's path back out of bisect is `<` / `esc`, never a chord;
  // the in-bisect view itself can't navigate elsewhere via `g`-prefix
  // chords until the user exits with `esc` first.
  if (state.activeView === 'bisect' && state.focus === 'commits') {
    if (inputValue === 'g' && state.pendingKey !== 'g') {
      return [{ type: 'runWorkflowAction', id: 'bisect-good' }]
    }
    if (inputValue === 'b' && state.pendingKey !== 'g') {
      return [{ type: 'runWorkflowAction', id: 'bisect-bad' }]
    }
    if (inputValue === 's') {
      // #879 item 4 — `s` is context-overloaded. When a bisect is
      // active, the original #784 behavior applies: skip the current
      // candidate. When no bisect is active, the empty-state view is
      // showing and `s` enters the in-TUI start wizard: push history,
      // mark the user as picking the BAD commit, surface a sticky
      // banner explaining the next step.
      if (context.bisectActive) {
        return [{ type: 'runWorkflowAction', id: 'bisect-skip' }]
      }
      return [
        action({ type: 'setBisectPickMode', mode: 'bad' }),
        action({ type: 'pushView', value: 'history' }),
        action({
          type: 'setStatus',
          value: 'Pick the BAD commit (where the bug is present). Enter to confirm · esc to cancel',
        }),
      ]
    }
    if (inputValue === 'x') {
      return [action({ type: 'setPendingConfirmation', value: 'bisect-reset' })]
    }
    // #879 item 5 — `R` (capital) on an active bisect view opens an
    // input prompt for a test command. Only fires when a session is
    // active because `git bisect run` is meaningless otherwise. Lower-
    // case `r` stays free for future view-local bindings.
    if (inputValue === 'R' && context.bisectActive) {
      return [action({
        type: 'openInputPrompt',
        kind: 'bisect-run-command',
        label: 'Bisect run command (e.g. npm test, pytest -k regression)',
      })]
    }
  }

  // Changelog view local keymap. Scoped to `activeView === 'changelog'`
  // so the letters stay free everywhere else. Bindings:
  //
  //   j / k          → scroll line down / up (1 line)
  //   pgdn / pgup    → scroll page down / up (10 lines)
  //   y              → yank text to clipboard
  //   E              → open in $EDITOR (companion to compose's `E` from #913)
  //   c              → create-PR seeded with this changelog
  //   r              → regenerate (skip cache, re-run LLM)
  //
  // Back-out is `<` / Esc handled by the global pop-view path lower
  // down. The view only renders when `state.changelogView.status`
  // is 'ready' — scroll keystrokes early-return when changelogLineCount
  // is missing so they no-op gracefully during loading / error states.
  if (state.activeView === 'changelog') {
    if (inputValue === 'j' && context.changelogLineCount) {
      return [action({ type: 'pageChangelog', delta: 1, lineCount: context.changelogLineCount })]
    }
    if (inputValue === 'k' && context.changelogLineCount) {
      return [action({ type: 'pageChangelog', delta: -1, lineCount: context.changelogLineCount })]
    }
    if (key.pageDown && context.changelogLineCount) {
      return [action({ type: 'pageChangelog', delta: 10, lineCount: context.changelogLineCount })]
    }
    if (key.pageUp && context.changelogLineCount) {
      return [action({ type: 'pageChangelog', delta: -10, lineCount: context.changelogLineCount })]
    }
    if (inputValue === 'y') {
      return [{ type: 'yankChangelog' }]
    }
    if (inputValue === 'E') {
      return [{ type: 'openChangelogInEditor' }]
    }
    if (inputValue === 'c') {
      return [{ type: 'startCreatePullRequest' }]
    }
    if (inputValue === 'r') {
      return [{ type: 'regenerateChangelog' }]
    }
  }

  if (inputValue === 'g') {
    if (state.pendingKey === 'g') {
      return [
        action({ type: 'moveToTop' }),
        action({ type: 'setStatus', value: 'jumped to first commit' }),
      ]
    }

    return [action({ type: 'setPendingKey', value: 'g' })]
  }

  // `d` on the diff view toggles between unified and side-by-side split
  // rendering (#785). Scoped to the diff view so the letter stays free
  // for other surfaces. The chord branch above already claimed `gd`,
  // so by the time we get here `pendingKey` is not `g`.
  if (inputValue === 'd' && state.activeView === 'diff') {
    const next = state.diffViewMode === 'unified' ? 'split' : 'unified'
    return [
      action({ type: 'toggleDiffViewMode' }),
      action({
        type: 'setStatus',
        value: next === 'split'
          ? 'Switched to side-by-side diff'
          : 'Switched to unified diff',
      }),
    ]
  }

  if (inputValue === '\\') {
    return [action({ type: 'toggleGraph' })]
  }

  if (inputValue === '<') {
    return [action({ type: 'popView' })]
  }

  if (inputValue === 'G') {
    return [
      action({ type: 'moveToBottom' }),
      action({ type: 'setStatus', value: 'jumped to last commit' }),
    ]
  }

  if (inputValue === 'n') {
    return [action({ type: 'move', delta: 1 })]
  }

  if (inputValue === 'N') {
    return [action({ type: 'move', delta: -1 })]
  }

  if (inputValue === 'r') {
    return [{ type: 'refreshContext' }]
  }

  if (inputValue === 's') {
    if (isBranchActionTarget(state)) {
      return [action({ type: 'cycleBranchSort' })]
    }
    if (isTagActionTarget(state)) {
      return [action({ type: 'cycleTagSort' })]
    }
    // Falls through so other views (history/status/diff/compose/stash) still
    // see the literal `s` for whatever per-view bindings they may grow.
  }

  if (inputValue === ':') {
    return [action({ type: 'toggleCommandPalette' })]
  }

  if (inputValue === '[') {
    if (state.activeView === 'diff' && context.worktreeHunkOffsets?.length) {
      return [action({
        type: 'jumpWorktreeHunk',
        delta: -1,
        hunkOffsets: context.worktreeHunkOffsets,
      })]
    }
    if (state.activeView === 'diff' && state.diffSource === 'stash' && context.stashDiffFileOffsets?.length) {
      return [action({
        type: 'jumpCommitDiffHunk',
        delta: -1,
        hunkOffsets: context.stashDiffFileOffsets,
      })]
    }
    if (state.activeView === 'diff' && context.commitDiffHunkOffsets?.length) {
      return [action({
        type: 'jumpCommitDiffHunk',
        delta: -1,
        hunkOffsets: context.commitDiffHunkOffsets,
      })]
    }
    // Inspector focused: cycle the inspector tab. The renderer only
    // honors the tab field on short terminals (where the inspector
    // collapses into a tabbed layout), but we let the user pre-set
    // their preference on tall terminals too.
    if (state.focus === 'detail') {
      return [action({ type: 'cycleInspectorTab', delta: -1 })]
    }
    return [action({ type: 'previousSidebarTab' })]
  }

  if (inputValue === ']') {
    if (state.activeView === 'diff' && context.worktreeHunkOffsets?.length) {
      return [action({
        type: 'jumpWorktreeHunk',
        delta: 1,
        hunkOffsets: context.worktreeHunkOffsets,
      })]
    }
    if (state.activeView === 'diff' && state.diffSource === 'stash' && context.stashDiffFileOffsets?.length) {
      return [action({
        type: 'jumpCommitDiffHunk',
        delta: 1,
        hunkOffsets: context.stashDiffFileOffsets,
      })]
    }
    if (state.activeView === 'diff' && context.commitDiffHunkOffsets?.length) {
      return [action({
        type: 'jumpCommitDiffHunk',
        delta: 1,
        hunkOffsets: context.commitDiffHunkOffsets,
      })]
    }
    if (state.focus === 'detail') {
      return [action({ type: 'cycleInspectorTab', delta: 1 })]
    }
    return [action({ type: 'nextSidebarTab' })]
  }

  // Status surface intercepts 1/2/3 before the sidebar-tab numeric
  // jump (#776): each key toggles a staging-category bit on the
  // visibility mask. The reducer snaps back to all-on if all three
  // bits go off so the user always has rendered files.
  if (state.activeView === 'status' && (inputValue === '1' || inputValue === '2' || inputValue === '3')) {
    const kind: 'staged' | 'unstaged' | 'untracked' =
      inputValue === '1' ? 'staged' : inputValue === '2' ? 'unstaged' : 'untracked'
    return [action({ type: 'toggleStatusFilterMask', kind })]
  }

  if (SIDEBAR_TAB_BY_NUMBER[inputValue]) {
    return [action({ type: 'setSidebarTab', value: SIDEBAR_TAB_BY_NUMBER[inputValue] })]
  }

  if (key.tab) {
    return [action({ type: key.shift ? 'focusPrevious' : 'focusNext' })]
  }

  // ←/→ on the sidebar switch tabs (Status ↔ Branches ↔ Tags ↔
  // Stashes ↔ Worktrees) — the horizontal axis is "between tabs", the
  // vertical axis (↑/↓ below) is "within the active tab's items".
  // [/] still works as a keyboard alternative for users who prefer
  // non-arrow keys.
  if (key.leftArrow && state.focus === 'sidebar') {
    return [action({ type: 'previousSidebarTab' })]
  }
  if (key.rightArrow && state.focus === 'sidebar') {
    return [action({ type: 'nextSidebarTab' })]
  }

  // ←/→ on the inspector switch between the [Inspector] / [Actions]
  // tabs, mirroring the sidebar's left/right tab semantics. `[` and
  // `]` still work as keyboard alternatives, but the visible hint in
  // the inspector chrome shows ←/→ because the bracketed `[/]`
  // notation reads as "press the / key" — which is the global filter
  // trigger and was making users think the binding was busted.
  if (key.leftArrow && state.focus === 'detail') {
    return [action({ type: 'setInspectorTab', value: 'inspector' })]
  }
  if (key.rightArrow && state.focus === 'detail') {
    return [action({ type: 'setInspectorTab', value: 'actions' })]
  }

  // ←/→ on the status surface jump between the staged / unstaged /
  // untracked groups — the horizontal axis is "between groups", the
  // vertical axis (↑/↓ below) is "within the active group's files".
  // Lands on the first file of the target group (clears header
  // focus) so the user is always on a real file after a jump,
  // mirroring the sidebar's tab-switch landing behavior.
  if (
    (key.leftArrow || key.rightArrow) &&
    state.activeView === 'status' &&
    state.focus === 'commits' &&
    context.statusGroups &&
    context.statusGroups.length > 1
  ) {
    const groups = context.statusGroups
    const currentIndex = groups.findIndex((group) =>
      state.selectedWorktreeFileIndex >= group.startIndex &&
      state.selectedWorktreeFileIndex < group.startIndex + group.count
    )
    const fallback = currentIndex >= 0 ? currentIndex : 0
    const delta = key.leftArrow ? -1 : 1
    const nextIndex = Math.max(0, Math.min(groups.length - 1, fallback + delta))
    if (nextIndex !== fallback) {
      return [action({ type: 'jumpToStatusGroup', targetIndex: groups[nextIndex].startIndex })]
    }
    return []
  }

  if (key.upArrow || inputValue === 'k') {
    // Inspector Actions tab: ↑/↓ moves the cursor through the
    // executable action list. Wins over moveDetailFile so a
    // history-commit explore with both file list AND actions visible
    // navigates the actions when the user has [/]-toggled to the
    // actions tab. (#791 follow-up)
    if (state.focus === 'detail' && state.inspectorTab === 'actions' && context.inspectorActionCount) {
      return [action({
        type: 'moveInspectorAction',
        delta: -1,
        actionCount: context.inspectorActionCount,
      })]
    }

    if (state.focus === 'detail' && context.detailFileCount) {
      return [action({ type: 'moveDetailFile', delta: -1, fileCount: context.detailFileCount })]
    }

    if (state.activeView === 'status' && context.worktreeFileCount) {
      // Already on the group header — ↑ is a no-op (use ←/→ to switch
      // groups). Mirrors the sidebar's "header is the top of the
      // hierarchy" behavior.
      if (state.statusGroupHeaderFocused) {
        return []
      }
      // Cursor at the first file of its group → promote to the group
      // header rather than crossing the boundary into the previous
      // group's last file. Keeps the cursor inside its current
      // container; ←/→ is the explicit way to move between groups.
      if (context.statusGroups && context.statusGroups.length > 0) {
        const currentGroup = context.statusGroups.find((group) =>
          state.selectedWorktreeFileIndex >= group.startIndex &&
          state.selectedWorktreeFileIndex < group.startIndex + group.count
        )
        if (currentGroup && state.selectedWorktreeFileIndex === currentGroup.startIndex) {
          return [action({ type: 'setStatusGroupHeaderFocused', value: true })]
        }
      }
      return [action({
        type: 'moveWorktreeFile',
        delta: -1,
        fileCount: context.worktreeFileCount,
      })]
    }

    // Diff view: j/k scrolls the visible diff one line. Hunk navigation
    // moved to ]/[ so single-hunk files (longer than the preview pane)
    // can scroll bidirectionally instead of getting pinned to a hunk
    // anchor.
    if (state.activeView === 'diff' && context.worktreeDiffLineCount) {
      return [action({
        type: 'pageWorktreeDiff',
        delta: -1,
        lineCount: context.worktreeDiffLineCount,
      })]
    }

    if (state.activeView === 'diff' && context.previewLineCount) {
      return [action({
        type: 'pageDetailPreview',
        delta: -1,
        previewLineCount: context.previewLineCount,
      })]
    }

    // Sidebar header focus: ↑ at item index 0 promotes the cursor
    // onto the active tab's header. Pressing ↑ again is a no-op
    // (use ←/→ to switch between tab headers, Enter to drill in).
    // Only triggers when the sidebar is focused on a content tab —
    // dedicated promoted views (`g b` etc.) keep the legacy clamp
    // behavior because they have no header to escape to.
    if (state.focus === 'sidebar' && !state.sidebarHeaderFocused) {
      if (state.sidebarTab === 'branches' && state.selectedBranchIndex === 0 && (context.branchCount ?? 0) > 0) {
        return [action({ type: 'setSidebarHeaderFocused', value: true })]
      }
      if (state.sidebarTab === 'tags' && state.selectedTagIndex === 0 && (context.tagCount ?? 0) > 0) {
        return [action({ type: 'setSidebarHeaderFocused', value: true })]
      }
      if (state.sidebarTab === 'stashes' && state.selectedStashIndex === 0 && (context.stashCount ?? 0) > 0) {
        return [action({ type: 'setSidebarHeaderFocused', value: true })]
      }
      if (state.sidebarTab === 'worktrees' && state.selectedWorktreeListIndex === 0 && (context.worktreeListCount ?? 0) > 0) {
        return [action({ type: 'setSidebarHeaderFocused', value: true })]
      }
    }
    // Already on the header — ↑ is a no-op (←/→ switches tabs).
    if (state.focus === 'sidebar' && state.sidebarHeaderFocused) {
      return []
    }

    if (isBranchActionTarget(state) && context.branchCount) {
      return [action({ type: 'moveBranch', delta: -1, count: context.branchCount })]
    }

    if (isTagActionTarget(state) && context.tagCount) {
      return [action({ type: 'moveTag', delta: -1, count: context.tagCount })]
    }

    if (isStashActionTarget(state) && context.stashCount) {
      return [action({ type: 'moveStash', delta: -1, count: context.stashCount })]
    }

    if (isReflogActionTarget(state) && context.reflogCount) {
      return [action({ type: 'moveReflog', delta: -1, count: context.reflogCount })]
    }

    if (isSubmodulesActionTarget(state) && context.submoduleCount) {
      return [action({ type: 'moveSubmodule', delta: -1, count: context.submoduleCount })]
    }

    if (isIssueActionTarget(state) && context.issueCount) {
      return [action({ type: 'moveIssue', delta: -1, count: context.issueCount })]
    }

    if (isPullRequestTriageActionTarget(state) && context.pullRequestTriageCount) {
      return [action({
        type: 'movePullRequestTriage',
        delta: -1,
        count: context.pullRequestTriageCount,
      })]
    }

    if (isWorktreeActionTarget(state) && context.worktreeListCount) {
      return [action({ type: 'moveWorktreeListEntry', delta: -1, count: context.worktreeListCount })]
    }

    if (state.activeView === 'conflicts' && context.conflictFileCount) {
      return [action({ type: 'moveConflictFile', delta: -1, count: context.conflictFileCount })]
    }

    if (
      state.activeView === 'history' &&
      state.focus === 'commits' &&
      state.selectedIndex === 0 &&
      !state.pendingCommitFocused &&
      context.worktreeDirty
    ) {
      return [action({ type: 'focusPendingCommit' })]
    }

    // Sidebar fallback: when no entity claim above succeeds (status
    // tab or empty content tab), ↑ falls through to cycling sidebar
    // tabs so the user always has a way to navigate. With ←/→ above
    // already handling tab switching, this is mostly a vim-style
    // safety net for `k`.
    return [
      action(state.focus === 'sidebar'
        ? { type: 'previousSidebarTab' }
        : { type: 'move', delta: -1 }),
    ]
  }

  if (key.downArrow || inputValue === 'j') {
    if (state.activeView === 'history' && state.pendingCommitFocused) {
      return [action({ type: 'unfocusPendingCommit' })]
    }

    if (state.focus === 'detail' && state.inspectorTab === 'actions' && context.inspectorActionCount) {
      return [action({
        type: 'moveInspectorAction',
        delta: 1,
        actionCount: context.inspectorActionCount,
      })]
    }

    if (state.focus === 'detail' && context.detailFileCount) {
      return [action({ type: 'moveDetailFile', delta: 1, fileCount: context.detailFileCount })]
    }

    if (state.activeView === 'status' && context.worktreeFileCount) {
      // Header focused → ↓ re-enters the group at the cursored file
      // (which is already the group's first file by construction).
      // Just clear the flag.
      if (state.statusGroupHeaderFocused) {
        return [action({ type: 'setStatusGroupHeaderFocused', value: false })]
      }
      return [action({
        type: 'moveWorktreeFile',
        delta: 1,
        fileCount: context.worktreeFileCount,
      })]
    }

    if (state.activeView === 'diff' && context.worktreeDiffLineCount) {
      return [action({
        type: 'pageWorktreeDiff',
        delta: 1,
        lineCount: context.worktreeDiffLineCount,
      })]
    }

    if (state.activeView === 'diff' && context.previewLineCount) {
      return [action({
        type: 'pageDetailPreview',
        delta: 1,
        previewLineCount: context.previewLineCount,
      })]
    }

    // Sidebar header focused: ↓ re-enters the list at index 0.
    // Clears the header flag and snaps the per-entity selection to 0
    // (mirrors the existing default selection behavior on first
    // sidebar focus).
    if (state.focus === 'sidebar' && state.sidebarHeaderFocused) {
      return [action({ type: 'setSidebarHeaderFocused', value: false })]
    }

    if (isBranchActionTarget(state) && context.branchCount) {
      return [action({ type: 'moveBranch', delta: 1, count: context.branchCount })]
    }

    if (isTagActionTarget(state) && context.tagCount) {
      return [action({ type: 'moveTag', delta: 1, count: context.tagCount })]
    }

    if (isStashActionTarget(state) && context.stashCount) {
      return [action({ type: 'moveStash', delta: 1, count: context.stashCount })]
    }

    if (isReflogActionTarget(state) && context.reflogCount) {
      return [action({ type: 'moveReflog', delta: 1, count: context.reflogCount })]
    }

    if (isSubmodulesActionTarget(state) && context.submoduleCount) {
      return [action({ type: 'moveSubmodule', delta: 1, count: context.submoduleCount })]
    }

    if (isIssueActionTarget(state) && context.issueCount) {
      return [action({ type: 'moveIssue', delta: 1, count: context.issueCount })]
    }

    if (isPullRequestTriageActionTarget(state) && context.pullRequestTriageCount) {
      return [action({
        type: 'movePullRequestTriage',
        delta: 1,
        count: context.pullRequestTriageCount,
      })]
    }

    if (isWorktreeActionTarget(state) && context.worktreeListCount) {
      return [action({ type: 'moveWorktreeListEntry', delta: 1, count: context.worktreeListCount })]
    }

    if (state.activeView === 'conflicts' && context.conflictFileCount) {
      return [action({ type: 'moveConflictFile', delta: 1, count: context.conflictFileCount })]
    }

    return [
      action(state.focus === 'sidebar'
        ? { type: 'nextSidebarTab' }
        : { type: 'move', delta: 1 }),
    ]
  }

  if (key.pageUp) {
    if (state.activeView === 'diff' && context.worktreeDiffLineCount) {
      return [action({
        type: 'pageWorktreeDiff',
        delta: -8,
        lineCount: context.worktreeDiffLineCount,
      })]
    }

    if (state.activeView === 'diff' && context.previewLineCount) {
      return [action({
        type: 'pageDetailPreview',
        delta: -8,
        previewLineCount: context.previewLineCount,
      })]
    }

    if (state.focus === 'detail' && context.previewLineCount) {
      return [action({
        type: 'pageDetailPreview',
        delta: -8,
        previewLineCount: context.previewLineCount,
      })]
    }

    return [action({ type: 'page', delta: -10 })]
  }

  if (key.pageDown) {
    if (state.activeView === 'diff' && context.worktreeDiffLineCount) {
      return [action({
        type: 'pageWorktreeDiff',
        delta: 8,
        lineCount: context.worktreeDiffLineCount,
      })]
    }

    if (state.activeView === 'diff' && context.previewLineCount) {
      return [action({
        type: 'pageDetailPreview',
        delta: 8,
        previewLineCount: context.previewLineCount,
      })]
    }

    if (state.focus === 'detail' && context.previewLineCount) {
      return [action({
        type: 'pageDetailPreview',
        delta: 8,
        previewLineCount: context.previewLineCount,
      })]
    }

    return [action({ type: 'page', delta: 10 })]
  }

  // Enter on the synthetic "(+) new commit" row pushes the status view so
  // the user can stage/commit. The pending flag is cleared on view push so
  // popping back lands on the real commit at index 0.
  if (
    key.return &&
    state.activeView === 'history' &&
    state.pendingCommitFocused
  ) {
    return [
      action({ type: 'pushView', value: 'status' }),
      action({ type: 'setStatus', value: 'staging worktree changes' }),
    ]
  }

  // Compare-flow Enter override (#779). When `compareBase` is set and
  // the user presses Enter on a branch / tag / history commit row, we
  // open the compare diff (base..head) instead of the row's normal
  // action (checkout / drill-in / diff). Scoped to compare-flow
  // targets so non-flow views keep their Enter intact. Runs BEFORE
  // the per-row Enter handlers below so the override wins, including
  // before the history-row drill-in.
  if (key.return && state.compareBase && isCompareFlowTarget(state)) {
    const head = getCursoredCompareRef(state, context)
    if (!head) {
      return [action({ type: 'setStatus', value: 'No ref under cursor — move to a branch / tag / commit row first' })]
    }
    if (head.ref === state.compareBase.ref && head.kind === state.compareBase.kind) {
      return [action({ type: 'setStatus', value: 'Compare base and head are the same ref — pick a different one' })]
    }
    return [
      action({
        type: 'navigateOpenDiffForCompare',
        base: state.compareBase,
        head,
      }),
      action({ type: 'setStatus', value: `Comparing ${state.compareBase.label} → ${head.label}` }),
    ]
  }

  // #879 item 4 — bisect-start wizard intercepts Enter on history
  // BEFORE the regular "open diff" handler so the user's pick fires
  // instead of drilling into the commit. Two steps:
  //   - mode='bad' : capture the cursored hash, advance to mode='good'
  //   - mode='good': fire `bisect-start-from-history` workflow with
  //                  payload `<bad>\n<good>` and let the runtime
  //                  validate + execute + clear the wizard
  if (
    key.return &&
    state.activeView === 'history' &&
    state.focus === 'commits' &&
    state.bisectPickMode &&
    state.filteredCommits.length > 0
  ) {
    const selected = state.filteredCommits[state.selectedIndex]
    if (selected) {
      if (state.bisectPickMode === 'bad') {
        return [
          action({ type: 'setBisectPickMode', mode: 'good', pendingBad: selected.hash }),
          action({
            type: 'setStatus',
            value: `bad = ${selected.shortHash}. Now pick a known-GOOD commit (older). Enter to confirm · esc to cancel`,
          }),
        ]
      }
      // mode === 'good': both shas captured, fire the workflow. The
      // payload uses a newline so the runtime can split cleanly
      // without ambiguity vs. sha characters.
      const badSha = state.bisectPickPendingBad
      if (badSha) {
        return [{
          type: 'runWorkflowAction',
          id: 'bisect-start-from-history',
          payload: `${badSha}\n${selected.hash}`,
        }]
      }
    }
  }

  if (
    key.return &&
    state.activeView === 'history' &&
    state.focus === 'commits' &&
    state.filteredCommits.length > 0
  ) {
    const selected = state.filteredCommits[state.selectedIndex]
    if (selected) {
      return [
        action({
          type: 'navigateOpenDiffForCommit',
          sha: selected.hash,
          commitIndex: state.selectedIndex,
        }),
        action({ type: 'setStatus', value: `viewing diff for ${selected.shortHash}` }),
      ]
    }
  }

  // Enter on a reflog row drills into the diff for that entry's hash
  // (#781). Reuses `navigateOpenDiffForCommit`, which finds the commit
  // by hash in `state.filteredCommits` first and falls back to
  // `commitIndex` only when the hash isn't present. Reflog hashes that
  // exist in the loaded history (the common case) drill in cleanly;
  // dangling-commit hashes fall back to the index. The `commitIndex`
  // we pass is best-effort — index in `state.commits` if found, else
  // `state.selectedIndex` so the cursor stays sane on the diff view.
  if (
    key.return &&
    isReflogActionTarget(state) &&
    context.reflogSelectedHash
  ) {
    const sha = context.reflogSelectedHash
    const fallbackIndex = state.commits.findIndex((commit) => commit.hash === sha)
    return [
      action({
        type: 'navigateOpenDiffForCommit',
        sha,
        commitIndex: fallbackIndex >= 0 ? fallbackIndex : state.selectedIndex,
      }),
      action({ type: 'setStatus', value: `viewing diff for ${sha.slice(0, 7)}` }),
    ]
  }

  // Inspector Actions tab: Enter on the cursored action fires its
  // associated event (cherry-pick / revert / yank / etc.). Wins over
  // the file-list Enter below when the user has [/]-toggled to the
  // actions tab. Routes through `getInspectorActionExecuteEvents` so
  // the per-action dispatch table stays the single source of truth
  // for what each action does. (#791 follow-up)
  if (
    key.return &&
    state.focus === 'detail' &&
    state.inspectorTab === 'actions'
  ) {
    const actions = getInspectorActionsForState(state)
    const cursored = actions[state.inspectorActionIndex]
    if (cursored) {
      return getInspectorActionExecuteEvents(cursored, state)
    }
  }

  // From the inspector / commit-diff detail panel, Enter opens (or refocuses)
  // the diff view scoped to the currently-selected commit and file. Lets the
  // user drive the explore flow entirely from the right panel: j/k picks a
  // file, Enter opens the diff for it.
  if (
    key.return &&
    state.focus === 'detail' &&
    (state.activeView === 'history' || state.activeView === 'diff') &&
    context.detailFileCount &&
    state.filteredCommits.length > 0
  ) {
    const selected = state.filteredCommits[state.selectedIndex]
    if (selected) {
      return [action({
        type: 'navigateOpenDiffForCommit',
        sha: selected.hash,
        commitIndex: state.selectedIndex,
        fileIndex: state.selectedFileIndex,
      })]
    }
  }

  // Enter on a sidebar tab drills into the corresponding promoted view
  // (status / branches / tags / stash) — but only when the sidebar tab
  // either has no per-entity Enter handler defined (status, tags,
  // worktrees) or has zero items (so the dedicated view's empty-state
  // tells the user what to do next).
  //
  // When the sidebar IS focused on a content tab WITH items, this
  // handler defers to the per-entity Enter below (checkout-branch for
  // branches, navigateOpenDiffForStash for stashes) so the user can
  // act on the cursored item without leaving the workstation view —
  // the in-sidebar selection win from #791 follow-up.
  //
  // The drill-in moves focus out of the sidebar into the newly opened
  // list — otherwise ↑/↓ keep navigating the sidebar instead of the
  // just-opened view, which made the drill-in feel half-done.
  if (key.return && state.focus === 'sidebar') {
    const sidebarItemCount = getSidebarItemCount(state.sidebarTab, context)
    const hasInSidebarPrimaryAction =
      (state.sidebarTab === 'branches' || state.sidebarTab === 'stashes') &&
      sidebarTabHasSelectableItems(state.sidebarTab, sidebarItemCount)

    // Three cases drill into the dedicated view:
    //   1. The cursor is on the tab header (user pressed ↑ at the
    //      top of the list to escape the items — Enter explicitly
    //      jumps to the dedicated view).
    //   2. The tab has no in-sidebar primary action defined (status,
    //      tags, worktrees — drilling in is the canonical path).
    //   3. The tab has zero items (the dedicated view's empty state
    //      tells the user what to do next).
    if (state.sidebarHeaderFocused || !hasInSidebarPrimaryAction) {
      const tabToView: Partial<Record<LogInkSidebarTab, 'status' | 'branches' | 'tags' | 'stash' | 'worktrees'>> = {
        status: 'status',
        branches: 'branches',
        tags: 'tags',
        stashes: 'stash',
        worktrees: 'worktrees',
      }
      const target = tabToView[state.sidebarTab]
      if (target) {
        return [
          action({ type: 'pushView', value: target }),
          action({ type: 'setFocus', value: 'commits' }),
        ]
      }
      return [action({ type: 'setStatus', value: 'no detail view for this tab' })]
    }
    // Fall through — per-entity Enter handler below claims the keystroke.
  }

  if (key.return && state.activeView === 'status' && state.focus === 'commits' && context.worktreeFileCount) {
    // Group header focused → fire the group's batch workflow action.
    // Routed through the workflow runner so the runtime owns the
    // git invocation + status messaging consistently with the
    // single-file `space` toggle. The `payload` carries the group's
    // state ('staged' / 'unstaged' / 'untracked') so the runtime can
    // resolve which files to act on without re-deriving group state.
    if (state.statusGroupHeaderFocused && context.statusGroups) {
      const currentGroup = context.statusGroups.find((group) =>
        state.selectedWorktreeFileIndex >= group.startIndex &&
        state.selectedWorktreeFileIndex < group.startIndex + group.count
      )
      if (currentGroup) {
        const workflowId = currentGroup.state === 'staged'
          ? 'unstage-all-staged'
          : currentGroup.state === 'unstaged'
          ? 'stage-all-unstaged'
          : 'stage-all-untracked'
        return [{ type: 'runWorkflowAction', id: workflowId, payload: currentGroup.state }]
      }
    }
    return [action({
      type: 'navigateOpenDiffForWorktreeFile',
      fileIndex: state.selectedWorktreeFileIndex,
    })]
  }

  // Enter on a conflict file opens the worktree diff for that file so
  // the user can inspect the conflict markers in context.
  if (key.return && state.activeView === 'conflicts' && context.conflictFileCount && context.conflictSelectedPath) {
    return [{ type: 'runWorkflowAction', id: 'resolve-conflict-open-diff', payload: context.conflictSelectedPath }]
  }

  // Enter on a branch row checks the branch out. Non-destructive workflow
  // action — no confirmation prompt. Fires from either the dedicated
  // branches view or from the sidebar when the branches tab is focused
  // with items.
  if (key.return && isBranchActionTarget(state) && context.branchCount) {
    return [{ type: 'runWorkflowAction', id: 'checkout-branch' }]
  }

  // `+` opens a create-branch / create-tag prompt depending on context.
  // Works from either the matching promoted view (active branches /
  // tags surface) or from the sidebar when the corresponding tab is
  // active — saves a drill-in for "I just want to make a new branch".
  const wantsCreateBranch = inputValue === '+' && (
    state.activeView === 'branches' ||
    (state.focus === 'sidebar' && state.sidebarTab === 'branches')
  )
  const wantsCreateTag = inputValue === '+' && (
    state.activeView === 'tags' ||
    (state.focus === 'sidebar' && state.sidebarTab === 'tags')
  )
  if (wantsCreateBranch) {
    return [action({
      type: 'openInputPrompt',
      kind: 'create-branch',
      label: 'New branch name',
    })]
  }
  if (wantsCreateTag) {
    return [action({
      type: 'openInputPrompt',
      kind: 'create-tag',
      label: 'New tag name',
    })]
  }

  // Per-view stash actions: `a` apply (keep the stash), `p` pop (apply
  // then drop). Drop is the existing destructive `X` workflow which
  // routes through the y-confirm path. Scoped to the stash target so
  // the letters stay free elsewhere — the target predicate also fires
  // when the sidebar's stashes tab is focused with items.
  if (inputValue === 'a' && isStashActionTarget(state) && context.stashCount) {
    return [{ type: 'runWorkflowAction', id: 'apply-stash' }]
  }
  if (inputValue === 'p' && isStashActionTarget(state) && context.stashCount) {
    return [{ type: 'runWorkflowAction', id: 'pop-stash' }]
  }
  // Per-view tag action: `P` pushes the selected tag to origin. Letter
  // is scoped to the tags target so it doesn't collide with `p` for
  // pop-stash. Note: this also takes precedence over the global
  // push-current-branch workflow's `P` key.
  if (inputValue === 'P' && isTagActionTarget(state) && context.tagCount) {
    return [{ type: 'runWorkflowAction', id: 'push-tag' }]
  }

  // Per-view branches actions: `R` renames the selected branch, `u`
  // sets its upstream. Both open the input prompt so the user can type
  // the new value. Pre-fills are handled by the prompt's `initial`.
  if (inputValue === 'R' && isBranchActionTarget(state) && context.branchCount) {
    return [action({
      type: 'openInputPrompt',
      kind: 'rename-branch',
      label: 'Rename branch to',
    })]
  }
  if (inputValue === 'u' && isBranchActionTarget(state) && context.branchCount) {
    return [action({
      type: 'openInputPrompt',
      kind: 'set-upstream',
      label: 'Upstream ref (e.g. origin/main)',
    })]
  }

  // Per-view tag action: `R` deletes the tag from the remote (after
  // confirmation). Scoped per-target so this letter is free elsewhere
  // (especially the `R` rename binding on the branches target).
  if (inputValue === 'R' && isTagActionTarget(state) && context.tagCount) {
    return [action({ type: 'setPendingConfirmation', value: 'delete-remote-tag' })]
  }


  // `m` marks (or un-marks) the cursored ref as the compare base
  // (#779). Scoped to compare-flow targets so it doesn't collide with
  // the `m` PR-merge handler further down. The toggle behavior — `m`
  // again on the same ref clears the base — gives the user a way to
  // bail out without remembering a separate cancel key.
  if (inputValue === 'm' && isCompareFlowTarget(state)) {
    const ref = getCursoredCompareRef(state, context)
    if (!ref) {
      return [action({ type: 'setStatus', value: 'No ref under cursor — move to a branch / tag / commit row first' })]
    }
    if (state.compareBase && state.compareBase.ref === ref.ref && state.compareBase.kind === ref.kind) {
      return [
        action({ type: 'clearCompareBase' }),
        action({ type: 'setStatus', value: `Cleared compare base ${ref.label}` }),
      ]
    }
    return [
      action({ type: 'setCompareBase', value: ref }),
      action({ type: 'setStatus', value: `Compare base: ${ref.label} — press enter on another ref to diff` }),
    ]
  }

  // Per-view worktree action: `D` removes the worktree AND deletes
  // the branch it was tracking (#838). Scoped to the worktrees
  // surface so it intercepts BEFORE the global workflow-by-key
  // dispatcher would otherwise route `D` to delete-branch (which
  // would silently target whatever was last cursored on the branches
  // surface instead of acting on the worktree under the cursor here).
  // `W` keeps its existing "remove worktree only" semantics.
  if (inputValue === 'D' && isWorktreeActionTarget(state) && context.worktreeListCount) {
    return [action({ type: 'setPendingConfirmation', value: 'remove-worktree-and-branch' })]
  }

  // #783 — full PR action panel keys, scoped to the pull-request view.
  // All five wrap a `gh pr <verb>` invocation; merge / request-changes /
  // comment open prompts first, the rest route through the y-confirm
  // path because they're irreversible (or near-irreversible).
  if (inputValue === 'm' && state.activeView === 'pull-request') {
    return [action({
      type: 'openInputPrompt',
      kind: 'pr-merge-strategy',
      label: 'Merge strategy (merge / squash / rebase)',
    })]
  }
  if (inputValue === 'x' && state.activeView === 'pull-request') {
    return [action({ type: 'setPendingConfirmation', value: 'close-pr' })]
  }
  if (inputValue === 'a' && state.activeView === 'pull-request') {
    return [action({ type: 'setPendingConfirmation', value: 'approve-pr' })]
  }
  if (inputValue === 'R' && state.activeView === 'pull-request') {
    // Free-form review body — multi-line so the reviewer can structure
    // their feedback naturally without opening $EDITOR (#806).
    return [action({
      type: 'openInputPrompt',
      kind: 'pr-request-changes',
      label: 'Request changes — review body (Enter newline · Ctrl+D submit)',
      multiline: true,
    })]
  }
  if (inputValue === 'c' && state.activeView === 'pull-request') {
    // Free-form comment body — multi-line for the same reason as
    // pr-request-changes.
    return [action({
      type: 'openInputPrompt',
      kind: 'pr-comment',
      label: 'Comment body (Enter newline · Ctrl+D submit)',
      multiline: true,
    })]
  }

  // #882 phase 4 — issue triage per-row actions. Scoped to the
  // `'issues'` view + commits focus so the single-letter keys stay
  // free elsewhere. Each prompts; submit dispatches the matching
  // `triage-issue-*` workflow which routes through `gh issue` and
  // invalidates both the in-memory + disk caches on success.
  if (state.activeView === 'issues' && state.focus === 'commits') {
    if (inputValue === 'O' && context.issueSelectedUrl) {
      return [{ type: 'runWorkflowAction', id: 'triage-issue-open' }]
    }
    if (inputValue === 'c' && context.issueCount) {
      return [action({
        type: 'openInputPrompt',
        kind: 'triage-issue-comment',
        label: 'Comment body (Enter newline · Ctrl+D submit)',
        multiline: true,
      })]
    }
    if (inputValue === 'L' && context.issueCount) {
      return [action({
        type: 'openInputPrompt',
        kind: 'triage-issue-label',
        label: 'Label name to add',
      })]
    }
    if (inputValue === 'A' && context.issueCount) {
      return [action({
        type: 'openInputPrompt',
        kind: 'triage-issue-assign',
        label: 'Assignee login (or @me)',
        initial: '@me',
      })]
    }
    // #882 phase 5 — destructive issue mutations. Both gated through
    // the y-confirm path. `x` closes (matches `pull-request` view's
    // close binding); `X` reopens, useful to undo a stray close.
    if (inputValue === 'x' && context.issueCount) {
      return [action({ type: 'setPendingConfirmation', value: 'triage-issue-close' })]
    }
    if (inputValue === 'X' && context.issueCount) {
      return [action({ type: 'setPendingConfirmation', value: 'triage-issue-reopen' })]
    }
  }

  // #882 phase 4 — PR triage per-row actions. Same shape as the
  // issue handlers above; distinct view id so the keys don't
  // collide with the single-PR action panel (`pull-request`).
  if (state.activeView === 'pull-request-triage' && state.focus === 'commits') {
    if (inputValue === 'O' && context.pullRequestTriageSelectedUrl) {
      return [{ type: 'runWorkflowAction', id: 'triage-pr-open' }]
    }
    if (inputValue === 'c' && context.pullRequestTriageCount) {
      return [action({
        type: 'openInputPrompt',
        kind: 'triage-pr-comment',
        label: 'Comment body (Enter newline · Ctrl+D submit)',
        multiline: true,
      })]
    }
    if (inputValue === 'L' && context.pullRequestTriageCount) {
      return [action({
        type: 'openInputPrompt',
        kind: 'triage-pr-label',
        label: 'Label name to add',
      })]
    }
    if (inputValue === 'A' && context.pullRequestTriageCount) {
      return [action({
        type: 'openInputPrompt',
        kind: 'triage-pr-assign',
        label: 'Assignee login (or @me)',
        initial: '@me',
      })]
    }
    // #882 phase 5 — destructive PR mutations on the triage view.
    // Mirror the single-PR action panel's keys (m / x / a / R) but
    // route to the by-number workflows. `m` and `R` open input
    // prompts first; submit lands the strategy / body as the
    // confirmation payload, which the runner picks up after y.
    if (inputValue === 'm' && context.pullRequestTriageCount) {
      return [action({
        type: 'openInputPrompt',
        kind: 'triage-pr-merge-strategy',
        label: 'Merge strategy (merge / squash / rebase)',
      })]
    }
    if (inputValue === 'x' && context.pullRequestTriageCount) {
      return [action({ type: 'setPendingConfirmation', value: 'triage-pr-close' })]
    }
    if (inputValue === 'a' && context.pullRequestTriageCount) {
      return [action({ type: 'setPendingConfirmation', value: 'triage-pr-approve' })]
    }
    if (inputValue === 'R' && context.pullRequestTriageCount) {
      return [action({
        type: 'openInputPrompt',
        kind: 'triage-pr-request-changes',
        label: 'Request changes — review body (Enter newline · Ctrl+D submit)',
        multiline: true,
      })]
    }
  }

  // Global stash hotkey: `S` opens a stash-message prompt and
  // `createStash` runs once submitted. Available everywhere there's
  // not a more modal handler in front of it.
  //
  // Scoped away from compose/status/diff (#907) since those views
  // map `S` to the commit-split flow (handler is further down so
  // those views fall through past this check). The triad is the
  // natural commit-message work surface; create-stash is reachable
  // from anywhere else (history, branches, tags, …).
  if (
    inputValue === 'S' &&
    state.activeView !== 'compose' &&
    state.activeView !== 'status' &&
    state.activeView !== 'diff'
  ) {
    return [action({
      type: 'openInputPrompt',
      kind: 'create-stash',
      label: 'Stash message',
    })]
  }

  // `o` opens the file under the cursor in $EDITOR. Available on the
  // status surface (worktree files), the worktree diff (the file being
  // diffed), and the stash diff (the file the cursor sits in inside
  // the patch). The runtime suspends Ink, spawns the editor sync, then
  // re-renders.
  if (inputValue === 'o' && state.activeView === 'status' && context.worktreeFileCount && context.worktreeSelectedPath) {
    return [{ type: 'openFileInEditor', path: context.worktreeSelectedPath }]
  }
  if (inputValue === 'o' && state.activeView === 'diff' && state.diffSource === 'worktree' && context.worktreeSelectedPath) {
    return [{ type: 'openFileInEditor', path: context.worktreeSelectedPath }]
  }
  if (inputValue === 'o' && state.activeView === 'diff' && state.diffSource === 'stash' && context.stashDiffSelectedPath) {
    return [{ type: 'openFileInEditor', path: context.stashDiffSelectedPath }]
  }

  // --- Conflicts view per-row handlers ---
  // `o` opens the conflicted file in $EDITOR for manual resolution.
  if (inputValue === 'o' && state.activeView === 'conflicts' && context.conflictFileCount && context.conflictSelectedPath) {
    return [{ type: 'openFileInEditor', path: context.conflictSelectedPath }]
  }
  // `s` stages the conflicted file (marks it resolved).
  if (inputValue === 's' && state.activeView === 'conflicts' && context.conflictFileCount && context.conflictSelectedPath) {
    return [{ type: 'runWorkflowAction', id: 'resolve-conflict-stage', payload: context.conflictSelectedPath }]
  }
  // `u` resolves by keeping theirs (incoming changes).
  if (inputValue === 'u' && state.activeView === 'conflicts' && context.conflictFileCount && context.conflictSelectedPath) {
    return [{ type: 'runWorkflowAction', id: 'resolve-conflict-theirs', payload: context.conflictSelectedPath }]
  }
  // `U` resolves by keeping ours (current branch).
  if (inputValue === 'U' && state.activeView === 'conflicts' && context.conflictFileCount && context.conflictSelectedPath) {
    return [{ type: 'runWorkflowAction', id: 'resolve-conflict-ours', payload: context.conflictSelectedPath }]
  }
  // `C` continues the in-progress operation (available when no conflicts remain).
  if (inputValue === 'C' && state.activeView === 'conflicts' && context.conflictFileCount === 0) {
    return [{ type: 'runWorkflowAction', id: 'continue-operation' }]
  }
  // Always intercept `C` on the conflicts view to prevent fallthrough to
  // the global `C` (Create PR) binding when conflicts remain.
  if (inputValue === 'C' && state.activeView === 'conflicts') {
    return [action({ type: 'setStatus', value: 'Resolve all conflicts before continuing' })]
  }
  // Global `C` — create a pull request from the current branch. The
  // runtime callback handles pre-flight (current branch resolution,
  // provider check) and seeds the input prompt with a changelog-derived
  // title + body before handing control back to the user for editing.
  // Conflicts view handles `C` above (continue-operation). Compose view
  // gets an explicit guard — claiming the keystroke with a status
  // message — so users mid-draft don't fat-finger out of their commit
  // into a PR-creation flow. Without this guard the keystroke would
  // fall through to the generic workflow-by-key dispatch at the end of
  // this function, which would fire `create-pr` to its handler.
  if (inputValue === 'C' && state.activeView === 'compose') {
    return [action({
      type: 'setStatus',
      value: 'Finish or cancel the commit draft before creating a PR.',
    })]
  }
  if (inputValue === 'C' && state.activeView !== 'conflicts') {
    return [{ type: 'startCreatePullRequest' }]
  }

  // Global `L` — generate the changelog for the current branch and
  // push the dedicated `changelog` view. Scoped to history and branches
  // — those are the natural "where am I, what landed here recently"
  // entry points. Avoids polluting every view's global namespace; the
  // changelog is reachable from anywhere via `g L` (added in keymap).
  if (
    inputValue === 'L' &&
    (state.activeView === 'history' || state.activeView === 'branches')
  ) {
    return [{ type: 'startChangelogView' }]
  }

  // `c` on a stash diff cherry-picks the file under the cursor —
  // materializes that single path from the stash into the working tree
  // (`git checkout <stashRef> -- <path>`). Routed through the y-confirm
  // path because the checkout overwrites the worktree file
  // unconditionally; the prompt is the user's chance to abort if they
  // have unsaved edits at that path.
  if (
    inputValue === 'c' &&
    state.activeView === 'diff' &&
    state.diffSource === 'stash' &&
    context.stashDiffSelectedPath &&
    state.stashDiffRef
  ) {
    return [action({
      type: 'setPendingConfirmation',
      value: 'checkout-file-from-stash',
      payload: context.stashDiffSelectedPath,
    })]
  }

  // `c` on a commit-diff explore cherry-picks the cursored file from
  // that historical commit — `git checkout <sha> -- <path>`. Same
  // confirmation rationale as the stash variant. The payload encodes
  // both the sha and the path so the runtime handler doesn't have to
  // re-resolve either.
  if (
    inputValue === 'c' &&
    state.activeView === 'diff' &&
    state.diffSource === 'commit' &&
    context.commitDiffSelectedPath &&
    context.commitDiffSelectedSha
  ) {
    return [action({
      type: 'setPendingConfirmation',
      value: 'checkout-file-from-commit',
      payload: `${context.commitDiffSelectedSha} ${context.commitDiffSelectedPath}`,
    })]
  }

  // `H` on a commit-diff or stash-diff explore extracts the hunk under
  // the cursor and applies it to the working tree (`git apply`). The
  // sibling `gH` chord targets the index (`git apply --cached`). Both
  // bypass the y-confirm path because `git apply` is non-destructive
  // (it'll fail loudly on conflict and `git apply -R` undoes a clean
  // apply).
  if (inputValue === 'H') {
    const events = buildApplyHunkEvents(state, context, 'worktree')
    if (events.length) {
      return events
    }
    if (state.activeView === 'diff' && (state.diffSource === 'commit' || state.diffSource === 'stash')) {
      return [action({ type: 'setStatus', value: 'no hunk under cursor — j/k to a + or - line first' })]
    }
  }

  // `c` on the history view cherry-picks the full selected commit on
  // top of the current branch. Routed through the y-confirm flow since
  // it can produce conflicts and is a real working-tree mutation.
  if (
    inputValue === 'c' &&
    state.activeView === 'history' &&
    state.focus === 'commits' &&
    state.filteredCommits.length > 0 &&
    !state.pendingCommitFocused
  ) {
    return [action({ type: 'setPendingConfirmation', value: 'cherry-pick-commit' })]
  }

  // `R` reverts the cursored commit by adding an inverse commit on top
  // of HEAD. Same y-confirm gate as cherry-pick — non-rewriting but
  // still a real mutation.
  if (
    inputValue === 'R' &&
    state.activeView === 'history' &&
    state.focus === 'commits' &&
    state.filteredCommits.length > 0 &&
    !state.pendingCommitFocused
  ) {
    return [action({ type: 'setPendingConfirmation', value: 'revert-commit' })]
  }

  // `Z` resets the current branch tip to the cursored commit. Opens a
  // mode prompt (soft / mixed / hard) instead of jumping straight to
  // confirmation because the choice changes the destructiveness
  // dramatically — `--hard` discards working-tree changes. The prompt
  // submission special-cases `kind === 'reset-mode'` to forward the
  // mode through `reset-to-commit` (see prompt-submit handler above).
  // No `initial` value: existing prompts append to initial rather than
  // replacing it, which would surprise the user typing the mode.
  if (
    inputValue === 'Z' &&
    state.activeView === 'history' &&
    state.focus === 'commits' &&
    state.filteredCommits.length > 0 &&
    !state.pendingCommitFocused
  ) {
    return [action({
      type: 'openInputPrompt',
      kind: 'reset-mode',
      label: 'Reset mode (soft / mixed / hard)',
    })]
  }

  // `i` (lowercase) starts an interactive rebase from the cursored
  // commit's parent. Lowercase keeps the existing global `I`
  // ai-commit-summary workflow reachable on the history view; `i`
  // also matches the `git rebase -i` flag mnemonic.
  if (
    inputValue === 'i' &&
    state.activeView === 'history' &&
    state.focus === 'commits' &&
    state.filteredCommits.length > 0 &&
    !state.pendingCommitFocused
  ) {
    return [action({ type: 'setPendingConfirmation', value: 'interactive-rebase' })]
  }

  // `B` opens a create-branch prompt rooted at the cursored commit
  // (`git branch <name> <sha>` — does NOT switch to the new branch).
  // The prompt itself is the affirmative gate, so no separate y-confirm.
  // Bare uppercase `B` since the lowercase `b` is used by the `gb`
  // chord prefix and we want a single keystroke for this common op.
  if (
    inputValue === 'B' &&
    state.activeView === 'history' &&
    state.focus === 'commits' &&
    state.filteredCommits.length > 0 &&
    !state.pendingCommitFocused
  ) {
    return [action({
      type: 'openInputPrompt',
      kind: 'create-branch-here',
      label: 'New branch name (at cursored commit)',
    })]
  }

  // `y` / `Y` yank the contextually relevant identifier from the active
  // view to the system clipboard:
  //   history    → cursored commit hash (Y for short hash)
  //   branches   → cursored branch shortName
  //   tags       → cursored tag name
  //   stash      → cursored stash ref
  //   status     → cursored worktree file path
  //   diff       → cursored file path (Y on a commit-diff yanks the sha instead)
  // The runtime resolves the actual value/label against live filtered
  // lists; the dispatcher only decides whether the keystroke applies.
  if (inputValue === 'y' || inputValue === 'Y') {
    const short = inputValue === 'Y'
    if (state.activeView === 'history' && state.filteredCommits.length > 0) {
      return [{ type: 'yankFromActiveView', short }]
    }
    if (isBranchActionTarget(state) && context.branchCount) {
      return [{ type: 'yankFromActiveView' }]
    }
    if (isTagActionTarget(state) && context.tagCount) {
      return [{ type: 'yankFromActiveView' }]
    }
    if (isStashActionTarget(state) && context.stashCount && context.stashSelectedRef) {
      return [{ type: 'yankFromActiveView' }]
    }
    if (state.activeView === 'status' && context.worktreeSelectedPath) {
      return [{ type: 'yankFromActiveView' }]
    }
    if (state.activeView === 'diff') {
      if (
        context.worktreeSelectedPath ||
        context.stashDiffSelectedPath ||
        context.commitDiffSelectedPath ||
        context.commitDiffSelectedSha
      ) {
        return [{ type: 'yankFromActiveView', short }]
      }
    }
    // #879 item 3: yank the first-bad commit sha from the bisect
    // completion panel. The headline answer is what the user came
    // here to copy; surfacing it via the same y/Y idiom (Y = short)
    // is faster than dropping to shell.
    if (state.activeView === 'bisect' && context.bisectCompletionSha) {
      return [{ type: 'yankFromActiveView', short }]
    }
    // #932 — submodules view: y yanks the cursored submodule's path
    // (most useful for `git submodule update <path>` etc.); Y yanks
    // the pinned commit sha (in either full or short form, like the
    // history view's Y).
    if (isSubmodulesActionTarget(state) && context.submoduleCount) {
      return [{ type: 'yankFromActiveView', short }]
    }
    // #882 phase 4 — triage views: y yanks the cursored issue / PR
    // URL so the user can paste it into a chat / PR description
    // without dropping back to the browser. Y is a no-op on these
    // views — there's no compact alternate identifier worth a
    // second key.
    if (isIssueActionTarget(state) && context.issueSelectedUrl) {
      return [{ type: 'yankFromActiveView' }]
    }
    if (isPullRequestTriageActionTarget(state) && context.pullRequestTriageSelectedUrl) {
      return [{ type: 'yankFromActiveView' }]
    }
  }

  // Enter on a stash row pushes the diff view scoped to that stash.
  // The runtime loads `git stash show -p <ref>` once the view is
  // active. The stash ref is passed via the action so we don't need a
  // context lookup here. Fires from either the dedicated stash view or
  // from the sidebar when the stashes tab is focused with items.
  if (key.return && isStashActionTarget(state) && context.stashCount && context.stashSelectedRef) {
    return [action({
      type: 'navigateOpenDiffForStash',
      ref: context.stashSelectedRef,
      stashIndex: state.selectedStashIndex,
    })]
  }

  if (inputValue === ' ' && state.activeView === 'status' && context.worktreeFileCount) {
    return [{ type: 'toggleSelectedFileStage' }]
  }

  if (inputValue === ' ' && state.activeView === 'diff' && context.worktreeHunkOffsets?.length) {
    return [{ type: 'toggleSelectedHunkStage' }]
  }

  if (inputValue === 'z' && state.activeView === 'status' && context.worktreeFileCount) {
    return [action({ type: 'setPendingMutationConfirmation', value: 'revert-file' })]
  }

  if (inputValue === 'z' && state.activeView === 'diff' && context.worktreeHunkOffsets?.length) {
    return [action({ type: 'setPendingMutationConfirmation', value: 'revert-hunk' })]
  }

  if (
    inputValue === 'e' &&
    (state.activeView === 'status' || state.activeView === 'diff' || state.activeView === 'compose')
  ) {
    const events: LogInkInputEvent[] = []
    if (state.activeView !== 'compose') {
      events.push(action({ type: 'pushView', value: 'compose' }))
    }
    events.push(action({ type: 'commitCompose', action: { type: 'setEditing', value: true } }))
    return events
  }

  // Capital `E` — open the commit draft in $EDITOR (or $VISUAL). Companion
  // to lowercase `e` which activates inline editing inside the panel:
  // `e` for quick tweaks in-place, `E` for "I want the full power of my
  // editor — syntax highlighting, multi-line nav, paste buffers, etc."
  // The runtime callback handles the temp-file write, editor session,
  // and read-back; the input handler emits a single event the
  // dispatcher routes there. As with lowercase `e`, fires from status
  // and diff views too (auto-pushes into compose first), since those
  // are the natural entry points to commit-message work.
  if (
    inputValue === 'E' &&
    (state.activeView === 'status' || state.activeView === 'diff' || state.activeView === 'compose')
  ) {
    const events: LogInkInputEvent[] = []
    if (state.activeView !== 'compose') {
      events.push(action({ type: 'pushView', value: 'compose' }))
    }
    events.push({ type: 'openComposeInEditor' })
    return events
  }

  // Capital `S` — start the `coco commit --split` flow as an in-TUI
  // operation (#907). Generates a split plan against the current
  // staged set and opens the plan-review overlay; from inside the
  // overlay, `y`/Enter applies the previewed plan. Fires from the
  // same triad as `E` (compose / status / diff) since those are the
  // entry points to commit-message work; from status/diff we push
  // into compose first so the flow ends with the user inside the
  // compose surface (now with the split applied).
  if (
    inputValue === 'S' &&
    (state.activeView === 'status' || state.activeView === 'diff' || state.activeView === 'compose')
  ) {
    const events: LogInkInputEvent[] = []
    if (state.activeView !== 'compose') {
      events.push(action({ type: 'pushView', value: 'compose' }))
    }
    events.push({ type: 'startCommitSplit' })
    return events
  }

  if (
    inputValue === 'c' &&
    (state.activeView === 'status' || state.activeView === 'diff' || state.activeView === 'compose')
  ) {
    const events: LogInkInputEvent[] = []
    if (state.activeView !== 'compose') {
      events.push(action({ type: 'pushView', value: 'compose' }))
    }
    events.push({ type: 'createManualCommit' })
    return events
  }

  const workflowAction = getLogInkWorkflowActionByKey(inputValue)

  if (workflowAction?.requiresConfirmation) {
    return [action({ type: 'setPendingConfirmation', value: workflowAction.id })]
  }

  if (workflowAction) {
    // Non-destructive workflow — fire it directly via the runtime
    // handler. The handler surfaces success/failure on the status line
    // and silently refreshes context so the list updates.
    return [{ type: 'runWorkflowAction', id: workflowAction.id }]
  }

  return []
}
