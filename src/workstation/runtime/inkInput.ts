import { deriveGitignoreOptions } from '../chrome/gitignore'
import { extractDiffHunk } from '../chrome/hunkExtraction'
import {
    InspectorAction,
    InspectorActionContext,
    getInspectorActions,
} from '../chrome/inspectorActions'
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
    LogInkView,
    filterThemePresets,
    getThemePickerSelection,
    isLogInkNestedRepo,
    parseLogInkHistoryFetchPrefix,
} from './inkViewModel'
import {
    getLogInkWorkflowActionById,
    getLogInkWorkflowActionByKey,
} from './inkWorkflows'
import { sidebarTabHasSelectableItems } from '../chrome/sidebarSelection'

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
  | { type: 'stageSelectedLines' }
  | { type: 'revertSelectedLines' }
  | { type: 'createManualCommit' }
  | { type: 'runAiCommitDraft' }
  | { type: 'cancelAiCommitDraft' }
  | { type: 'startCreatePullRequest' }
  | { type: 'cancelPullRequestBodyDraft' }
  | { type: 'startChangelogView' }
  | { type: 'cancelChangelog' }
  | { type: 'runAiConflictResolution' }
  | { type: 'cancelConflictResolution' }
  | { type: 'acceptConflictProposal' }
  | { type: 'acceptAllConflictProposals' }
  | { type: 'editConflictProposal' }
  | { type: 'startRebasePlan' }
  | { type: 'regenerateChangelog' }
  | { type: 'yankChangelog' }
  | { type: 'openChangelogInEditor' }
  | { type: 'openComposeInEditor' }
  | { type: 'startCommitSplit' }
  | { type: 'applyCommitSplit' }
  | { type: 'cancelCommitSplit' }
  | { type: 'runWorkflowAction'; id: string; payload?: string; confirmed?: boolean }
  | { type: 'openFileInEditor'; path: string }
  | { type: 'openConfigInEditor'; scope: 'global' | 'project' }
  | { type: 'yankFromActiveView'; short?: boolean }
  | { type: 'yankText'; value: string; label: string }
  | { type: 'applyThemePreset'; preset: string }
  // Open the "add to .gitignore" picker over the cursored worktree
  // file. Carries no path — the runtime resolves the cursored file (it
  // owns the selection→file mapping) and dispatches `openGitignorePicker`
  // with the resolved path, same pattern as `revertSelectedFile`.
  | { type: 'openGitignorePicker' }

export type LogInkInputContext = {
  /**
   * True on narrow terminals where only one pane renders at a time
   * (#1135). Gates the `v` peek key — peeking the sidebar is meaningless
   * in the three-pane layout where every pane is already visible.
   */
  singlePane?: boolean
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
  /**
   * Sorted + filtered branch shortNames, same order as the rendered
   * list (#1452 dual-write). Lets moveBranch resolve the post-move
   * target's id without duplicating sort/filter here — the caller
   * (`useInputHandler`) already has the filtered list in scope.
   */
  branchIds?: string[]
  /**
   * Name of the currently checked-out branch (#0.71). Used by the
   * branches-view `r` (rebase-onto) handler to build the confirmation
   * warning and to short-circuit a self-rebase / detached-HEAD before
   * routing through the y-confirm path. Undefined on a detached HEAD.
   */
  currentBranch?: string
  tagCount?: number
  /**
   * Name of the cursored tag (#779). Same role as
   * `branchSelectedShortName` but scoped to the tags view.
   */
  tagSelectedName?: string
  /** Sorted + filtered tag names, same role as `branchIds` (#1452). */
  tagIds?: string[]
  stashCount?: number
  /** Filtered stash refs, same role as `branchIds` (#1452). Stashes have no sort mode to apply. */
  stashIds?: string[]
  reflogCount?: number
  /** Hash of the cursored reflog entry (#781). Used by Enter to drill into the diff. */
  reflogSelectedHash?: string
  /**
   * Human description of the reflog tip's inverse operation (#1361 global
   * undo), or undefined when there's no reflog tip to undo yet. Set from
   * the RAW reflog (not the filtered/cursored view list) — global undo
   * always targets "the very last operation," regardless of what's
   * filtered or cursored on the reflog view.
   */
  reflogUndoDescription?: string
  /** Number of registered submodules (#932). Drives j/k navigation on the submodules view. */
  submoduleCount?: number
  /** Repo-relative path of the cursored submodule (#932). Reserved for future per-entry actions. */
  submoduleSelectedPath?: string
  /** Number of configured remotes (#0.71). Drives j/k navigation on the remotes view. */
  remoteCount?: number
  /** Name of the cursored remote (#0.71). Used as the yank target on the remotes view. */
  remoteSelectedName?: string
  /**
   * Number of blamed source lines for the active path (#0.71). Drives
   * j/k navigation on the on-demand blame view. Undefined / 0 while the
   * blame is still hydrating or the file is empty — the nav handlers
   * no-op in that case.
   */
  blameLineCount?: number
  /**
   * Number of commits in the file-history list for the active path (#COCO-14).
   * Drives j/k navigation on the file-history view. 0 while hydrating
   * or on an empty result — the nav handlers no-op in that case.
   */
  fileHistoryCommitCount?: number
  /**
   * Full sha of the commit under the cursor in the file-history view
   * (#COCO-14). Resolved in `useInputHandler.ts` from the cached
   * `FileHistoryResult`; undefined while hydrating or when no commit is
   * selected. Used by the Enter handler to drive
   * `navigateOpenDiffForCommit`.
   */
  fileHistorySelectedHash?: string
  /** Number of issues in the triage list view (#882 phase 3). Drives j/k navigation. */
  issueCount?: number
  /** URL of the cursored issue (#882 phase 3). Used by `O` to open in the browser. */
  issueSelectedUrl?: string
  /** Number of PRs in the triage list view (#882 phase 3). Drives j/k navigation. */
  pullRequestTriageCount?: number
  /** URL of the cursored PR in the triage list view (#882 phase 3). */
  pullRequestTriageSelectedUrl?: string
  /**
   * Number of the cursored PR in the triage list view (#1363). Drives
   * the Enter → PR diff drill-in and the `C` checkout workflow.
   */
  pullRequestTriageSelectedNumber?: number
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
   * Per-file `diff --git` line offsets inside the active PR diff
   * (#1363). Used by `]` / `[` to jump to next / previous file within
   * the PR patch — a distinct field from `stashDiffFileOffsets` so the
   * stash-only verbs never acquire a PR-diff target.
   */
  prDiffFileOffsets?: number[]
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
   * Resolved drill-in target for the file currently under the diff-view
   * cursor (#931 PR 3b). Set by the runtime when the cursored file is a
   * registered submodule AND the active frame's repo root has been
   * resolved; undefined otherwise. The Enter handler in the diff view
   * dispatches `pushRepoFrame` with this payload, opening the nested
   * frame against the submodule's working directory.
   */
  commitDiffSubmoduleDrillIn?: {
    label: string
    workdir: string
    entryRange?: { oldSha: string; newSha: string }
  }
  /**
   * Resolved drill-in target for the row currently under the cursor in
   * the dedicated submodules view (#931 PR 4 / #932). Set by the runtime
   * when the cursored entry has a workdir AND the active frame's repo
   * root has been resolved; undefined otherwise. The Enter handler in
   * the submodules view dispatches `pushRepoFrame` with this payload —
   * no entry range because there's no diff context in this view.
   */
  submoduleViewDrillIn?: {
    label: string
    workdir: string
  }
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
 * Resolve the id at the post-move index for a `moveBranch`/`moveTag`/
 * `moveStash` dispatch (#1452 dual-write). `ids` is the sorted +
 * filtered id list in render order; undefined when the caller hasn't
 * threaded it through `LogInkInputContext` yet (e.g. a test harness
 * exercising only `count`), in which case the move still dispatches —
 * it just carries no `id` payload.
 */
function resolveMoveTargetId(
  ids: string[] | undefined,
  currentIndex: number,
  delta: number,
  count: number,
): string | undefined {
  if (!ids || count === 0) return undefined
  const newIndex = Math.max(0, Math.min(currentIndex + delta, count - 1))
  return ids[newIndex]
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
      return [action({ type: 'setStatus', value: 'No commit selected', kind: 'warning' })]
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
        action({ type: 'setPendingChoice', value: RESET_MODE_CHOICE }),
      ])
    case 'i':
      return requireCommit(() => [{ type: 'startRebasePlan' }])
    case 'f':
      return requireCommit(() => [
        action({ type: 'setPendingConfirmation', value: 'fixup-into-commit' }),
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
        kind: 'warning',
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
 * The staging (worktree) diff is the active surface. Enter paths that set
 * an explicit source tag it 'worktree'; the `g d` chord pushes the diff
 * view without one, so `undefined` also means worktree. Commit / stash /
 * compare diffs must never match: with a dirty worktree their hydrated
 * worktree hunk/diff data would otherwise capture Space / z / j / k /
 * `[` `]` and stage, discard, or scroll a file the user isn't looking at.
 */
function isWorktreeDiffTarget(state: LogInkState): boolean {
  return (
    state.activeView === 'diff' &&
    (state.diffSource === 'worktree' || state.diffSource === undefined)
  )
}

/**
 * Explicit allowlists for the two "global-except-one-view" key bindings, per
 * KEYMAP.md's recommendation (§ "Prefer allowlists over negation guards"). These
 * used to be negation guards (`activeView !== 'conflicts'` / `!== compose/status/
 * diff`), which meant every NEW view silently inherited the binding. Listing the
 * views explicitly forces a new view to opt in instead.
 *
 * Keep these in sync with `LogInkView`: a binding test asserts the excluded
 * views are absent so the lists can't silently drift.
 */
// Bare `C` creates a pull request everywhere EXCEPT the conflicts view, where
// `C` means "mark conflict resolved", and the PR-triage view, where `C`
// means `gh pr checkout <n>` for the cursored row (#1363) — on a list of
// existing PRs, "get this PR's branch locally" is the far likelier intent
// than opening a brand-new PR.
const CREATE_PR_VIEWS: readonly LogInkView[] = [
  'history', 'status', 'diff', 'compose', 'branches', 'tags', 'stash',
  'worktrees', 'pull-request', 'issues', 'reflog',
  'bisect', 'changelog', 'submodules', 'remotes',
]
// Bare `S` creates a stash everywhere EXCEPT the commit triad
// (compose / status / diff), where `S` starts the commit-split flow.
const CREATE_STASH_VIEWS: readonly LogInkView[] = [
  'history', 'branches', 'tags', 'stash', 'worktrees', 'pull-request',
  'pull-request-triage', 'issues', 'conflicts', 'reflog', 'bisect',
  'changelog', 'submodules', 'remotes',
]

/** True when bare `C` should create a PR in the active view. */
export function isCreatePrView(view: LogInkView): boolean {
  return CREATE_PR_VIEWS.includes(view)
}

/** True when bare `S` should create a stash in the active view. */
export function isCreateStashView(view: LogInkView): boolean {
  return CREATE_STASH_VIEWS.includes(view)
}

/**
 * Submodules has no sidebar tab either — only the dedicated promoted
 * view (#932). Same shape as `isReflogActionTarget`.
 */
function isSubmodulesActionTarget(state: LogInkState): boolean {
  return state.activeView === 'submodules' && state.focus === 'commits'
}

/**
 * Remotes has no sidebar tab — only the dedicated promoted view
 * (#0.71). Same shape as `isReflogActionTarget` / `isSubmodulesActionTarget`.
 */
function isRemotesActionTarget(state: LogInkState): boolean {
  return state.activeView === 'remotes' && state.focus === 'commits'
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
        action({ type: 'setStatus', value: 'jumped to first commit', ttl: 'echo' }),
      ]
    case 'moveToBottom':
      return [
        action({ type: 'moveToBottom' }),
        action({ type: 'setStatus', value: 'jumped to last commit', ttl: 'echo' }),
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
        kind: 'warning',
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
    case 'createStash':
      return [action({
        type: 'openInputPrompt',
        kind: 'create-stash',
        label: 'Stash message (empty = WIP)',
      })]
    case 'navigateStatus':
      return [action({ type: 'replaceView', value: 'status' })]
    case 'navigateDiff':
      return [action({ type: 'replaceView', value: 'diff' })]
    case 'navigateCompose':
      return [action({ type: 'replaceView', value: 'compose' })]
    case 'navigateBranches':
      return [action({ type: 'replaceView', value: 'branches' })]
    case 'navigateTags':
      return [action({ type: 'replaceView', value: 'tags' })]
    case 'navigateStash':
      return [action({ type: 'replaceView', value: 'stash' })]
    case 'navigateWorktrees':
      return [action({ type: 'replaceView', value: 'worktrees' })]
    case 'navigatePullRequest':
      return [action({ type: 'replaceView', value: 'pull-request' })]
    case 'navigatePullRequestTriage':
      return [action({ type: 'replaceView', value: 'pull-request-triage' })]
    case 'navigateIssues':
      return [action({ type: 'replaceView', value: 'issues' })]
    case 'navigateConflicts':
      return [action({ type: 'replaceView', value: 'conflicts' })]
    case 'navigateReflog':
      return [action({ type: 'replaceView', value: 'reflog' })]
    case 'navigateBisect':
      return [action({ type: 'replaceView', value: 'bisect' })]
    case 'navigateSubmodules':
      return [action({ type: 'replaceView', value: 'submodules' })]
    case 'navigateRemotes':
      return [action({ type: 'replaceView', value: 'remotes' })]
    case 'markForCompare':
      // Palette context can't reach the cursored ref (filtered branch /
      // tag lists live in runtime state, not the reducer). Surface a
      // hint and let the user press `m` directly on the row. The
      // inline keypress handler further down in this file does the
      // actual work and has access to the necessary context.
      return [action({
        type: 'setStatus',
        value: 'open branches / tags / history and press m on the cursored ref',
        kind: 'warning',
      })]
    case 'navigateBack':
      // Mirror the Esc / `<` semantics (#931): drain the frame's view
      // stack first, then pop the frame itself when nested.
      if (state.viewStack.length > 1) {
        return [action({ type: 'popView' })]
      }
      if (isLogInkNestedRepo(state)) {
        return [action({ type: 'popRepoFrame' })]
      }
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
      return [action({ type: 'setPendingConfirmation', value: 'revert-file' })]
    case 'editCommit':
      return [
        ...(state.activeView !== 'compose'
          ? [action({ type: 'pushView', value: 'compose' })]
          : []),
        action({ type: 'commitCompose', action: { type: 'setEditing', value: true } }),
      ]
    case 'commit':
      return commitOrComposeEvents(state)
    case 'help':
      return [action({ type: 'toggleHelp' })]
    case 'commandPalette':
      // Re-toggling closes; the dispatcher will close after execute anyway.
      return []
    case 'themePicker':
      // Palette closes on execute (toggleCommandPalette runs first), then
      // this opens the theme picker.
      return [action({ type: 'toggleThemePicker' })]
    case 'viewKeys':
      // Palette closes on execute (toggleCommandPalette runs first), then
      // this opens the per-view which-key strip (#1137).
      return [action({ type: 'toggleViewKeys' })]
    case 'openProjectConfig':
      return [{ type: 'openConfigInEditor', scope: 'project' }]
    case 'openGlobalConfig':
      return [{ type: 'openConfigInEditor', scope: 'global' }]
    case 'gitignoreFile':
      // Runtime resolves the cursored worktree file and opens the picker
      // (no-ops with a warning when there's no file under the cursor).
      return [{ type: 'openGitignorePicker' }]
    case 'stageAll':
      return [{ type: 'runWorkflowAction', id: 'stage-all' }]
    case 'stagePathspec':
      return [action({
        type: 'openInputPrompt',
        kind: 'stage-pathspec',
        label: 'Stage pathspec (e.g. `.`, `src/`, `*.ts`, or a space-separated list)',
      })]
    case 'workflowDeleteBranch':
    case 'workflowDeleteTag':
    case 'workflowDropStash':
    case 'workflowRemoveWorktree':
    case 'workflowAbortOperation':
    case 'workflowAiCommitSummary':
    case 'workflowAiConflictHelp':
    case 'viewCherryPick':
    case 'viewRevert':
    case 'viewReset':
    case 'viewInteractiveRebase':
    case 'viewCreateBranchHere':
    case 'viewCreateTagHere':
    case 'viewChangelog':
    // #1447 registry backfill — per-view binding ids
    case 'workflowApplyStash':
    case 'workflowPopStash':
    case 'workflowApplyStashIndex':
    case 'workflowRenameStash':
    case 'workflowStashBranch':
    case 'workflowUndoDropStash':
    case 'workflowPushTag':
    case 'workflowDeleteRemoteTag':
    case 'workflowResolveOurs':
    case 'workflowResolveTheirs':
    case 'workflowResolveStage':
    case 'workflowContinueOperation':
    case 'workflowBisectGood':
    case 'workflowBisectBad':
    case 'workflowBisectSkip':
    case 'workflowBisectReset':
    case 'workflowBisectRun':
    case 'workflowCheckoutReflog':
    case 'workflowRemoteAdd':
    case 'workflowRemoteSetUrl':
    case 'workflowRemoteRemove':
    case 'workflowRemotePrune':
    case 'workflowSubmoduleInit':
    case 'workflowSubmoduleUpdate':
    case 'workflowSubmoduleSync':
    case 'workflowTriagePrCheckout':
    case 'workflowTriagePrOpen':
    case 'workflowTriageIssueOpen':
    case 'workflowRemoveWorktreeAndBranch':
      // Individual workflow entries; actual dispatch handled by the
      // workflow action lookup below.
      return []
    case 'quit':
      if (hasUnsavedComposeDraft(state)) {
        return [action({ type: 'setPendingConfirmation', value: 'discard-draft' })]
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
        kind: 'warning',
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

/**
 * The stage-and-commit grammar (#1362). `c` with a drafted summary
 * commits; `c` with an EMPTY draft lands in the compose view already
 * in edit mode with the summary field focused — instead of the old
 * "Commit summary is required." error that forced `e` → type → esc →
 * `c` (seven keys plus a failed attempt vs lazygit's three). Paired
 * with Ctrl+D-commits-from-editing below, the flow is
 * `gs → A → c → <type> → Ctrl+D`.
 */
function commitOrComposeEvents(state: LogInkState): LogInkInputEvent[] {
  const events: LogInkInputEvent[] = state.activeView !== 'compose'
    ? [action({ type: 'pushView', value: 'compose' })]
    : []
  if (!state.commitCompose.summary.trim()) {
    return [
      ...events,
      action({ type: 'commitCompose', action: { type: 'setField', value: 'summary' } }),
      action({ type: 'commitCompose', action: { type: 'setEditing', value: true } }),
      action({
        type: 'setStatus',
        value: 'Type the commit summary — Ctrl+D commits, esc exits editing.',
      }),
    ]
  }
  return [...events, { type: 'createManualCommit' }]
}

/**
 * 1-key choice prompts for the former typed-word prompts (#1351).
 * `Z` used to demand the user TYPE soft/mixed/hard (with an error
 * scold on typos); PR merges demanded the strategy word. The choice
 * overlay already existed — these constants route each option key
 * straight into the workflow with the mode/strategy as payload.
 */
const RESET_MODE_CHOICE = {
  id: 'reset-mode-choice',
  title: 'Reset branch tip to the cursored commit',
  warning: 'hard discards ALL uncommitted working-tree changes.',
  options: [
    { key: 's', label: 'Soft — keep changes staged', workflowId: 'reset-to-commit', payload: 'soft' },
    { key: 'm', label: 'Mixed — keep changes unstaged', workflowId: 'reset-to-commit', payload: 'mixed' },
    { key: 'h', label: 'Hard — discard working-tree changes', workflowId: 'reset-to-commit', payload: 'hard', destructive: true },
  ],
}

const mergeStrategyChoice = (workflowId: string) => ({
  id: 'pr-merge-strategy-choice',
  title: 'Merge pull request',
  warning: 'Lands on the base branch immediately.',
  options: [
    { key: 'm', label: 'Merge commit', workflowId, payload: 'merge', destructive: true },
    { key: 's', label: 'Squash and merge', workflowId, payload: 'squash', destructive: true },
    { key: 'r', label: 'Rebase and merge', workflowId, payload: 'rebase', destructive: true },
  ],
})

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
 *   - the former typed-word prompts (reset mode, merge strategy) are
 *     1-key choice prompts now (#1351) and never reach this function.
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
  // create-stash allows an EMPTY value → quick WIP stash (git supplies its
  // own "WIP on <branch>" subject). Handled before the generic empty guard
  // so an empty stash prompt commits a WIP stash instead of bouncing.
  if (state.inputPrompt.kind === 'create-stash') {
    return [
      { type: 'runWorkflowAction', id: 'create-stash', payload: value },
      action({ type: 'closeInputPrompt' }),
    ]
  }
  if (!value) {
    return [action({ type: 'setStatus', value: 'enter a value or press esc to cancel', kind: 'warning' })]
  }
  if (state.inputPrompt.kind === 'gitignore-pattern') {
    return [
      { type: 'runWorkflowAction', id: 'add-to-gitignore', payload: value },
      action({ type: 'closeInputPrompt' }),
    ]
  }
  if (state.inputPrompt.kind === 'stage-pathspec') {
    return [
      { type: 'runWorkflowAction', id: 'stage-pathspec', payload: value },
      action({ type: 'closeInputPrompt' }),
    ]
  }
  if (state.inputPrompt.kind === 'rebase-reword') {
    return [
      action({ type: 'setRebaseRewordMessage', message: value }),
      action({ type: 'closeInputPrompt' }),
    ]
  }
  if (state.inputPrompt.kind === 'reword-head') {
    return [
      { type: 'runWorkflowAction', id: 'reword-head', payload: value },
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
  // #0.71 — remotes view prompts. Both forward the typed value to their
  // workflow id; the runtime parses `name url` (add) or applies the URL
  // to the cursored remote (set-url). The prompt is the affirmative
  // gate, so neither routes through the y-confirm path.
  if (state.inputPrompt.kind === 'add-remote') {
    return [
      { type: 'runWorkflowAction', id: 'remote-add', payload: value },
      action({ type: 'closeInputPrompt' }),
    ]
  }
  if (state.inputPrompt.kind === 'set-remote-url') {
    return [
      { type: 'runWorkflowAction', id: 'remote-set-url', payload: value },
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
    if (hasUnsavedComposeDraft(state) && !state.pendingConfirmationId) {
      return [action({ type: 'setPendingConfirmation', value: 'discard-draft' })]
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
      // #1446 — two-stage Esc for input prompts. First Esc clears
      // non-empty text (the user can keep typing or press Esc again);
      // second Esc on empty text closes the prompt. Matches the filter,
      // palette, and theme-picker contracts so the most expensive text
      // (multiline review bodies, PR descriptions) gets the same
      // protection as the cheapest (a single-word filter).
      if (state.inputPrompt.value.length > 0) {
        return [action({ type: 'clearInputPromptText' })]
      }
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

  // Multi-option prompt (#1181) — the n-way generalization of the y/n
  // confirmation. Match the keypress against the prompt's options; each
  // either runs a workflow or fires a built-in navigation intent.
  //
  // Sits directly under the input prompt and ABOVE the compose-editing
  // and filter-mode intercepts (#1342): choice prompts are raised
  // asynchronously (worktree-checkout conflict, diverged-pull recovery,
  // …), so the user may be mid-typing when one appears. The overlay
  // renders on top; the keyboard must belong to it, not to the text
  // mode underneath.
  if (state.pendingChoice) {
    const option = state.pendingChoice.options.find((opt) => opt.key === inputValue)
    if (option) {
      // `switch-worktree` is pure navigation — open the worktree as a
      // nested repo frame. Handled here rather than via the workflow
      // runner, whose post-action context refresh would mis-target the
      // frame we just pushed.
      if (option.intent === 'switch-worktree' && state.worktreeCheckoutConflict) {
        const conflict = state.worktreeCheckoutConflict
        return [
          action({ type: 'pushRepoFrame', label: conflict.branch, workdir: conflict.worktreePath }),
          action({ type: 'setStatus', value: `Switched to worktree ${conflict.worktreePath} (${conflict.branch})` }),
          action({ type: 'setPendingChoice', value: undefined }),
          action({ type: 'setWorktreeCheckoutConflict', value: undefined }),
        ]
      }
      // `open-conflicts` routes straight to the conflicts view (#1360)
      // — pure navigation, same reasoning as `switch-worktree` above.
      // The sticky error status underneath stays put so the user still
      // sees what stopped the operation once they land on the view.
      if (option.intent === 'open-conflicts') {
        return [
          action({ type: 'pushView', value: 'conflicts' }),
          action({ type: 'setPendingChoice', value: undefined }),
        ]
      }
      if (option.workflowId) {
        // The workflow runner owns the live context + clears any
        // conflict state once it resolves. Options may carry a payload
        // (#1351 — reset mode, merge strategy).
        return [
          { type: 'runWorkflowAction', id: option.workflowId, payload: option.payload },
          action({ type: 'setPendingChoice', value: undefined }),
        ]
      }
      return [action({ type: 'setPendingChoice', value: undefined })]
    }
    if (inputValue === 'n' || key.escape) {
      return [
        action({ type: 'setPendingChoice', value: undefined }),
        ...(state.worktreeCheckoutConflict
          ? [action({ type: 'setWorktreeCheckoutConflict', value: undefined })]
          : []),
        // Recovery prompts raised on top of a sticky error status keep
        // that status visible after dismissal (#1360) — declining the
        // recovery doesn't make git's error less true.
        ...(state.pendingChoice.keepStatusOnDismiss
          ? []
          : [action({ type: 'setStatus', value: 'cancelled' })]),
      ]
    }
    return []
  }

  // Workflow y/n confirmation. Same modality rule as pendingChoice
  // above (#1342): confirmations can be raised asynchronously (e.g.
  // the force-push escalation after a rejected push), so they must
  // outrank editing / filter text modes for the keyboard.
  if (state.pendingConfirmationId) {
    if (inputValue === 'y') {
      const workflowAction = getLogInkWorkflowActionById(state.pendingConfirmationId)

      if (workflowAction?.id === 'ai-commit-summary') {
        return [
          { type: 'runAiCommitDraft' },
          action({ type: 'setPendingConfirmation', value: undefined }),
        ]
      }

      // AI conflict resolution (#1369): `M` → confirm → the runtime
      // hook extracts regions, runs the LLM, and lands per-region
      // proposals on the conflicts surface.
      if (workflowAction?.id === 'ai-conflict-help') {
        return [
          { type: 'runAiConflictResolution' },
          action({ type: 'setPendingConfirmation', value: undefined }),
        ]
      }

      // #1451 — mutation confirmations (formerly `pendingMutationConfirmation`).
      // These resolve via direct dispatch rather than `runWorkflowAction`
      // because they call synchronous runtime hooks, not async git ops.
      if (workflowAction?.id === 'revert-file') {
        return [
          { type: 'revertSelectedFile' },
          action({ type: 'setPendingConfirmation', value: undefined }),
        ]
      }
      if (workflowAction?.id === 'revert-hunk') {
        return [
          { type: 'revertSelectedHunk' },
          action({ type: 'setPendingConfirmation', value: undefined }),
        ]
      }
      if (workflowAction?.id === 'discard-lines') {
        return [
          { type: 'revertSelectedLines' },
          action({ type: 'setPendingConfirmation', value: undefined }),
        ]
      }
      if (workflowAction?.id === 'discard-draft') {
        return [
          action({ type: 'setPendingConfirmation', value: undefined }),
          { type: 'exit' },
        ]
      }
      if (workflowAction?.id === 'discard-rebase-plan') {
        return [
          action({ type: 'setPendingConfirmation', value: undefined }),
          action({ type: 'clearRebasePlan' }),
          action({ type: 'popView' }),
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
      // #1451 — per-id cancel messages for the unified confirmation system.
      const cancelMessage =
        state.pendingConfirmationId === 'discard-draft'
          ? 'kept draft — press q again to quit without saving'
          : state.pendingConfirmationId === 'discard-rebase-plan'
          ? 'kept rebase plan'
          : state.pendingConfirmationId === 'revert-file' ||
            state.pendingConfirmationId === 'revert-hunk' ||
            state.pendingConfirmationId === 'discard-lines'
          ? 'revert cancelled'
          : 'workflow action cancelled'
      return [
        action({ type: 'setPendingConfirmation', value: undefined }),
        action({ type: 'setStatus', value: cancelMessage }),
      ]
    }

    return []
  }

  // Cancel in-flight AI commit draft (#881 phase 3). When the compose
  // state has a draft in flight (loading === true), Esc aborts the
  // LLM call and the runtime handler cleans up (clear loading, clear
  // preview, status line shows "AI draft cancelled.").
  //
  // Audit finding #5: the `activeView === 'compose'` gate from the
  // original phase 3 implementation made the cancel keystroke
  // unreachable after the user chord-navigated away from compose
  // mid-stream (Esc would fall through to popView etc., consuming
  // the navigation intent while the LLM call silently ran to
  // completion). Cancel should work wherever the user is — they
  // can always navigate back to compose afterwards.
  //
  // Sits above the editing / view handlers so the cancel keystroke
  // can't fall through to "leave compose" or anything else. Loading
  // and editing are mutually exclusive in practice (the user can't
  // type while the AI is generating), but the order here makes the
  // precedence explicit if that ever changes.
  if (state.commitCompose.loading && key.escape) {
    return [{ type: 'cancelAiCommitDraft' }]
  }

  // Cancel in-flight PR body draft (#881 phase 4). The `C` keystroke
  // kicks off a changelog-based draft that runs for 5-15 seconds
  // before the input prompt opens. While the draft is pending, Esc
  // tells the runtime to skip the prompt and surface a "cancelled"
  // status. Unlike the compose cancel above, this is a *soft* cancel
  // — the background LLM call still completes, but its result is
  // discarded. Acceptable trade-off for now; deeper signal threading
  // through `changelogHandler` lands in a follow-up if real cancel
  // becomes a request.
  //
  // Sits unconditionally on the global Esc check (no `activeView`
  // gate) because the draft can be initiated from any view via the
  // palette `C` binding; Esc must work wherever the user is when
  // they decide to bail.
  if (state.pendingPullRequestBodyDraft && key.escape) {
    return [{ type: 'cancelPullRequestBodyDraft' }]
  }

  // Cancel in-flight changelog generation (#1338). Same invariant as
  // the two cancels above: Esc must cancel any in-flight AI call from
  // ANY view — the changelog runs 5-15s after `L`, and without this
  // Esc merely popped the view while the call ran to completion and
  // billed tokens. The runtime aborts the controller; the workflow's
  // cancelled path transitions the view out of loading.
  if (state.changelogView.status === 'loading' && key.escape) {
    return [{ type: 'cancelChangelog' }]
  }

  // Cancel in-flight AI conflict resolution (#1369). Same invariant:
  // Esc cancels any in-flight AI call from any view.
  if (state.conflictResolution?.status === 'loading' && key.escape) {
    return [{ type: 'cancelConflictResolution' }]
  }

  // Pending AI draft confirmation (audit finding #7). When the AI
  // draft completes against a non-empty compose surface, it lands in
  // `pendingAiDraft` instead of overwriting the user's typing. `R`
  // accepts the swap (user's typing is lost, AI draft becomes the
  // new content). `Esc` dismisses the AI draft (typing is preserved,
  // AI draft is lost — the user paid for the tokens but explicitly
  // chose not to use them).
  //
  // Gated on `activeView === 'compose'` because the pending draft is
  // only meaningful on the compose surface (where the message line
  // surfaces the prompt). A user who chord-navigated away while the
  // draft was pending should see the original `R` / Esc semantics of
  // wherever they are now.
  // Gated on `!editing` as well: while the user is actively typing,
  // `R` is just a letter and Enter advances the field — letting the
  // pending-draft accept intercept them here would replace the very
  // typing the pendingAiDraft staging exists to protect. The prompt
  // stays visible; the user answers it after leaving edit mode.
  if (
    state.activeView === 'compose' &&
    state.commitCompose.pendingAiDraft &&
    !state.commitCompose.editing
  ) {
    // `R` or `Enter` accept the swap (the AI draft becomes the new
    // content); `Enter` is the natural "yes, use it" confirmation.
    if ((inputValue === 'R' && !key.ctrl && !key.meta) || key.return) {
      return [action({ type: 'commitCompose', action: { type: 'acceptPendingAiDraft' } })]
    }
    if (key.escape) {
      return [action({ type: 'commitCompose', action: { type: 'dismissPendingAiDraft' } })]
    }
  }

  if (state.commitCompose.editing) {
    if (key.escape) {
      return [action({ type: 'commitCompose', action: { type: 'setEditing', value: false } })]
    }

    // #1362 — Ctrl+D commits straight from inline editing (the app's
    // multiline-prompt submit convention): type the message, one
    // chord, done — no mode exit, no second `c`. An empty summary
    // keeps the user editing with a hint instead of bouncing them
    // through the git layer's error.
    if (key.ctrl && inputValue === 'd') {
      if (!state.commitCompose.summary.trim()) {
        return [action({
          type: 'setStatus',
          value: 'Commit summary is required — type it first.',
          kind: 'warning',
        })]
      }
      return [
        action({ type: 'commitCompose', action: { type: 'setEditing', value: false } }),
        { type: 'createManualCommit' },
      ]
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
      // Esc closes the overlay AND aborts an in-flight generation —
      // `cancelCommitSplit` fires the plan AbortController (#1338
      // pattern), and the start path drops a superseded/aborted
      // result instead of dispatching setSplitPlanReady over the
      // user's next activity.
      return [{ type: 'cancelCommitSplit' }]
    }

    // `q` quits from the overlay like it does from help / view-keys
    // (#1348) — EXCEPT mid-apply, where quitting would abandon a
    // half-applied split. Loading is safe to quit from (same soft-
    // cancel semantics as Esc).
    if (inputValue === 'q' && state.splitPlan.status !== 'applying') {
      return [{ type: 'cancelCommitSplit' }, { type: 'exit' }]
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

  if (state.showThemePicker) {
    const filtered = filterThemePresets(state.themePickerFilter)

    if (key.escape) {
      // Two-stage Esc: clear a non-empty filter first, then close (and
      // revert the live preview to the previously-active theme).
      if (state.themePickerFilter.length > 0) {
        return [action({ type: 'clearThemePickerFilter' })]
      }
      return [action({ type: 'toggleThemePicker' })]
    }

    if (key.return) {
      const selected = getThemePickerSelection(state)
      if (!selected) {
        return [action({ type: 'toggleThemePicker' })]
      }
      return [
        action({ type: 'toggleThemePicker' }),
        { type: 'applyThemePreset', preset: selected },
      ]
    }

    if (key.upArrow || (key.ctrl && inputValue === 'p')) {
      return [action({ type: 'moveThemePicker', delta: -1, presetCount: filtered.length })]
    }
    if (key.downArrow || (key.ctrl && inputValue === 'n')) {
      return [action({ type: 'moveThemePicker', delta: 1, presetCount: filtered.length })]
    }
    if (key.backspace || key.delete) {
      return [action({ type: 'backspaceThemePickerFilter' })]
    }
    if (key.ctrl && inputValue === 'u') {
      return [action({ type: 'clearThemePickerFilter' })]
    }
    // All other printable input filters the list (so `j`/`k` type into the
    // filter rather than navigating — matching the command palette).
    if (inputValue && !key.ctrl && !key.meta) {
      return [action({ type: 'appendThemePickerFilter', value: inputValue })]
    }
    return []
  }

  if (state.gitignorePicker) {
    const options = deriveGitignoreOptions(state.gitignorePicker.file)
    if (key.escape) {
      return [action({ type: 'closeGitignorePicker' })]
    }
    if (key.upArrow || (key.ctrl && inputValue === 'p')) {
      return [action({ type: 'moveGitignorePicker', delta: -1, count: options.length })]
    }
    if (key.downArrow || (key.ctrl && inputValue === 'n')) {
      return [action({ type: 'moveGitignorePicker', delta: 1, count: options.length })]
    }
    if (key.return) {
      const selected = options[Math.max(0, Math.min(state.gitignorePicker.index, options.length - 1))]
      if (!selected) {
        return [action({ type: 'closeGitignorePicker' })]
      }
      if (selected.custom) {
        // Hand off to a free-text prompt seeded with the file path so
        // the user can type any valid gitignore pattern (negations,
        // globs, anchored paths) the derived options don't cover.
        return [
          action({ type: 'closeGitignorePicker' }),
          action({
            type: 'openInputPrompt',
            kind: 'gitignore-pattern',
            label: `.gitignore pattern (e.g. ${selected.pattern || '*.log'})`,
            initial: selected.pattern,
          }),
        ]
      }
      return [
        action({ type: 'closeGitignorePicker' }),
        { type: 'runWorkflowAction', id: 'add-to-gitignore', payload: selected.pattern },
      ]
    }
    // Consume everything else so the underlying status view keys don't
    // leak through while the picker owns the screen.
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

  // Help-overlay key handling. While help is open we intercept ALL
  // keys here and return before they can fall through to scroll /
  // focus / navigation logic below. Without this, j/k while help is
  // open routes into `moveDetailFile`-style handlers, which mutates
  // focus state (`focus: 'detail'` → `'commits'` or `'sidebar'`) —
  // exactly the "scroll loses focus" bug.
  //
  // Allowed: Esc / ? (close), q (quit), j/k/arrows (scroll), Ctrl-d/u
  // (half-page). Everything else is swallowed by the trailing
  // `return []` so a stray keypress can't drop the user into the
  // wrong surface.
  if (state.showHelp) {
    // Type-to-filter (#1355) — `/` opens a text input that narrows the
    // 30+ binding rows. While it owns the keyboard, printable keys
    // append; Enter keeps the filter and returns j/k to scrolling;
    // Esc clears (mirrors the palette's two-stage Esc).
    if (state.helpFilterMode) {
      if (key.escape) {
        return [action({ type: 'clearHelpFilter' })]
      }
      if (key.return) {
        return [action({ type: 'commitHelpFilter' })]
      }
      if (key.backspace || key.delete) {
        return [action({ type: 'backspaceHelpFilter' })]
      }
      if (inputValue && !key.ctrl && !key.meta) {
        return [action({ type: 'appendHelpFilter', value: inputValue })]
      }
      return []
    }
    if (inputValue === '/') {
      return [action({ type: 'openHelpFilter' })]
    }
    if (key.escape || inputValue === '?') {
      // Two-stage Esc: a committed filter clears first, then the
      // overlay closes — same contract as the command palette.
      if (key.escape && state.helpFilter) {
        return [action({ type: 'clearHelpFilter' })]
      }
      return [action({ type: 'toggleHelp' })]
    }
    if (inputValue === 'q') {
      return [{ type: 'exit' }]
    }
    if (key.downArrow || inputValue === 'j') {
      return [action({ type: 'scrollHelp', delta: 1 })]
    }
    if (key.upArrow || inputValue === 'k') {
      return [action({ type: 'scrollHelp', delta: -1 })]
    }
    if (key.ctrl && inputValue === 'd') {
      return [action({ type: 'scrollHelp', delta: 10 })]
    }
    if (key.ctrl && inputValue === 'u') {
      return [action({ type: 'scrollHelp', delta: -10 })]
    }
    return []
  }

  // #1137 — the `g?` which-key strip. While it's open the keyboard is
  // claimed (mirrors the help overlay) so a stray keystroke can't drop
  // the user into a per-view action they didn't mean to trigger. Esc
  // closes; `?` is the progressive-disclosure step up to the full
  // categorized help; `q` still quits. Everything else is swallowed —
  // the user peeks, dismisses, then presses the key they came for.
  if (state.showViewKeys) {
    if (key.escape) {
      return [action({ type: 'toggleViewKeys' })]
    }
    if (inputValue === '?') {
      // Expand the compact strip into the full help overlay. `toggleHelp`
      // clears `showViewKeys` so the two never render at once.
      return [action({ type: 'toggleHelp' })]
    }
    if (inputValue === 'q') {
      return [{ type: 'exit' }]
    }
    return []
  }

  // #879 item 4 — Esc cancels an in-flight bisect-start wizard. Runs
  // BEFORE the generic `popView` so we both clear the wizard state
  // and walk back to the bisect view in one keystroke. Without this
  // ordering Esc would pop history back to bisect but the wizard
  // mode would stick around, and the next Enter on history would
  // still try to capture a sha.
  // Line-select on the staging diff: Esc drops the selection without
  // popping the view — the user is mid-staging, not leaving. Gated on
  // the WORKTREE diff (#1389): the anchor is meaningless on
  // commit/stash/compare diffs, and a stale one made the first Esc
  // clear invisible state instead of popping.
  if (
    key.escape &&
    state.diffLineSelectAnchor !== undefined &&
    state.activeView === 'diff' &&
    isWorktreeDiffTarget(state)
  ) {
    return [action({ type: 'setDiffLineSelectAnchor', value: undefined })]
  }

  // AI conflict-resolution session (#1369). While proposals are open
  // on the conflicts view they own the review keys: j/k walk regions,
  // y/e/n act on the cursored one, Y accepts everything pending, Esc
  // dismisses. The file is untouched until an explicit accept. Sits
  // ABOVE the global Esc-pop and single-letter fallbacks (`n` = move,
  // `y` = yank) so the review keys can't leak into navigation.
  if (state.activeView === 'conflicts' && state.conflictResolution) {
    const session = state.conflictResolution
    if (session.status === 'ready' && session.proposals.length > 0) {
      if (key.downArrow || inputValue === 'j') {
        return [action({ type: 'moveConflictProposal', delta: 1 })]
      }
      if (key.upArrow || inputValue === 'k') {
        return [action({ type: 'moveConflictProposal', delta: -1 })]
      }
      if (inputValue === 'y' && !key.ctrl && !key.meta) {
        return [{ type: 'acceptConflictProposal' }]
      }
      if (inputValue === 'Y' && !key.ctrl && !key.meta) {
        return [{ type: 'acceptAllConflictProposals' }]
      }
      if (inputValue === 'e' && !key.ctrl && !key.meta) {
        return [{ type: 'editConflictProposal' }]
      }
      if (inputValue === 'n' && !key.ctrl && !key.meta) {
        const proposal = session.proposals[session.selectedIndex]
        return proposal && proposal.status === 'pending'
          ? [action({
            type: 'setConflictProposalStatus',
            regionIndex: proposal.regionIndex,
            status: 'rejected',
          })]
          : []
      }
      if (key.escape) {
        return [
          action({ type: 'clearConflictResolution' }),
          action({ type: 'setStatus', value: 'Proposals dismissed — file untouched.' }),
        ]
      }
    }
    if (session.status === 'error' && key.escape) {
      return [action({ type: 'clearConflictResolution' })]
    }
  }

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

  // #1135 v2 — while peeking the sidebar, Esc or the peek key (`v`)
  // snaps back to the pane the user came from. Placed before the
  // generic Esc → popView so a peek glance returns to main rather than
  // walking the view stack. Every other key falls through to normal
  // handling (focus is on the sidebar during a peek), so ←/→ and ↑/↓
  // browse the sidebar and keep the peek open until an explicit exit.
  if (state.peekReturnFocus !== undefined && (key.escape || inputValue === 'v')) {
    return [action({ type: 'togglePeek' })]
  }

  // #1361 — multi-select Esc rungs, two-stage like the filter's Esc:
  // first Esc drops the range anchor (the user is mid-range and wants
  // out of range mode, not out of their marks), the next clears the
  // marked set. Scoped to the surface that owns the selection (the
  // promoted view OR its sidebar tab — marks can be toggled from both,
  // and the sidebar tab id doesn't always match the view id, e.g.
  // 'stash' the view vs 'stashes' the tab) so Esc on an unrelated view
  // still pops normally; placed above the generic popView rung so
  // clearing a selection never also navigates.
  const selectionOwnsFocus = state.selection && (
    state.selection.view === state.activeView ||
    (state.selection.view === 'branches' && isBranchActionTarget(state)) ||
    (state.selection.view === 'stash' && isStashActionTarget(state))
  )
  if (key.escape && state.selection && selectionOwnsFocus) {
    if (state.selection.anchorId !== undefined) {
      return [
        action({ type: 'setRangeAnchor', view: state.selection.view, id: undefined }),
        action({ type: 'setStatus', value: 'Range anchor cleared', ttl: 'echo' }),
      ]
    }
    return [
      action({ type: 'clearSelection' }),
      action({ type: 'setStatus', value: `Cleared ${state.selection.ids.size} marked`, ttl: 'echo' }),
    ]
  }

  // Compare-flow cancel via Esc (#779) when there's no view to pop.
  // History is always the nav-stack root (navigateHome resets the
  // stack instead of pushing "history" onto it), so a compareBase-armed
  // Esc previously had no target — the footer advertised "esc back" but
  // nothing fired. Treat it as an explicit cancel, mirroring the
  // same-ref `m` toggle above but without requiring the cursor to still
  // be parked on the base ref.
  if (key.escape && state.compareBase && state.activeView === 'history' && state.viewStack.length <= 1) {
    return [
      action({ type: 'clearCompareBase' }),
      action({ type: 'setStatus', value: `Cleared compare base ${state.compareBase.label}` }),
    ]
  }

  // #1446 — rebase-plan discard guard. A fully retagged/reordered
  // rebase plan is expensive to recreate; Esc-ing away should confirm
  // before silently dropping it, matching the compose-draft pattern.
  // The confirm is only raised when Esc WOULD pop away from the rebase
  // view (viewStack > 1) — otherwise there's nowhere to go and Esc
  // is a no-op anyway.
  if (key.escape && state.activeView === 'rebase' && state.rebasePlan && state.viewStack.length > 1) {
    return [action({ type: 'setPendingConfirmation', value: 'discard-rebase-plan' })]
  }

  if (key.escape && state.viewStack.length > 1) {
    return [action({ type: 'popView' })]
  }

  // #931 — Esc auto-pop. When the user has drilled into a submodule
  // (nested repo frame) AND they're at the root of that frame's own
  // view stack, Esc walks back out to the parent repo. Ordered after
  // the view-stack pop above so Esc still drains a frame's view stack
  // before popping the frame itself — the user sees a predictable
  // "back, back, back" path out.
  if (key.escape && isLogInkNestedRepo(state)) {
    return [action({ type: 'popRepoFrame' })]
  }

  if (inputValue === 'q') {
    if (hasUnsavedComposeDraft(state)) {
      return [action({ type: 'setPendingConfirmation', value: 'discard-draft' })]
    }
    return [{ type: 'exit' }]
  }

  // `g?` chord (#1137) — open the per-view which-key strip. Placed
  // BEFORE the bare `?` (full help) check below so the chord is read as
  // a unit: with `g` pending, `?` opens the view-keys strip rather than
  // toggling full help. Surfaces automatically in the `g` which-key menu
  // because its key is a two-char `g`-prefixed binding.
  if (state.pendingKey === 'g' && inputValue === '?') {
    return [
      action({ type: 'setPendingKey', value: undefined }),
      action({ type: 'toggleViewKeys' }),
    ]
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
      action({ type: 'setStatus', value: 'jumped to history', ttl: 'echo' }),
    ]
  }

  if (state.pendingKey === 'g' && inputValue === 's') {
    return [
      action({ type: 'replaceView', value: 'status' }),
      action({ type: 'setStatus', value: 'jumped to status', ttl: 'echo' }),
    ]
  }

  if (state.pendingKey === 'g' && inputValue === 'd') {
    return [
      action({ type: 'replaceView', value: 'diff' }),
      action({ type: 'setStatus', value: 'jumped to diff', ttl: 'echo' }),
    ]
  }

  if (state.pendingKey === 'g' && inputValue === 'c') {
    return [
      action({ type: 'replaceView', value: 'compose' }),
      action({ type: 'setStatus', value: 'jumped to compose', ttl: 'echo' }),
    ]
  }

  if (state.pendingKey === 'g' && inputValue === 'b') {
    return [
      action({ type: 'replaceView', value: 'branches' }),
      action({ type: 'setStatus', value: 'jumped to branches', ttl: 'echo' }),
    ]
  }

  if (state.pendingKey === 'g' && inputValue === 't') {
    return [
      action({ type: 'replaceView', value: 'tags' }),
      action({ type: 'setStatus', value: 'jumped to tags', ttl: 'echo' }),
    ]
  }

  if (state.pendingKey === 'g' && inputValue === 'z') {
    return [
      action({ type: 'replaceView', value: 'stash' }),
      action({ type: 'setStatus', value: 'jumped to stash', ttl: 'echo' }),
    ]
  }

  // `gZ` chord: stash all changes from ANY view — including status / diff /
  // compose, where bare `S` is claimed by the commit-split flow. Mnemonic
  // pair with `gz` (jump to the stash *view*). Opens the same message
  // prompt; an empty message creates a quick WIP stash.
  if (state.pendingKey === 'g' && inputValue === 'Z') {
    return [action({
      type: 'openInputPrompt',
      kind: 'create-stash',
      label: 'Stash message (empty = WIP)',
    })]
  }

  if (state.pendingKey === 'g' && inputValue === 'w') {
    return [
      action({ type: 'replaceView', value: 'worktrees' }),
      action({ type: 'setStatus', value: 'jumped to worktrees', ttl: 'echo' }),
    ]
  }

  // `gp` jumps to the dedicated pull-request action panel (#783).
  // Lowercase `p` matches the pattern of other navigation chords
  // (gh / gs / gd / gc / gb / gt / gz / gw). The panel renders the
  // current branch's PR via `gh pr view --json` enriched fields and
  // exposes m / x / a / R / c action keys scoped to the view.
  if (state.pendingKey === 'g' && inputValue === 'p') {
    return [
      action({ type: 'replaceView', value: 'pull-request' }),
      action({ type: 'setStatus', value: 'jumped to pull request', ttl: 'echo' }),
    ]
  }

  // `gP` chord (#882 phase 3): jump to the multi-PR triage list.
  // Capital P disambiguates from `gp` (current-branch PR panel).
  // Pleasingly symmetric with `gi` for issues — both lead to the
  // read-only list views shipped in #882.
  if (state.pendingKey === 'g' && inputValue === 'P') {
    return [
      action({ type: 'replaceView', value: 'pull-request-triage' }),
      action({ type: 'setStatus', value: 'jumped to PR triage', ttl: 'echo' }),
    ]
  }

  // `gi` chord (#882 phase 3): jump to the issue triage list.
  if (state.pendingKey === 'g' && inputValue === 'i') {
    return [
      action({ type: 'replaceView', value: 'issues' }),
      action({ type: 'setStatus', value: 'jumped to issues', ttl: 'echo' }),
    ]
  }

  if (state.pendingKey === 'g' && inputValue === 'x') {
    return [
      action({ type: 'replaceView', value: 'conflicts' }),
      action({ type: 'setStatus', value: 'jumped to conflicts', ttl: 'echo' }),
    ]
  }

  // `gr` chord: jump to the reflog browser (#781). Recovery view —
  // chronological list of reflog entries with Enter to drill into the
  // commit-diff for the entry's hash. Loaded lazily by the runtime.
  if (state.pendingKey === 'g' && inputValue === 'r') {
    return [
      action({ type: 'replaceView', value: 'reflog' }),
      action({ type: 'setStatus', value: 'jumped to reflog', ttl: 'echo' }),
    ]
  }

  // `gB` chord: jump to the bisect workflow view (#784). Capital B
  // disambiguates from `gb` (branches). Always navigates — even when
  // bisect is inactive — so the user can see the empty-state hint and
  // know how to start one. The view's surface tells them the next step.
  if (state.pendingKey === 'g' && inputValue === 'B') {
    return [
      action({ type: 'replaceView', value: 'bisect' }),
      action({ type: 'setStatus', value: 'jumped to bisect', ttl: 'echo' }),
    ]
  }

  // `gM` chord: jump to the dedicated submodules view (#932). Capital
  // M disambiguates from `gm` (not currently a chord, but the
  // single-letter `m` already means "mark compare base"). Always
  // navigates — even when no submodules are registered — so the
  // empty-state copy can tell the user how to add one.
  if (state.pendingKey === 'g' && inputValue === 'M') {
    return [
      action({ type: 'replaceView', value: 'submodules' }),
      action({ type: 'setStatus', value: 'jumped to submodules', ttl: 'echo' }),
    ]
  }

  // `gn` chord: jump to the dedicated remotes view (#0.71). `n` for
  // network/remotes; `gr` is already reflog. Always navigates — even
  // when no remotes are configured — so the empty-state copy can point
  // the user at `a add`.
  if (state.pendingKey === 'g' && inputValue === 'n') {
    return [
      action({ type: 'replaceView', value: 'remotes' }),
      action({ type: 'setStatus', value: 'jumped to remotes', ttl: 'echo' }),
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
      action({ type: 'setStatus', value: 'gH applies a hunk in commit-diff or stash-diff view', kind: 'warning' }),
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
      action({ type: 'setStatus', value: 'gT creates a tag at the cursored commit on the history view', kind: 'warning' }),
    ]
  }

  // gC — open the theme picker (browse + live-preview + apply a color theme).
  if (state.pendingKey === 'g' && inputValue === 'C') {
    return [
      action({ type: 'setPendingKey', value: undefined }),
      action({ type: 'toggleThemePicker' }),
    ]
  }

  // gk — open this repo's project config (.coco.json) in $EDITOR.
  if (state.pendingKey === 'g' && inputValue === 'k') {
    return [
      action({ type: 'setPendingKey', value: undefined }),
      { type: 'openConfigInEditor', scope: 'project' },
    ]
  }

  // gK — open the global config (~/.config/coco/config.json) in $EDITOR.
  if (state.pendingKey === 'g' && inputValue === 'K') {
    return [
      action({ type: 'setPendingKey', value: undefined }),
      { type: 'openConfigInEditor', scope: 'global' },
    ]
  }

  // Any other key while the chord is armed CANCELS it (which-key
  // semantics: an unknown continuation dismisses the chord without
  // acting). Unmatched keys used to fall through returning [] with the
  // prefix still armed, so an Esc "cancel" was a no-op and a `c`
  // pressed minutes later silently fired `gc`. `g` falls through to
  // the bare-`g` handler below, which resolves `gg` (jump to top).
  if (state.pendingKey === 'g' && inputValue !== 'g') {
    return [action({ type: 'setPendingKey', value: undefined })]
  }

  // #784 / #1352 — bisect view action keys. Scoped to `state.activeView
  // === 'bisect' && state.focus === 'commits'` so the single-letter
  // keys stay free everywhere else. Mark-good is `y` (yes/good), NOT
  // bare `g`: the old `g` binding shadowed the global chord prefix, so
  // a user reflexively typing `gh`/`gs` to navigate away silently ran
  // `git bisect good` on the current candidate. `g` now arms the chord
  // on bisect like everywhere else (`gh`/`gs`/`gx` work mid-bisect);
  // `b` keeps the `pendingKey !== 'g'` guard so `gb` still reaches
  // branches. The trade: `y` yank is unavailable on this one transient
  // view (the candidate sha is visible in the panel).
  if (state.activeView === 'bisect' && state.focus === 'commits') {
    // Gated off once the bisect has terminated: the completion panel
    // rebinds y/Y to yank the first-bad sha (#879 item 3), and there
    // is no candidate left to mark. Also gated on an ACTIVE session —
    // like `s`/`R`, marking is meaningless from the empty-state view
    // and used to surface a raw `git bisect` error ("You need to
    // start by \"git bisect start\"") on the status line.
    if (
      inputValue === 'y' &&
      !key.ctrl &&
      !key.meta &&
      context.bisectActive &&
      !context.bisectCompletionSha
    ) {
      return [{ type: 'runWorkflowAction', id: 'bisect-good' }]
    }
    if (inputValue === 'b' && state.pendingKey !== 'g' && context.bisectActive) {
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
    if (inputValue === 'x' && context.bisectActive) {
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
    // Arrows are synonyms for j/k here like on every other surface —
    // they used to be swallowed by the loading-state guard below even
    // when the view was ready, leaving ↓/↑ silently dead.
    if ((inputValue === 'j' || key.downArrow) && context.changelogLineCount) {
      return [action({ type: 'pageChangelog', delta: 1, lineCount: context.changelogLineCount })]
    }
    if ((inputValue === 'k' || key.upArrow) && context.changelogLineCount) {
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
    // While loading / errored there's no line count yet — swallow the
    // scroll keys instead of letting them fall through to the global
    // move handler, which used to scroll the HISTORY cursor invisibly
    // beneath this surface (#1348).
    if (inputValue === 'j' || inputValue === 'k' || key.upArrow || key.downArrow || key.pageUp || key.pageDown) {
      return []
    }
  }

  if (inputValue === 'g') {
    if (state.pendingKey === 'g') {
      // View-local top jumps (#1387): blame / file-history / changelog
      // advertise gg in the footer, but the generic moveToTop below
      // only touches the HISTORY cursor — the visible list stayed put
      // while the hidden selection silently relocated.
      if (state.activeView === 'blame') {
        return context.blameLineCount
          ? [
            action({ type: 'moveBlame', delta: -context.blameLineCount, count: context.blameLineCount }),
            action({ type: 'setStatus', value: 'jumped to first line', ttl: 'echo' }),
          ]
          : []
      }
      if (state.activeView === 'file-history') {
        return context.fileHistoryCommitCount
          ? [
            action({
              type: 'moveFileHistory',
              delta: -context.fileHistoryCommitCount,
              count: context.fileHistoryCommitCount,
            }),
            action({ type: 'setStatus', value: 'jumped to first commit', ttl: 'echo' }),
          ]
          : []
      }
      if (state.activeView === 'changelog') {
        return context.changelogLineCount
          ? [action({
            type: 'pageChangelog',
            delta: -context.changelogLineCount,
            lineCount: context.changelogLineCount,
          })]
          : []
      }
      return [
        action({ type: 'moveToTop' }),
        action({ type: 'setStatus', value: 'jumped to first commit', ttl: 'echo' }),
      ]
    }

    return [action({ type: 'setPendingKey', value: 'g' })]
  }

  // ── In-TUI interactive rebase surface (#1359) ───────────────────────
  // The plan claims its keys while the view is active: j/k cursor, J/K
  // reorder, p/s/f/d/e retag, r reword (prompt), Enter executes (behind
  // a y-confirm), Esc pops (which clears the plan). Placed before every
  // other single-letter handler so the rebase letters can't leak into
  // sort/fixup/diff-toggle semantics.
  if (state.activeView === 'rebase' && state.rebasePlan) {
    if (inputValue === 'J') {
      return [action({ type: 'moveRebaseRow', delta: 1 })]
    }
    if (inputValue === 'K') {
      return [action({ type: 'moveRebaseRow', delta: -1 })]
    }
    if (inputValue === 'p') {
      return [action({ type: 'setRebaseAction', action: 'pick' })]
    }
    if (inputValue === 's') {
      return [action({ type: 'setRebaseAction', action: 'squash' })]
    }
    if (inputValue === 'f') {
      return [action({ type: 'setRebaseAction', action: 'fixup' })]
    }
    if (inputValue === 'd') {
      return [action({ type: 'setRebaseAction', action: 'drop' })]
    }
    if (inputValue === 'e') {
      return [action({ type: 'setRebaseAction', action: 'edit' })]
    }
    if (inputValue === 'r') {
      const row = state.rebasePlan.rows[state.rebasePlan.selectedIndex]
      return [action({
        type: 'openInputPrompt',
        kind: 'rebase-reword',
        label: `New message for ${row?.shortSha ?? 'commit'}`,
        initial: row?.newMessage ?? row?.subject ?? '',
      })]
    }
    if (key.return) {
      return [action({ type: 'setPendingConfirmation', value: 'execute-rebase-plan' })]
    }
  }

  // `d` on the diff view toggles between unified and side-by-side split
  // rendering (#785). Scoped to the diff view so the letter stays free
  // for other surfaces. The chord branch above already claimed `gd`,
  // so by the time we get here `pendingKey` is not `g`.
  //
  // NOT on the staging (worktree) diff (#1344): that renderer is
  // unified-only (staging is the primary action there), so the toggle
  // used to report "Switched to side-by-side" while nothing changed —
  // and the flipped mode then leaked into the next commit/stash diff.
  // The footer already hides the `d` hint there; the handler now
  // matches it.
  if (inputValue === 'd' && state.activeView === 'diff' && !isWorktreeDiffTarget(state)) {
    const next = state.diffViewMode === 'unified' ? 'split' : 'unified'
    return [
      action({ type: 'toggleDiffViewMode' }),
      action({
        type: 'setStatus',
        value: next === 'split'
          ? 'Switched to side-by-side diff'
          : 'Switched to unified diff',
        ttl: 'echo',
      }),
    ]
  }

  if (inputValue === '\\') {
    return [action({ type: 'toggleGraph' })]
  }

  if (inputValue === '<') {
    // #931 — `<` is the keymap-driven mirror of Esc auto-pop. When the
    // view stack has somewhere to go, pop a view; otherwise, if we're
    // in a nested submodule frame, walk back out to the parent. The
    // `popView` action is itself a no-op at the root of a frame's
    // view stack, so this ordering can't double-pop.
    if (state.viewStack.length > 1) {
      return [action({ type: 'popView' })]
    }
    if (isLogInkNestedRepo(state)) {
      return [action({ type: 'popRepoFrame' })]
    }
    return [action({ type: 'popView' })]
  }

  if (inputValue === 'G') {
    // View-local bottom jumps (#1387) — see the gg mirror above.
    if (state.activeView === 'blame') {
      return context.blameLineCount
        ? [
          action({ type: 'moveBlame', delta: context.blameLineCount, count: context.blameLineCount }),
          action({ type: 'setStatus', value: 'jumped to last line', ttl: 'echo' }),
        ]
        : []
    }
    if (state.activeView === 'file-history') {
      return context.fileHistoryCommitCount
        ? [
          action({
            type: 'moveFileHistory',
            delta: context.fileHistoryCommitCount,
            count: context.fileHistoryCommitCount,
          }),
          action({ type: 'setStatus', value: 'jumped to last commit', ttl: 'echo' }),
        ]
        : []
    }
    if (state.activeView === 'changelog') {
      return context.changelogLineCount
        ? [action({
          type: 'pageChangelog',
          delta: context.changelogLineCount,
          lineCount: context.changelogLineCount,
        })]
        : []
    }
    return [
      action({ type: 'moveToBottom' }),
      action({ type: 'setStatus', value: 'jumped to last commit', ttl: 'echo' }),
    ]
  }

  if (inputValue === 'n') {
    return [action({ type: 'move', delta: 1 })]
  }

  if (inputValue === 'N') {
    return [action({ type: 'move', delta: -1 })]
  }

  // Per-view branches action: `r` rebases the current branch onto the
  // cursored branch / ref (#0.71 — non-interactive `git rebase <ref>`).
  // The most dangerous op in this release — it rewrites the current
  // branch's history — so it NEVER runs directly: it routes through the
  // y-confirm path. Two guards run up front so the confirm prompt is
  // only raised for an operation that can actually proceed:
  //   - detached HEAD (no current branch): nothing to rebase onto a ref
  //   - self-rebase (cursored ref === current branch): a no-op git would
  //     reject anyway, surfaced here as a clear status instead.
  // Scoped to the branches target so the letter stays free elsewhere
  // (the global `r` refresh below still fires on every other view). The
  // confirmation warning names both branches; it's carried as the
  // pending-confirmation payload and rendered by `renderConfirmationPanel`
  // — the runtime handler re-resolves both branches off live context, so
  // it ignores this payload.
  if (inputValue === 'r' && isBranchActionTarget(state) && context.branchCount) {
    const current = context.currentBranch
    const target = context.branchSelectedShortName
    if (!current) {
      return [action({
        type: 'setStatus',
        value: 'Detached HEAD — checkout a branch before rebasing onto a ref.',
        kind: 'warning',
      })]
    }
    if (!target) {
      return [action({
        type: 'setStatus',
        value: 'No branch under cursor to rebase onto.',
        kind: 'warning',
      })]
    }
    if (target === current) {
      return [action({
        type: 'setStatus',
        value: 'Cannot rebase a branch onto itself.',
        kind: 'warning',
      })]
    }
    return [action({
      type: 'setPendingConfirmation',
      value: 'rebase-onto-branch',
      payload: `Rebase ${current} onto ${target}? This rewrites ${current}'s history.`,
    })]
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
    if (isWorktreeDiffTarget(state) && context.worktreeHunkOffsets?.length) {
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
    if (state.activeView === 'diff' && state.diffSource === 'pr' && context.prDiffFileOffsets?.length) {
      return [action({
        type: 'jumpCommitDiffHunk',
        delta: -1,
        hunkOffsets: context.prDiffFileOffsets,
      })]
    }
    if (state.activeView === 'diff' && state.diffSource === 'commit' && context.commitDiffHunkOffsets?.length) {
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
    if (isWorktreeDiffTarget(state) && context.worktreeHunkOffsets?.length) {
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
    if (state.activeView === 'diff' && state.diffSource === 'pr' && context.prDiffFileOffsets?.length) {
      return [action({
        type: 'jumpCommitDiffHunk',
        delta: 1,
        hunkOffsets: context.prDiffFileOffsets,
      })]
    }
    if (state.activeView === 'diff' && state.diffSource === 'commit' && context.commitDiffHunkOffsets?.length) {
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
  // bits go off so the user always has rendered files. NOT while the
  // sidebar is focused — its footer advertises "1-5 jump", and the
  // mask intercept silently ate 1/2/3 (toggling center-pane state)
  // while the sidebar stayed put.
  if (
    state.activeView === 'status' &&
    state.focus !== 'sidebar' &&
    (inputValue === '1' || inputValue === '2' || inputValue === '3')
  ) {
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

  // #1135 v2 — `v` peeks the sidebar from the main / inspector pane on
  // narrow (single-pane) terminals: a momentary glance that snaps back
  // with `v` / Esc (handled above once peeking). No-op in the three-pane
  // layout (every pane is already on screen) and from the sidebar itself.
  // NOT on the staging diff (#1389): `v` is line-select there, and the
  // peek intercept made line-level staging unreachable on narrow
  // terminals (the narrow footer even replaced the "v select" hint
  // with "v peek", so the feature silently vanished with width).
  // NOT on branch or stash action targets either (#1361): `v` is the
  // range-select anchor there — the same collision #1389 fixed for the
  // diff.
  if (
    inputValue === 'v' &&
    context.singlePane &&
    state.focus !== 'sidebar' &&
    !isWorktreeDiffTarget(state) &&
    !isBranchActionTarget(state) &&
    !isStashActionTarget(state)
  ) {
    return [action({ type: 'togglePeek' })]
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

    if (state.activeView === 'status' && state.focus === 'commits' && context.worktreeFileCount) {
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

    if (state.activeView === 'rebase' && state.rebasePlan) {
      return [action({ type: 'moveRebaseCursor', delta: -1 })]
    }

    // Worktree (staging) diff: ↑/↓ scroll lines — consistent with the
    // commit / stash diffs (#1185). `[`/`]` jump between hunks (the
    // staging unit), and the current hunk is derived from the scroll
    // position, so line-scrolling still walks the staging target.
    if (isWorktreeDiffTarget(state) && context.worktreeDiffLineCount) {
      return [action({
        type: 'pageWorktreeDiff',
        delta: -1,
        lineCount: context.worktreeDiffLineCount,
        hunkOffsets: context.worktreeHunkOffsets,
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
      return [action({
        type: 'moveBranch',
        delta: -1,
        count: context.branchCount,
        id: resolveMoveTargetId(context.branchIds, state.selectedBranchIndex, -1, context.branchCount),
      })]
    }

    if (isTagActionTarget(state) && context.tagCount) {
      return [action({
        type: 'moveTag',
        delta: -1,
        count: context.tagCount,
        id: resolveMoveTargetId(context.tagIds, state.selectedTagIndex, -1, context.tagCount),
      })]
    }

    if (isStashActionTarget(state) && context.stashCount) {
      return [action({
        type: 'moveStash',
        delta: -1,
        count: context.stashCount,
        id: resolveMoveTargetId(context.stashIds, state.selectedStashIndex, -1, context.stashCount),
      })]
    }

    if (isReflogActionTarget(state) && context.reflogCount) {
      return [action({ type: 'moveReflog', delta: -1, count: context.reflogCount })]
    }

    if (isRemotesActionTarget(state) && context.remoteCount) {
      return [action({ type: 'moveRemote', delta: -1, count: context.remoteCount })]
    }

    if (state.activeView === 'blame' && context.blameLineCount) {
      return [action({ type: 'moveBlame', delta: -1, count: context.blameLineCount })]
    }

    if (state.activeView === 'file-history' && context.fileHistoryCommitCount) {
      return [action({ type: 'moveFileHistory', delta: -1, count: context.fileHistoryCommitCount })]
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

    if (state.activeView === 'status' && state.focus === 'commits' && context.worktreeFileCount) {
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

    if (state.activeView === 'rebase' && state.rebasePlan) {
      return [action({ type: 'moveRebaseCursor', delta: 1 })]
    }

    // Worktree (staging) diff: ↓ scrolls lines (see the ↑ handler) —
    // `[`/`]` jump hunks (#1185).
    if (isWorktreeDiffTarget(state) && context.worktreeDiffLineCount) {
      return [action({
        type: 'pageWorktreeDiff',
        delta: 1,
        lineCount: context.worktreeDiffLineCount,
        hunkOffsets: context.worktreeHunkOffsets,
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
      return [action({
        type: 'moveBranch',
        delta: 1,
        count: context.branchCount,
        id: resolveMoveTargetId(context.branchIds, state.selectedBranchIndex, 1, context.branchCount),
      })]
    }

    if (isTagActionTarget(state) && context.tagCount) {
      return [action({
        type: 'moveTag',
        delta: 1,
        count: context.tagCount,
        id: resolveMoveTargetId(context.tagIds, state.selectedTagIndex, 1, context.tagCount),
      })]
    }

    if (isStashActionTarget(state) && context.stashCount) {
      return [action({
        type: 'moveStash',
        delta: 1,
        count: context.stashCount,
        id: resolveMoveTargetId(context.stashIds, state.selectedStashIndex, 1, context.stashCount),
      })]
    }

    if (isReflogActionTarget(state) && context.reflogCount) {
      return [action({ type: 'moveReflog', delta: 1, count: context.reflogCount })]
    }

    if (isRemotesActionTarget(state) && context.remoteCount) {
      return [action({ type: 'moveRemote', delta: 1, count: context.remoteCount })]
    }

    if (state.activeView === 'blame' && context.blameLineCount) {
      return [action({ type: 'moveBlame', delta: 1, count: context.blameLineCount })]
    }

    if (state.activeView === 'file-history' && context.fileHistoryCommitCount) {
      return [action({ type: 'moveFileHistory', delta: 1, count: context.fileHistoryCommitCount })]
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
    if (isWorktreeDiffTarget(state) && context.worktreeDiffLineCount) {
      return [action({
        type: 'pageWorktreeDiff',
        delta: -8,
        lineCount: context.worktreeDiffLineCount,
        hunkOffsets: context.worktreeHunkOffsets,
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

    // View-local paging (#1387) — the generic `page` fallback below
    // moves the HIDDEN history cursor beneath these surfaces.
    if (state.activeView === 'blame') {
      return context.blameLineCount
        ? [action({ type: 'moveBlame', delta: -10, count: context.blameLineCount })]
        : []
    }
    if (state.activeView === 'file-history') {
      return context.fileHistoryCommitCount
        ? [action({ type: 'moveFileHistory', delta: -10, count: context.fileHistoryCommitCount })]
        : []
    }

    return [action({ type: 'page', delta: -10 })]
  }

  if (key.pageDown) {
    if (isWorktreeDiffTarget(state) && context.worktreeDiffLineCount) {
      return [action({
        type: 'pageWorktreeDiff',
        delta: 8,
        lineCount: context.worktreeDiffLineCount,
        hunkOffsets: context.worktreeHunkOffsets,
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

    // View-local paging (#1387) — mirror of the pageUp branch above.
    if (state.activeView === 'blame') {
      return context.blameLineCount
        ? [action({ type: 'moveBlame', delta: 10, count: context.blameLineCount })]
        : []
    }
    if (state.activeView === 'file-history') {
      return context.fileHistoryCommitCount
        ? [action({ type: 'moveFileHistory', delta: 10, count: context.fileHistoryCommitCount })]
        : []
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
      return [action({ type: 'setStatus', value: 'No ref under cursor — move to a branch / tag / commit row first', kind: 'warning' })]
    }
    if (head.ref === state.compareBase.ref && head.kind === state.compareBase.kind) {
      return [action({ type: 'setStatus', value: 'Compare base and head are the same ref — pick a different one', kind: 'warning' })]
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

  // #931 PR 3b — Enter on a submodule file in a commit diff drills into
  // the submodule's history (the "spawn a coco ui scoped to the
  // submodule" mental model from the design doc). The runtime decides
  // whether the cursored file is a drill-in candidate and resolves the
  // workdir + entryRange ahead of time; the handler here only fires
  // when that target is populated. Ordered before the generic file-
  // list Enter handler so the drill-in takes precedence over the
  // detail-panel diff-refocus path.
  if (
    key.return &&
    state.activeView === 'diff' &&
    state.diffSource === 'commit' &&
    context.commitDiffSubmoduleDrillIn
  ) {
    const target = context.commitDiffSubmoduleDrillIn
    return [
      action({
        type: 'pushRepoFrame',
        label: target.label,
        workdir: target.workdir,
        entryRange: target.entryRange,
      }),
      action({ type: 'setStatus', value: `entering submodule ${target.label}` }),
    ]
  }

  // #931 PR 4 / #932 — Enter on a row in the dedicated submodules view
  // drills into that submodule's history. Same mental model as the
  // commit-diff drill-in (PR 3b) — pushing a frame is the equivalent
  // of `cd vendor/lib && coco ui`. No entry range here; the submodules
  // view doesn't carry diff context, so the frame lands on the
  // submodule's full history.
  if (
    key.return &&
    isSubmodulesActionTarget(state) &&
    context.submoduleViewDrillIn
  ) {
    const target = context.submoduleViewDrillIn
    return [
      action({
        type: 'pushRepoFrame',
        label: target.label,
        workdir: target.workdir,
      }),
      action({ type: 'setStatus', value: `entering submodule ${target.label}` }),
    ]
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

  // Enter on a file-history row drills into the diff for that commit
  // (#COCO-14). Mirrors the reflog drill-in: find the sha in
  // `filteredCommits` first, fall back to `state.selectedIndex` if the
  // commit isn't in the currently-loaded history window. The hash is
  // resolved in `useInputHandler.ts` (from the cached `FileHistoryResult`)
  // and carried here as `context.fileHistorySelectedHash`.
  if (key.return && state.activeView === 'file-history' && context.fileHistorySelectedHash) {
    const sha = context.fileHistorySelectedHash
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
      return [action({ type: 'setStatus', value: 'no detail view for this tab', kind: 'warning' })]
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
  // `A` applies restoring the staged/unstaged split (`git stash apply
  // --index`) — distinct from `a` (plain apply).
  if (inputValue === 'A' && isStashActionTarget(state) && context.stashCount) {
    return [{ type: 'runWorkflowAction', id: 'apply-stash-index' }]
  }
  // `b` turns the cursored stash into a new branch (`git stash branch`).
  if (inputValue === 'b' && isStashActionTarget(state) && context.stashCount) {
    return [action({ type: 'openInputPrompt', kind: 'stash-branch', label: 'New branch from stash' })]
  }
  // `R` renames the cursored stash (store-under-new-message + drop old).
  if (inputValue === 'R' && isStashActionTarget(state) && context.stashCount) {
    return [action({ type: 'openInputPrompt', kind: 'rename-stash', label: 'Rename stash' })]
  }
  // `u` undoes the last drop. Gated on the view, NOT the count, so it
  // still works right after you drop your only stash (the list is empty
  // but the dropped commit is recoverable by hash).
  if (inputValue === 'u' && isStashActionTarget(state)) {
    return [{ type: 'runWorkflowAction', id: 'undo-drop-stash' }]
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
      return [action({ type: 'setStatus', value: 'No ref under cursor — move to a branch / tag / commit row first', kind: 'warning' })]
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

  // #1361 multi-select — `x` toggles a mark on the cursored branch and
  // auto-advances one row (space-space-space staging ergonomic, #1353),
  // so marking a run of branches is `x x x`. Batch-capable workflows
  // (D delete) then act on the marked set, each target named in the
  // confirm panel. Esc clears (two-stage: range anchor first, marks
  // second).
  if (inputValue === 'x' && isBranchActionTarget(state) && context.branchCount) {
    const id = context.branchSelectedShortName
    if (!id) {
      return [action({ type: 'setStatus', value: 'No branch under cursor to mark', kind: 'warning' })]
    }
    return [
      action({ type: 'toggleMark', view: 'branches', id }),
      action({ type: 'moveBranch', delta: 1, count: context.branchCount }),
    ]
  }

  // #1361 — `v` anchors a range selection at the cursored branch; j/k
  // then extends it (the live range is anchor..cursor) and a
  // batch-capable workflow acts on the span. Same visual-select grammar
  // as the staging diff's line-select (#1389). `v` again clears the
  // anchor.
  if (inputValue === 'v' && isBranchActionTarget(state) && context.branchCount) {
    const anchored = state.selection?.view === 'branches' && state.selection.anchorId !== undefined
    if (anchored) {
      return [
        action({ type: 'setRangeAnchor', view: 'branches', id: undefined }),
        action({ type: 'setStatus', value: 'Range anchor cleared', ttl: 'echo' }),
      ]
    }
    const id = context.branchSelectedShortName
    if (!id) {
      return [action({ type: 'setStatus', value: 'No branch under cursor to anchor', kind: 'warning' })]
    }
    return [
      action({ type: 'setRangeAnchor', view: 'branches', id }),
      action({ type: 'setStatus', value: `Range anchor: ${id} — j/k extends, D acts on the range` }),
    ]
  }

  // #1361 — same x/v grammar on the stash view. `stash@{N}` refs shift
  // when an earlier drop lands, but that's a git-layer concern
  // (dropStashes drops in descending order) — the ids marked here stay
  // whatever ref was under the cursor at mark time, which is exactly
  // what the confirm panel will show.
  if (inputValue === 'x' && isStashActionTarget(state) && context.stashCount) {
    const id = context.stashSelectedRef
    if (!id) {
      return [action({ type: 'setStatus', value: 'No stash under cursor to mark', kind: 'warning' })]
    }
    return [
      action({ type: 'toggleMark', view: 'stash', id }),
      action({ type: 'moveStash', delta: 1, count: context.stashCount }),
    ]
  }

  if (inputValue === 'v' && isStashActionTarget(state) && context.stashCount) {
    const anchored = state.selection?.view === 'stash' && state.selection.anchorId !== undefined
    if (anchored) {
      return [
        action({ type: 'setRangeAnchor', view: 'stash', id: undefined }),
        action({ type: 'setStatus', value: 'Range anchor cleared', ttl: 'echo' }),
      ]
    }
    const id = context.stashSelectedRef
    if (!id) {
      return [action({ type: 'setStatus', value: 'No stash under cursor to anchor', kind: 'warning' })]
    }
    return [
      action({ type: 'setRangeAnchor', view: 'stash', id }),
      action({ type: 'setStatus', value: `Range anchor: ${id} — j/k extends, X acts on the range` }),
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
    // 1-key strategy choice (#1351); each option routes straight into
    // the merge workflow with the strategy as payload.
    return [action({ type: 'setPendingChoice', value: mergeStrategyChoice('merge-pr') })]
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
    // #882 phase 6 — cycle the canned filter preset (open → closed
    // → mine → assigned → open). The effect in app.ts watches
    // `state.selectedIssueFilter` and refetches with the matching
    // filter object, so the list updates without an explicit
    // refresh keystroke.
    if (inputValue === 'f') {
      return [action({ type: 'cycleIssueFilter' })]
    }
  }

  // #882 phase 4 — PR triage per-row actions. Same shape as the
  // issue handlers above; distinct view id so the keys don't
  // collide with the single-PR action panel (`pull-request`).
  if (state.activeView === 'pull-request-triage' && state.focus === 'commits') {
    // #1363 — Enter opens the PR diff (`gh pr diff <n>` hydrated by the
    // runtime once the view lands). Both guards matter: a zero count
    // (list still loading / empty / fully filtered out) or a missing
    // number mean there is no row to drill into, so Enter stays inert
    // instead of pushing a source-less diff view.
    if (key.return && context.pullRequestTriageCount && context.pullRequestTriageSelectedNumber) {
      return [
        action({
          type: 'navigateOpenDiffForPullRequest',
          number: context.pullRequestTriageSelectedNumber,
          pullRequestIndex: state.selectedPullRequestTriageIndex,
        }),
        action({ type: 'setStatus', value: `viewing diff for #${context.pullRequestTriageSelectedNumber}` }),
      ]
    }
    // #1363 — `C` checks the cursored PR out locally (`gh pr checkout
    // <n>`), the "review this properly" one-key. The triage view opted
    // OUT of the global create-PR `C` allowlist (see CREATE_PR_VIEWS)
    // so this binding owns the key here; create-PR stays reachable from
    // every other opted-in view.
    if (inputValue === 'C' && context.pullRequestTriageCount && context.pullRequestTriageSelectedNumber) {
      return [{ type: 'runWorkflowAction', id: 'triage-pr-checkout' }]
    }
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
      return [action({ type: 'setPendingChoice', value: mergeStrategyChoice('triage-pr-merge') })]
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
    // #882 phase 6 — cycle the canned filter preset (open → draft
    // → mine → assigned → closed → merged → open). The effect in
    // app.ts watches `state.selectedPullRequestFilter` and refetches
    // with the matching filter object.
    if (inputValue === 'f') {
      return [action({ type: 'cyclePullRequestTriageFilter' })]
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
  if (inputValue === 'S' && isCreateStashView(state.activeView)) {
    return [action({
      type: 'openInputPrompt',
      kind: 'create-stash',
      label: 'Stash message (empty = WIP)',
    })]
  }

  // `o` opens the file under the cursor in $EDITOR. Available on the
  // status surface (worktree files), the worktree diff (the file being
  // diffed), and the stash diff (the file the cursor sits in inside
  // the patch). The runtime suspends Ink, spawns the editor sync, then
  // re-renders.
  if (inputValue === 'o' && state.activeView === 'status' && context.worktreeFileCount && context.worktreeSelectedPath && !state.statusGroupHeaderFocused) {
    return [{ type: 'openFileInEditor', path: context.worktreeSelectedPath }]
  }
  // `i` opens the "add to .gitignore" picker for the cursored worktree
  // file. The runtime resolves the path + opens the picker (the bare
  // event carries no path — same selection-resolution pattern as the
  // revert / stage events).
  if (inputValue === 'i' && state.activeView === 'status' && context.worktreeFileCount && context.worktreeSelectedPath && !state.statusGroupHeaderFocused) {
    return [{ type: 'openGitignorePicker' }]
  }
  // `b` opens the on-demand blame drill-down for the cursored worktree
  // file (#0.71). Entered from the status file list; the runtime
  // resolves blame lazily into its `blameByPath` cache keyed by this
  // path. Also available from the worktree diff view, where the focused
  // file path is known.
  if (
    inputValue === 'b' &&
    state.activeView === 'status' &&
    context.worktreeFileCount &&
    context.worktreeSelectedPath &&
    !state.statusGroupHeaderFocused
  ) {
    return [action({ type: 'navigateOpenBlameForPath', path: context.worktreeSelectedPath })]
  }
  if (
    inputValue === 'b' &&
    state.activeView === 'diff' &&
    state.diffSource === 'worktree' &&
    context.worktreeSelectedPath
  ) {
    return [action({ type: 'navigateOpenBlameForPath', path: context.worktreeSelectedPath })]
  }
  // `L` opens the file-history drill-down (#COCO-14) — `git log --follow`
  // for the cursored path. Available from the status view (a file row),
  // from the blame view (drill deeper into the file's commit log), and
  // from the worktree diff view.
  if (
    inputValue === 'L' &&
    state.activeView === 'status' &&
    context.worktreeFileCount &&
    context.worktreeSelectedPath &&
    !state.statusGroupHeaderFocused
  ) {
    return [action({ type: 'navigateOpenFileHistoryForPath', path: context.worktreeSelectedPath })]
  }
  if (
    inputValue === 'L' &&
    state.activeView === 'diff' &&
    state.diffSource === 'worktree' &&
    context.worktreeSelectedPath
  ) {
    return [action({ type: 'navigateOpenFileHistoryForPath', path: context.worktreeSelectedPath })]
  }
  if (inputValue === 'L' && state.activeView === 'blame' && state.blamePath) {
    return [action({ type: 'navigateOpenFileHistoryForPath', path: state.blamePath })]
  }
  if (inputValue === 'o' && isWorktreeDiffTarget(state) && context.worktreeSelectedPath) {
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
    return [action({ type: 'setStatus', value: 'Resolve all conflicts before continuing', kind: 'warning' })]
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
      kind: 'warning',
    })]
  }
  // #1363 — `C` on the PR diff checks the viewed PR out locally, the
  // natural "read the patch → review it properly" follow-up. Must sit
  // before the create-PR fallthrough below ('diff' is an opted-in
  // create-PR view; only the PR-sourced diff repurposes the key). The
  // PR number travels as the payload so the runner targets the viewed
  // PR even if the triage list refetched underneath the diff.
  if (inputValue === 'C' && state.activeView === 'diff' && state.diffSource === 'pr' && state.prDiffNumber) {
    return [{ type: 'runWorkflowAction', id: 'triage-pr-checkout', payload: String(state.prDiffNumber) }]
  }
  if (inputValue === 'C' && isCreatePrView(state.activeView)) {
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
      return [action({ type: 'setStatus', value: 'no hunk under cursor — j/k to a + or - line first', kind: 'warning' })]
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
  // 1-key mode choice (#1351 — s soft / m mixed / h hard) instead of a
  // typed-word prompt; hard carries the destructive styling because it
  // discards working-tree changes.
  if (
    inputValue === 'Z' &&
    state.activeView === 'history' &&
    state.focus === 'commits' &&
    state.filteredCommits.length > 0 &&
    !state.pendingCommitFocused
  ) {
    return [action({ type: 'setPendingChoice', value: RESET_MODE_CHOICE })]
  }

  // `i` (lowercase) opens the in-TUI interactive rebase surface for
  // `<cursored>^..HEAD` (#1359) — reorder/squash/fixup/drop/reword as a
  // first-person list instead of shelling the todo into $GIT_EDITOR.
  // The editor variant stays palette-reachable as `interactive-rebase`.
  if (
    inputValue === 'i' &&
    state.activeView === 'history' &&
    state.focus === 'commits' &&
    state.filteredCommits.length > 0 &&
    !state.pendingCommitFocused
  ) {
    return [{ type: 'startRebasePlan' }]
  }

  // `f` creates a fixup! commit from the STAGED changes targeting the
  // cursored commit (#1357). y-confirm names the target; after a
  // successful fixup the runtime raises a choice prompt offering to run
  // the autosquash rebase immediately. `f` is free on history (the
  // triage views' filter-cycle `f` is scoped to those views).
  if (
    inputValue === 'f' &&
    state.activeView === 'history' &&
    state.focus === 'commits' &&
    state.filteredCommits.length > 0 &&
    !state.pendingCommitFocused
  ) {
    return [action({ type: 'setPendingConfirmation', value: 'fixup-into-commit' })]
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

  // Reflog "time machine" (#0.67): the cursored reflog entry supports the same
  // reset / branch-from operations as a history commit, plus a checkout that
  // detaches HEAD at the entry. `reset-to-commit` / `create-branch-here` resolve
  // their target from the reflog cursor when the reflog view is active (see
  // runtime handlers); the prompts here are identical to the history path.
  if (inputValue === 'Z' && isReflogActionTarget(state) && context.reflogCount) {
    return [action({ type: 'setPendingChoice', value: RESET_MODE_CHOICE })]
  }
  if (inputValue === 'B' && isReflogActionTarget(state) && context.reflogCount) {
    return [action({
      type: 'openInputPrompt',
      kind: 'create-branch-here',
      label: 'New branch name (at reflog entry)',
    })]
  }
  if (inputValue === 'c' && isReflogActionTarget(state) && context.reflogCount) {
    return [action({ type: 'setPendingConfirmation', value: 'checkout-reflog-entry' })]
  }

  // #0.71 — submodule maintenance on the cursored row. Scoped to the
  // submodules view so the bare keys don't collide with the sort `s` /
  // history `i` / stash+branch `u` bound on other views (the resolver
  // reaches those earlier only when their own view is active). init /
  // update / sync are all non-destructive, so they run straight through
  // to the workflow handler with no y-confirm.
  if (inputValue === 'i' && isSubmodulesActionTarget(state) && context.submoduleCount) {
    return [{ type: 'runWorkflowAction', id: 'submodule-init' }]
  }
  if (inputValue === 'u' && isSubmodulesActionTarget(state) && context.submoduleCount) {
    return [{ type: 'runWorkflowAction', id: 'submodule-update' }]
  }
  if (inputValue === 's' && isSubmodulesActionTarget(state) && context.submoduleCount) {
    return [{ type: 'runWorkflowAction', id: 'submodule-sync' }]
  }

  // #0.71 — remote management on the remotes view. Scoped per-view so
  // the bare keys don't collide elsewhere. `a` add and `e` set-url open
  // an input prompt (the prompt is the affirmative gate). `x` remove and
  // `p` prune are destructive (they drop refs), so they route through
  // the y-confirm path via setPendingConfirmation rather than running
  // directly. add works with zero remotes (it's how you create the
  // first); set-url / remove / prune require a cursored row.
  if (inputValue === 'a' && isRemotesActionTarget(state)) {
    return [action({
      type: 'openInputPrompt',
      kind: 'add-remote',
      label: 'Add remote — name url (e.g. upstream https://example.com/up.git)',
    })]
  }
  if (inputValue === 'e' && isRemotesActionTarget(state) && context.remoteCount) {
    return [action({
      type: 'openInputPrompt',
      kind: 'set-remote-url',
      label: `New URL for ${context.remoteSelectedName || 'remote'}`,
    })]
  }
  if (inputValue === 'x' && isRemotesActionTarget(state) && context.remoteCount) {
    return [action({ type: 'setPendingConfirmation', value: 'remote-remove' })]
  }
  if (inputValue === 'p' && isRemotesActionTarget(state) && context.remoteCount) {
    return [action({ type: 'setPendingConfirmation', value: 'remote-prune' })]
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
    // Entity arms run BEFORE the history fallback (#1388): from the
    // workstation's default history view with the sidebar focused,
    // the history branch used to always win, so `y` on a cursored
    // sidebar branch copied the history commit instead. The resolver
    // mirrors this precedence (sidebar entity wins over activeView).
    if (isBranchActionTarget(state) && context.branchCount) {
      return [{ type: 'yankFromActiveView' }]
    }
    if (isTagActionTarget(state) && context.tagCount) {
      return [{ type: 'yankFromActiveView' }]
    }
    if (isStashActionTarget(state) && context.stashCount && context.stashSelectedRef) {
      return [{ type: 'yankFromActiveView' }]
    }
    if (state.activeView === 'history' && state.filteredCommits.length > 0) {
      return [{ type: 'yankFromActiveView', short }]
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
    // #0.71 — remotes view: y yanks the cursored remote's fetch URL so
    // the user can paste it into a clone / config command. Y is a no-op
    // (no compact alternate identifier worth a second key).
    if (isRemotesActionTarget(state) && context.remoteCount) {
      return [{ type: 'yankFromActiveView' }]
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

  // Gated off while the GROUP HEADER row is highlighted: the file cursor
  // still points at the group's first file, so Space used to stage (and
  // `z` below offered to revert) a file the visible cursor wasn't on.
  if (
    inputValue === ' ' &&
    state.activeView === 'status' &&
    context.worktreeFileCount &&
    !state.statusGroupHeaderFocused
  ) {
    return [{ type: 'toggleSelectedFileStage' }]
  }

  // `A` — stage everything (git add -A); `+` — stage by typed pathspec.
  // Both available from the status AND compose views so you can stage
  // without leaving the message editor.
  if (inputValue === 'A' && (state.activeView === 'status' || state.activeView === 'compose')) {
    return [{ type: 'runWorkflowAction', id: 'stage-all' }]
  }
  // #1350 — `a` on compose amends the staged changes into HEAD instead
  // of creating a new commit ("amend instead of commit"). y-confirmed:
  // it rewrites the head commit. Compose only — `a` means stage-file on
  // status/diff and apply on stashes (see the KEYMAP overload table).
  if (inputValue === 'a' && state.activeView === 'compose' && !key.ctrl && !key.meta) {
    return [action({ type: 'setPendingConfirmation', value: 'amend-head' })]
  }
  if (inputValue === '+' && (state.activeView === 'status' || state.activeView === 'compose')) {
    return [action({
      type: 'openInputPrompt',
      kind: 'stage-pathspec',
      label: 'Stage pathspec (e.g. `.`, `src/`, `*.ts`, or a space-separated list)',
    })]
  }

  // ── Line-level staging (#1358) ──────────────────────────────────────
  // `v` anchors a visual selection at the current scroll line; j/k then
  // extend it (the "cursor" on the staging diff IS the viewport top,
  // same as the current-hunk derivation). While a selection is active,
  // Space stages exactly those lines and `z` offers to discard them;
  // `v`/Esc clears. The whole-hunk semantics below are untouched when no
  // selection is active.
  if (inputValue === 'v' && isWorktreeDiffTarget(state) && context.worktreeHunkOffsets?.length) {
    return [action({
      type: 'setDiffLineSelectAnchor',
      value: state.diffLineSelectAnchor === undefined ? state.worktreeDiffOffset : undefined,
    })]
  }
  if (
    inputValue === ' ' &&
    isWorktreeDiffTarget(state) &&
    state.diffLineSelectAnchor !== undefined
  ) {
    return [{ type: 'stageSelectedLines' }]
  }
  if (
    inputValue === 'z' &&
    isWorktreeDiffTarget(state) &&
    state.diffLineSelectAnchor !== undefined
  ) {
    return [action({ type: 'setPendingConfirmation', value: 'discard-lines' })]
  }

  if (inputValue === ' ' && isWorktreeDiffTarget(state) && context.worktreeHunkOffsets?.length) {
    return [{ type: 'toggleSelectedHunkStage' }]
  }

  // Worktree diff with no hunks (a new/untracked file) — `space` stages
  // the whole file, since there's nothing to partial-stage.
  if (
    inputValue === ' ' &&
    isWorktreeDiffTarget(state) &&
    !context.worktreeHunkOffsets?.length
  ) {
    return [{ type: 'toggleSelectedFileStage' }]
  }

  // `a` stages/unstages the WHOLE current file from the staging diff —
  // an escape hatch out of hunk-by-hunk back to all-or-nothing.
  if (inputValue === 'a' && isWorktreeDiffTarget(state)) {
    return [{ type: 'toggleSelectedFileStage' }]
  }

  if (
    inputValue === 'z' &&
    state.activeView === 'status' &&
    context.worktreeFileCount &&
    !state.statusGroupHeaderFocused
  ) {
    return [action({ type: 'setPendingConfirmation', value: 'revert-file' })]
  }

  if (inputValue === 'z' && isWorktreeDiffTarget(state) && context.worktreeHunkOffsets?.length) {
    return [action({ type: 'setPendingConfirmation', value: 'revert-hunk' })]
  }

  // #1361 — global undo (lazygit's `z` safety blanket), gated to fire only
  // when none of the more specific `z` handlers above claimed it (discard
  // lines / revert file / revert hunk are all more targeted "undo this
  // one thing" actions on their own surfaces). `reflogUndoDescription` is
  // only set when the runtime found a reflog tip to undo (#1361), so this
  // is a no-op in an empty repo or before the reflog has loaded.
  if (inputValue === 'z' && context.reflogUndoDescription) {
    return [action({
      type: 'setPendingConfirmation',
      value: 'global-undo',
      payload: context.reflogUndoDescription,
    })]
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
    return commitOrComposeEvents(state)
  }

  // Context-sensitive per-branch variants of F / U / P. When the
  // user has the branches sidebar / view focused with at least one
  // branch, F / U / P should act on the cursored row, not on the
  // current branch. This intercept fires BEFORE the generic
  // workflow-by-key lookup below so the global *-current-branch
  // variants don't shadow the contextual ones.
  //
  // Outside the branches context, the generic lookup runs and the
  // F / U / P keys hit the global `fetch-remotes` / `pull-current-branch`
  // / `push-current-branch` workflows as before.
  if (isBranchActionTarget(state) && context.branchCount) {
    if (inputValue === 'F') {
      return [{ type: 'runWorkflowAction', id: 'fetch-selected-branch' }]
    }
    if (inputValue === 'U') {
      return [{ type: 'runWorkflowAction', id: 'pull-selected-branch' }]
    }
    if (inputValue === 'P') {
      return [{ type: 'runWorkflowAction', id: 'push-selected-branch' }]
    }
  }

  const workflowAction = getLogInkWorkflowActionByKey(inputValue)

  // The registry fall-through must respect the per-view allowlist:
  // `C` on every opted-in view already matched `isCreatePrView` above,
  // so reaching here means the active view (rebase, blame,
  // file-history) deliberately did NOT opt in — firing the workflow
  // anyway reintroduced exactly the hazard the allowlist exists to
  // remove (a PR-creation flow launching mid-rebase-plan).
  if (workflowAction?.id === 'create-pr' && !isCreatePrView(state.activeView)) {
    return []
  }

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
