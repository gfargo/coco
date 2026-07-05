import { GitLogCommitRow, GitLogRow, getCommitRows } from '../../commands/log/data'
import { hashesMatchAny } from '../../git/hashes'
import type { RebasePlanRow, RebaseTodoAction } from '../../git/rebasePlanActions'
import type { ConflictRegion } from '../../git/conflictRegionActions'
import { getLogInkThemePresets, type LogInkThemePreset } from '../chrome/theme'
import {
    CommitComposeAction,
    CommitComposeState,
    applyCommitComposeAction,
    createCommitComposeState,
} from '../../commands/log/commitCompose'
import type { CommitSplitPlan, CommitSplitPlanContext } from '../../commands/commit/split'
import {
  cycleIssueFilterPreset,
  cyclePullRequestFilterPreset,
  type IssueFilterPreset,
  type PullRequestFilterPreset,
} from '../../git/triageFilterPresets'
import { PromotedSelectionsSnapshot } from '../chrome/selectionRectify'
import {
    BranchSortMode,
    DEFAULT_BRANCH_SORT_MODE,
    DEFAULT_TAG_SORT_MODE,
    TagSortMode,
    cycleBranchSort,
    cycleTagSort,
} from '../chrome/sorting'

export type LogInkFocus = 'sidebar' | 'commits' | 'detail'

export type LogInkSidebarTab = 'status' | 'branches' | 'tags' | 'stashes' | 'worktrees'
export type LogInkView = 'history' | 'status' | 'diff' | 'compose' | 'branches' | 'tags' | 'stash' | 'worktrees' | 'pull-request' | 'pull-request-triage' | 'issues' | 'conflicts' | 'reflog' | 'bisect' | 'changelog' | 'submodules' | 'remotes' | 'blame' | 'file-history' | 'rebase'
export type LogInkMutationConfirmation = 'revert-file' | 'revert-hunk' | 'discard-lines' | 'discard-draft'

/**
 * Kinds of list item that can carry an inline pending-spinner while an
 * async action runs against them. Each maps to a surface + a stable
 * per-row id used by `pendingItemAction`.
 */
export type LogInkListItemKind = 'branch' | 'tag' | 'stash' | 'worktree' | 'pull-request'

/**
 * Which async action is in flight on the pending row. The inline
 * spinner is identical across actions; the tag is carried so future
 * code (and tests) can distinguish a delete-in-flight from a
 * checkout-in-flight without a second piece of state.
 */
export type LogInkPendingActionKind = 'delete' | 'checkout'

/**
 * One in-flight action against a specific list-item row. Keyed by
 * `kind` + a stable id so it can't accidentally match a same-named row
 * in a different list rendering at the same time.
 */
export type LogInkPendingItemAction = {
  kind: LogInkListItemKind
  id: string
  action: LogInkPendingActionKind
}

/**
 * One selectable answer in a `LogInkChoicePrompt` (#1181). The user
 * presses `key` to pick it. An option either runs a workflow
 * (`workflowId`, routed through the runtime's workflow runner) or fires
 * a built-in `intent` handled directly in the input layer — the latter
 * for pure navigation (e.g. switching into a worktree) that must not go
 * through the workflow runner's post-action git/context refresh.
 */
export type LogInkChoiceOption = {
  key: string
  label: string
  destructive?: boolean
  workflowId?: string
  /**
   * Optional payload forwarded to `runWorkflowAction(workflowId,
   * payload)` (#1351) — lets one workflow id serve several options
   * (reset soft/mixed/hard, merge strategy merge/squash/rebase).
   */
  payload?: string
  /**
   * `switch-worktree` opens the conflicting worktree as a nested repo
   * frame (#1175); `open-conflicts` pushes the conflicts view (#1360).
   * Both are pure navigation and bypass the workflow runner.
   */
  intent?: 'switch-worktree' | 'open-conflicts'
}

/**
 * A multi-option prompt — the n-way generalization of the y/n
 * confirmation. Rendered by `renderChoicePanel`; resolved in the input
 * layer by matching a keypress against `options[].key` (with `n` / `Esc`
 * to cancel).
 */
export type LogInkChoicePrompt = {
  id: string
  title: string
  warning?: string
  options: LogInkChoiceOption[]
  /**
   * When true, dismissing the prompt (n / Esc) leaves the current
   * status line untouched instead of overwriting it with "cancelled".
   * Used by recovery prompts raised ON TOP of a sticky error status
   * (#1360) — declining the recovery must keep git's raw error visible,
   * because the error is still the truth about what happened.
   */
  keepStatusOnDismiss?: boolean
}

/**
 * True when `pending` (a `state.pendingItemAction`) targets this exact
 * row. Action-agnostic on purpose — every surface + the sidebar render
 * the same spinner whether the row is being deleted or checked out, so
 * the spinner-swap test stays identical everywhere. Takes the field
 * value (not the whole state) so it can live next to the type without a
 * forward reference.
 */
export function isPendingItemAction(
  pending: LogInkPendingItemAction | undefined,
  kind: LogInkListItemKind,
  id: string
): boolean {
  return pending?.kind === kind && pending.id === id
}

/**
 * One level in the nested-repo navigation stack (#931). Pushing a
 * frame is the mental equivalent of spawning another `coco ui`
 * instance scoped to a submodule's working directory; popping
 * restores the parent's prior state.
 *
 * v1 of the foundation (this type) ships with every state always
 * carrying a single root frame. Push / pop semantics, the runtime
 * parallel structure that holds the per-frame `SimpleGit` + loaded
 * context, and the breadcrumb chrome land in subsequent PRs.
 *
 * Fields here are pure data (label, optional return-state snapshot,
 * optional range filter the user entered with). Live runtime
 * objects (the bound `SimpleGit`, the loaded `LogInkContext`) live
 * alongside the view model in component state so the reducer can
 * stay pure.
 */
export type LogInkRepoFrame = {
  /** Display label — root repo name, or for nested frames the submodule's name from .gitmodules. */
  label: string
  /**
   * Snapshot of the parent's view position at push time, so the
   * pop can land the user back where they came from (same view,
   * cursor, filter). Undefined on the root frame.
   */
  parentReturn?: LogInkRepoFrameReturn
  /**
   * For frames pushed from a commit-diff: the `(oldPin, newPin)`
   * range the user was inspecting. Drives the default landing view
   * (history scoped to that range) and the breadcrumb hint so the
   * user remembers what they were looking at. Undefined when
   * entered from the dedicated submodules view (`gM`).
   */
  entryRange?: LogInkRepoFrameEntryRange
  /**
   * Absolute working-directory path the frame binds against. Drives
   * the runtime's `SimpleGit` factory (PR 2c) — nested frames bind a
   * fresh `simpleGit(workdir)`; the root frame's workdir is the cwd
   * `coco ui` was launched from. Optional only for back-compat with
   * states created before this field landed (notably tests that
   * direct-construct frames); production code paths always set it.
   */
  workdir?: string
}

/**
 * `(oldPin, newPin)` sha pair captured at push time from a commit
 * diff. Extracted as its own type so action payloads, the runtime's
 * parallel structure, and any future helpers can refer to one shape
 * instead of re-declaring the inline record.
 */
export type LogInkRepoFrameEntryRange = {
  oldSha: string
  newSha: string
}

export type LogInkRepoFrameReturn = {
  activeView: LogInkView
  /**
   * The parent's full view stack at push time. Restoring only
   * `[activeView]` stranded the user when the drill-in happened from a
   * pushed view (commit diff): they popped back onto a one-element
   * 'diff' stack where Esc and `<` were both dead. Optional for
   * back-compat with states captured before the field landed — pop
   * falls back to `[activeView]`.
   */
  viewStack?: LogInkView[]
  /**
   * Diff identity at push time. `withPushedView` inside the submodule
   * clears these on the shared state, so without an explicit capture a
   * pop back onto a commit diff rendered source-less (wrong key
   * handling, staging semantics on a read-only diff).
   */
  diffSource?: LogInkDiffSource
  stashDiffRef?: string
  prDiffNumber?: number
  compareHead?: LogInkCompareRef
  selectedIndex: number
  selectedFileIndex: number
  selectedSubmoduleIndex: number
  filter: string
  /**
   * Sidebar tab + sort preferences captured at push time (#995). Today
   * these live as global fields on `LogInkState`; per-issue, they should
   * snap back to the parent's values on pop instead of bleeding the
   * submodule's choice across the boundary. The corresponding fields on
   * `LogInkState` continue to carry the *active* frame's values — push
   * just records the parent's so pop can restore them. Persistence
   * (sidebar tab to disk; sort modes in-memory only) is unchanged: the
   * existing per-frame `git`-keyed load effect already restores any
   * submodule-specific saved tab when the frame becomes active.
   */
  sidebarTab: LogInkSidebarTab
  userSidebarTab: LogInkSidebarTab
  branchSort: BranchSortMode
  tagSort: TagSortMode
  /**
   * Remaining per-repo state captured at push time (#1343). Each of
   * these is only meaningful against the repo that produced it: a
   * compare base marked in the parent must not become the diff base
   * inside a submodule, a blame / file-history path from the parent
   * must not hydrate against the submodule's git, the branch-keyed
   * changelog cache would serve the parent's changelog for a same-named
   * submodule branch, and the per-list cursors would land on arbitrary
   * rows. Push clears them on the live state; pop restores the
   * parent's. All optional for back-compat with states captured before
   * the fields landed.
   */
  compareBase?: LogInkCompareRef
  blamePath?: string
  fileHistoryPath?: string
  changelogCache?: { [branch: string]: ChangelogCacheEntry }
  selectedWorktreeFileIndex?: number
  selectedBranchIndex?: number
  selectedTagIndex?: number
  selectedStashIndex?: number
  selectedWorktreeListIndex?: number
  selectedConflictFileIndex?: number
  selectedReflogIndex?: number
  selectedRemoteIndex?: number
  selectedBlameIndex?: number
  selectedFileHistoryIndex?: number
  selectedIssueIndex?: number
  selectedPullRequestTriageIndex?: number
}
/**
 * Tracks which kind of diff the user pushed into. `commit` means they
 * came from history → Enter on a commit (read-only commit-diff explore
 * mode). `worktree` means they came from status → Enter on a file
 * (stage / hunk / revert mode). The renderer routes the inspector and
 * input handlers off this field so a dirty worktree can't bleed staging
 * UI into a commit-diff view.
 */
export type LogInkDiffSource = 'commit' | 'worktree' | 'stash' | 'compare' | 'pr'

/**
 * A ref in the compare-two-refs flow (#779). `kind` is captured from
 * the source view (branches / tags / history) so the surface can
 * label the diff header appropriately. `ref` is the git-resolvable
 * form passed straight to `git diff`. `label` is the display string
 * — usually equal to `ref` for branches/tags, or `<shortHash> <subject>`
 * for commits.
 */
export type LogInkCompareRefKind = 'branch' | 'tag' | 'commit'
export type LogInkCompareRef = {
  kind: LogInkCompareRefKind
  ref: string
  label: string
}
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
  bootLoading?: boolean
  /**
   * Display label for the root repo frame (#931). Surfaces in the
   * breadcrumb chrome once it lands and is forwarded into the
   * persistence layer when keys need to be repo-qualified. Defaults
   * to 'root' when omitted; CLI callers pass the basename of the
   * cwd or the package name.
   */
  repoLabel?: string
  /**
   * Absolute working-directory path for the root frame (#931). The
   * runtime layer reads it to know which `SimpleGit` instance backs
   * the root frame. Optional only so back-compat callers (tests
   * direct-constructing state) don't have to thread it through.
   */
  repoWorkdir?: string
  /**
   * Override the initial graph mode. Defaults to `true` (full
   * multi-ref graph) since 0.54.x — tests that need the compact
   * single-branch view pass `fullGraph: false` here rather than
   * relying on the global default (which has moved before and may
   * move again).
   */
  fullGraph?: boolean
}

/** Kind of remote network operation currently in flight. */
export type RemoteOpKind = 'fetch' | 'pull' | 'push'

/**
 * Describes an in-flight remote operation so the history surface can
 * render a full-screen loader while it runs. `label` is the human
 * phrase shown under the spinner (e.g. "Fetching all remotes…").
 */
export type RemoteOpState = {
  kind: RemoteOpKind
  label: string
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
  /**
   * How many commits of the MAIN `git log` ordering have been fetched
   * (#1337). This — not `commits.length` — is the `skip` offset for the
   * next load-more page: anchored context loads (`loadCommitContext`)
   * merge rows that are NOT a prefix of the main ordering, so counting
   * every loaded commit overshoots the offset and silently skips the
   * commits ranked in the gap. Counted pre-dedup (skip is a position in
   * git's output, not in our merged list). Reset by `replaceRows`,
   * advanced by `appendRows` only when the append is a main-ordering
   * page.
   */
  mainHistoryCommitCount: number
  selectedIndex: number
  selectedFileIndex: number
  selectedWorktreeFileIndex: number
  /**
   * Cursor positions for the promoted top-level views (branches/tags/stash).
   * Persisted on the root state so navigating away and back keeps the user's
   * place in each list.
   */
  selectedBranchIndex: number
  selectedTagIndex: number
  selectedStashIndex: number
  selectedWorktreeListIndex: number
  selectedConflictFileIndex: number
  /**
   * Cursor for the promoted reflog view (#781). Lives on the root state
   * for the same reason as the other selected* indices: navigating away
   * and back should keep the user's place in the list.
   */
  selectedReflogIndex: number
  /**
   * Cursor for the dedicated submodules view (#932). Same lifecycle as
   * the other promoted-view indices — preserved across navigations so
   * the user can drill out and back into a submodule without losing
   * their place.
   */
  selectedSubmoduleIndex: number
  /**
   * Cursor for the dedicated remotes view (#0.71). Same lifecycle as
   * the other promoted-view indices — preserved across navigations so
   * the user keeps their place in the list when they drill out and
   * back.
   */
  selectedRemoteIndex: number
  /**
   * Cursor for the on-demand blame view (#0.71). Indexes into the
   * blamed file's `BlameLine[]`; windowed-rendered around this index so
   * large files stay responsive. Reset to 0 each time a fresh path is
   * opened (`navigateOpenBlameForPath`) so blame always opens at the
   * top of the file.
   */
  selectedBlameIndex: number
  /**
   * Repo-relative path the blame view is currently showing (#0.71).
   * Unlike the boot-loaded overview slices, blame is keyed by path and
   * hydrated on demand: the runtime reads this path, looks it up in the
   * `blameByPath` cache, and fetches it (debounced) on a cache miss.
   * Undefined when the blame view has never been opened.
   */
  blamePath?: string
  /**
   * Cursor for the file-history view (#COCO-14). Indexes into the
   * `FileHistoryCommit[]` for the active path; windowed-rendered around
   * this index so long histories stay responsive. Reset to 0 each time a
   * fresh path is opened (`navigateOpenFileHistoryForPath`); preserved
   * when re-opening the same path (cached result + user's place).
   */
  selectedFileHistoryIndex: number
  /**
   * Repo-relative path the file-history view is currently showing (#COCO-14).
   * Hydrated on demand via `git log --follow -- <path>` into
   * `fileHistoryByPath`. Undefined when the view has never been opened.
   */
  fileHistoryPath?: string
  /**
   * Cursor for the issues triage view (#882). Same lifecycle as the
   * other promoted-view indices — preserved across navigations so
   * the user can drill into an issue's preview and back without
   * losing their place in the list.
   */
  selectedIssueIndex: number
  /**
   * Cursor for the pull-request triage view (#882). Distinct from
   * the existing single-PR action panel (`pull-request`); this index
   * drives the multi-PR list view (`pull-request-triage`).
   */
  selectedPullRequestTriageIndex: number
  /**
   * Canned filter presets for the triage views (#882 phase 6).
   * `f` on each view cycles through the matching preset list (see
   * `triageFilterPresets.ts`); the active preset drives both the
   * data fetcher's filter object and the surface header's label.
   * Persisted on root state so navigating away and back keeps the
   * user's chosen lens.
   */
  selectedIssueFilter: IssueFilterPreset
  selectedPullRequestFilter: PullRequestFilterPreset
  /**
   * Nested-repo navigation stack (#931). Always at least one entry
   * — the root frame for the repo `coco ui` was launched against.
   * Length > 1 means the user has drilled into a submodule (or
   * deeper). The top of the stack is the active frame; readers
   * route the `SimpleGit` instance and the `LogInkContext` from
   * the runtime-side parallel structure keyed on this stack's
   * depth.
   */
  repoStack: LogInkRepoFrame[]
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
  /**
   * Visual line-select anchor on the staging diff (#1358). Set by `v`;
   * the selection is [min(anchor, worktreeDiffOffset), max(...)]. Undefined
   * when no selection is active. Cleared whenever the diff offset resets
   * (view switches, file changes) so a stale range can't be staged.
   */
  diffLineSelectAnchor?: number
  filter: string
  filterMode: boolean
  fullGraph: boolean
  showHelp: boolean
  /**
   * Row offset into the help overlay's content. Driven by j/k/arrow
   * keys while `showHelp` is true. Reset to 0 whenever the overlay is
   * closed so reopening always starts at the top. Bound-checked at
   * render time against the visible window; no `helpContentRows`
   * field — the rendered panel does the clamp.
   */
  helpScrollOffset: number
  /**
   * Type-to-filter query for the help overlay (#1355). Narrows the
   * 30+ binding rows by key / label / description. Cleared whenever
   * the overlay opens or closes.
   */
  helpFilter: string
  /**
   * True while the help overlay's filter input owns the keyboard
   * (opened with `/`). While set, printable keys append to
   * `helpFilter` instead of scrolling; Enter keeps the filter and
   * returns to scroll keys; Esc clears it.
   */
  helpFilterMode: boolean
  /**
   * Which-key view-keys strip (#1137). When true, the detail panel shows a
   * compact list of the single-key actions available in the current view,
   * sourced from `LOG_INK_KEY_BINDINGS`. Opened by the `g?` chord; the
   * per-view counterpart to the `g`-chord continuation overlay. Mutually
   * exclusive with the other overlays.
   */
  showViewKeys: boolean
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
  /**
   * Theme picker (`gC`) interaction state. `themePickerFilter` is the
   * typed substring query; `themePickerIndex` is a cursor into the
   * filtered preset list. While open, the workstation live-previews the
   * cursored theme (wired in `app.ts`).
   */
  showThemePicker: boolean
  themePickerFilter: string
  themePickerIndex: number
  /**
   * "Add to .gitignore" quick-pick (`i` on the status view). When
   * defined, the overlay is open over the cursored worktree file:
   * `file` is the repo-relative path the pattern options are derived
   * from, `index` is the cursor into that derived option list.
   */
  gitignorePicker?: { file: string; index: number }
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
  /**
   * Set when a `checkout-branch` was rejected because the branch is
   * already checked out in another worktree (#1175). Carries the branch
   * the user tried to check out and the worktree holding it (+ whether
   * that worktree is dirty) so the conflict prompt can offer to switch
   * into it or remove it. Read by the conflict-resolution workflow
   * handlers; surfaced via a `pendingChoice` (see below).
   */
  worktreeCheckoutConflict?: { branch: string; worktreePath: string; dirty: boolean }
  /**
   * Multi-option prompt (#1181). Generalizes the y/n confirmation for
   * situations with more than two answers — the user picks an option by
   * its key. Each option either runs a workflow (`workflowId`) or fires
   * a built-in `intent` handled directly in the input layer (used for
   * pure navigation like switching worktrees, which must not route
   * through the workflow runner's post-action context refresh). `n` /
   * `Esc` cancels.
   */
  pendingChoice?: LogInkChoicePrompt
  pendingKey?: string
  /**
   * The list item whose deletion is currently in flight, if any. Set by
   * the runtime workflow runner the moment a delete starts (after the
   * y-confirm) and cleared once the command resolves and the list
   * refreshes. While set, that row renders an inline pending spinner in
   * place of its status icon (or appended, for rows without one) — the
   * generalized "this item is being deleted" affordance. Keyed by
   * `kind` + a stable id (`branch.shortName`, `tag.name`, `stash.ref`,
   * `worktree.path`) so it can't accidentally match a same-named row in
   * a different list rendering at the same time.
   */
  pendingItemAction?: LogInkPendingItemAction
  focus: LogInkFocus
  /**
   * Set while the user is "peeking" the sidebar (#1135 v2) — a momentary
   * single-pane glance that snaps back to where they were. Holds the
   * focus to restore when the peek ends; `undefined` when not peeking.
   * Peek is just "focus the sidebar with a return ticket": opening sets
   * `focus = 'sidebar'` and stashes the prior focus here; the toggle key
   * or Esc restores it. Any explicit focus change (Tab) or view drill-in
   * cancels the ticket so the user isn't snapped back unexpectedly.
   * Single-pane only — above the breakpoint all panes are already visible.
   */
  peekReturnFocus?: LogInkFocus
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
  /**
   * Status surface counterpart of `sidebarHeaderFocused`: when true,
   * the cursor sits on the active group's *header row* (e.g.
   * "Unstaged (3)") rather than on a file inside the group. Pressing
   * Enter fires the group-level batch action (stage-all / unstage-all)
   * instead of opening a per-file diff.
   *
   * Triggered by ↑ at the first file of the active group; cleared by
   * ↓ (cursor re-enters the group's first file) or by ←/→ jumping to
   * a different group's first file. Resets whenever the status view
   * loses focus or its file selection moves so we never get stuck
   * "between" cursor states.
   */
  statusGroupHeaderFocused: boolean
  statusMessage?: string
  /**
   * Visual category for `statusMessage` — drives footer styling.
   *   - 'info'    (default) : info-color text + `ℹ ` glyph (or ASCII
   *                            `i`). Used for neutral status updates
   *                            that the user should notice but aren't
   *                            wins or failures.
   *   - 'error'              : danger-color (red) + bold + `✗ ` glyph.
   *                            Set explicitly by failure paths (LLM
   *                            errors, validator issues, etc.) so
   *                            users notice them.
   *   - 'warning'            : warning-color (yellow) + bold + `⚠ `
   *                            glyph (`!` in ASCII). Set by paths
   *                            that succeed but with caveats —
   *                            unupstreamed branch, dirty worktree
   *                            during sensitive ops, partial fetch.
   *   - 'success'            : success-color (green) + bold + `✓ `
   *                            glyph (`+` in ASCII). Set by ops that
   *                            mutate state successfully (commit
   *                            created, split applied, PR opened, …)
   *                            so the affirmative feedback stands out
   *                            from in-flight ops (which use accent /
   *                            cyan via the spinner).
   * Cleared alongside `statusMessage` when `setStatus` fires without
   * a `kind` (or with `kind: 'info'`).
   */
  statusKind?: 'info' | 'error' | 'success' | 'warning'
  /**
   * Transient loading flag for the status line. When true, the footer
   * prefixes the message with the shared spinner frame so users see
   * motion during sub-second LLM calls (create-PR body generation,
   * tag/PR fetches, etc.) that don't have a dedicated overlay.
   *
   * Set via `setStatus({ ..., loading: true })`; cleared on the next
   * `setStatus` without `loading: true` (or when the message is
   * cleared entirely).
   */
  statusLoading?: boolean
  /**
   * Set while the `C` keystroke's PR body draft is in flight (#881
   * phase 4). The input handler reads this to gate the Esc cancel
   * binding: pressing Esc while a draft is pending dispatches
   * `cancelPullRequestBodyDraft` (soft cancel — skip opening the
   * follow-up prompt) instead of falling through to the global Esc
   * handler. Cleared by the workflow callback in `finally`.
   */
  pendingPullRequestBodyDraft?: boolean
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
   * Pull-request number currently being inspected in the diff view
   * (#1363 — triage Enter → PR diff). Set by
   * `navigateOpenDiffForPullRequest`; cleared when the diff view is
   * popped or replaced, mirroring `stashDiffRef`.
   */
  prDiffNumber?: number
  /**
   * Compare-two-refs flow (#779). `compareBase` is set by `m` on a
   * branch / tag / history row; while it's defined, the footer shows
   * a "compare base: <label>" hint and `Enter` on a second ref opens
   * a compare diff instead of the row's normal action. `compareHead`
   * is set when the compare diff is active and identifies the right-
   * hand side of the comparison. Both clear when the diff view is
   * popped or replaced.
   */
  compareBase?: LogInkCompareRef
  compareHead?: LogInkCompareRef
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
  /**
   * Cursor index into the inspector's Actions list when the user has
   * the actions tab focused (#791 follow-up). Auto-clamped against
   * the current entity's action count by the reducer; reset to 0 on
   * tab switch / focus change so an action stale from a different
   * entity context never sits highlighted.
   */
  inspectorActionIndex: number
  /**
   * True while the runtime is fetching the initial commit log (#808).
   * Set when the TUI mounts with a `loadRows` deferred loader and
   * cleared once the loader returns. Drives the "Loading commits…"
   * placeholder in the history surface and the loading hint in the
   * top header chrome — without this flag, an empty `filteredCommits`
   * looks like "no commits found" rather than "still loading".
   */
  bootLoading: boolean
  /**
   * In-flight remote operation (fetch / pull / push). When defined,
   * the history surface swaps its commit list for a centered, animated
   * loader so the user gets a clear "talking to origin…" beat instead
   * of a frozen list that abruptly repaints once the network call
   * returns. Set by the workflow dispatcher before the git call and
   * cleared in a `finally` once the subsequent history/context refresh
   * has landed — so the loader hands straight off to the fresh rows.
   */
  remoteOp?: RemoteOpState
  /**
   * Split-plan overlay state (#907). When defined, the overlay is
   * open. Three phases:
   *   - 'loading'  : plan generation in flight, overlay shows a
   *                  spinner. plan + planContext are undefined.
   *   - 'ready'    : plan generated, overlay shows scrollable groups
   *                  for review. `y`/Enter applies, Esc cancels.
   *   - 'applying' : user accepted the plan, apply in flight. Overlay
   *                  shows "applying…" until the workflow returns.
   *
   * Cleared (set to undefined) on cancel or successful apply. Apply
   * failures keep the overlay open in 'ready' so the user can retry
   * or back out — the status line carries the error message.
   */
  splitPlan?: SplitPlanState
  /**
   * Changelog view (full-screen surface). `status` drives what the
   * panel renders:
   *   - 'idle'    : view pushed but no content yet (transient — flips
   *                 immediately to 'loading' or 'ready'-from-cache)
   *   - 'loading' : LLM generation in flight
   *   - 'ready'   : `text` is populated and renderable
   *   - 'error'   : generation failed; `error` carries the message
   *
   * `branch` and `baseLabel` are the metadata that drove generation —
   * surfaced in the panel header so the user knows what they're looking
   * at. `scrollOffset` is view-local UI state (line offset into `text`)
   * the same way `diffPreviewOffset` works for the diff view.
   */
  changelogView: ChangelogViewState
  /**
   * Per-branch cache of generated changelogs. Keyed by branch name so
   * switching branches naturally produces a fresh generation; pressing
   * `r` inside the view forces a regenerate even on the same branch.
   * Each entry is small (a few KB of text) and there's at most one per
   * branch, so memory pressure is negligible — the cache lives in
   * state, not on disk, and clears with the workstation session.
   */
  changelogCache: { [branch: string]: ChangelogCacheEntry }
  /**
   * Hashes of commits the workstation just created (via split-apply
   * or regular commit). The history surface renders these with a
   * visible "new" marker so the user can see at a glance which rows
   * landed from the operation they just confirmed. Auto-cleared by
   * the runtime ~5s after marking — long enough to land the message,
   * short enough not to litter the surface across later operations.
   *
   * Stored as a flat string set for fast membership checks inside
   * the row renderer (called once per visible commit row).
   */
  recentCommitHashes?: { hashes: string[]; markedAt: number }
  /**
   * In-TUI bisect start wizard (#879 item 4). Two-step pick:
   *   - 'bad'  : empty-state entered → user is picking the BAD commit
   *              from history. On Enter, capture the sha and advance.
   *   - 'good' : bad captured (held in `bisectPickPendingBad`) → user
   *              is picking the GOOD commit. On Enter, fire
   *              `bisect-start-from-history` with both shas.
   *
   * Esc clears the mode + pending sha. The bisect view's `s` is
   * context-overloaded: when bisect is active it skips; when inactive
   * it enters the wizard. Cleared when bisect starts successfully so
   * the next session begins from a clean slate.
   */
  bisectPickMode?: 'bad' | 'good'
  bisectPickPendingBad?: string
  /**
   * The in-TUI interactive rebase plan (#1359): the todo rows for
   * `<base>^..HEAD` plus the cursor. Present only while the rebase view
   * is open; cleared on pop / lateral navigation so a stale plan can
   * never execute against a moved HEAD.
   */
  rebasePlan?: LogInkRebasePlan
  /**
   * AI conflict resolution session (#1369): per-region proposals for
   * ONE conflicted file, held between generation and the explicit
   * per-region accept/edit/reject. Cleared on navigation away from the
   * conflicts view (a stale proposal must never write into a file that
   * moved underneath it) and when the file is fully resolved.
   */
  conflictResolution?: LogInkConflictResolutionState
}

export type LogInkRebasePlan = {
  rows: RebasePlanRow[]
  selectedIndex: number
}

export type LogInkConflictProposal = {
  regionIndex: number
  resolution: string
  rationale: string
  status: 'pending' | 'accepted' | 'rejected'
  /**
   * Region snapshot at generation time — the display source for the
   * ours/theirs blocks AND the content-matched identity the apply path
   * uses (line numbers shift as earlier regions are accepted).
   */
  region: ConflictRegion
}

export type LogInkConflictResolutionState = {
  path: string
  status: 'loading' | 'ready' | 'error'
  error?: string
  proposals: LogInkConflictProposal[]
  selectedIndex: number
}

export type ChangelogViewStatus = 'idle' | 'loading' | 'ready' | 'error'

export type ChangelogViewState = {
  status: ChangelogViewStatus
  text?: string
  error?: string
  branch?: string
  baseLabel?: string
  scrollOffset: number
}

export type ChangelogCacheEntry = {
  text: string
  baseLabel: string
  generatedAt: number
}

export const DEFAULT_CHANGELOG_VIEW_STATE: ChangelogViewState = {
  status: 'idle',
  scrollOffset: 0,
}

/**
 * Split-plan overlay state. Held on root state (not on a per-view
 * surface) because the overlay can be triggered from compose and
 * dismissed back to whatever view was active beneath. The plan +
 * context come from `runCommitSplitPlanWorkflow`; the workstation
 * holds them between preview and apply so the executed split matches
 * exactly what was previewed.
 */
export type SplitPlanState = {
  status: 'loading' | 'ready' | 'applying'
  plan?: CommitSplitPlan
  planContext?: CommitSplitPlanContext
  scrollOffset: number
  error?: string
  /**
   * Set when the planner exhausted its retry budget and returned the
   * single-group fallback. Surfaces in the overlay header so the user
   * knows the plan they're previewing isn't a real LLM split, and in
   * the apply-time success message. Cleared when the user re-rolls
   * the planner.
   */
  fallback?: import('../../commands/commit/splitPlanGenerator').SplitPlanFallbackInfo
  /**
   * Set when a dedupe rescue silently dropped a file/hunk placement
   * the model had also put in an earlier group (#1462). Surfaces as a
   * warning banner in the overlay so a validation-clean plan doesn't
   * hide an auto-resolved placement from the user before they apply.
   */
  dedupeWarnings?: import('../../commands/commit/splitPlanValidation').DuplicateRescueNote[]
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
  | 'rename-stash'
  | 'stash-branch'
  | 'gitignore-pattern'
  | 'stage-pathspec'
  | 'reword-head'
  | 'pr-comment'
  | 'pr-request-changes'
  | 'create-pr'
  | 'bisect-run-command'
  | 'rebase-reword'
  // #0.71 — remotes view mutations. `add-remote` collects a single
  // `name url` line (space-separated, parsed in the submit handler);
  // `set-remote-url` collects just a URL applied to the cursored
  // remote. The prompt itself is the affirmative gate for both, so
  // neither routes through the y-confirm path.
  | 'add-remote'
  | 'set-remote-url'
  // #882 phase 4 — triage-view mutations. Distinct from the
  // single-PR `pr-comment` / `pr-request-changes` kinds above so
  // the submit handler routes to the by-number workflows (the
  // single-PR equivalents target the current branch's PR).
  | 'triage-issue-comment'
  | 'triage-issue-label'
  | 'triage-issue-assign'
  | 'triage-pr-comment'
  | 'triage-pr-label'
  | 'triage-pr-assign'
  // #882 phase 5 — destructive PR mutations on the triage view.
  // Prompts for the review body then forwards through the y-confirm
  // path, routed to the by-number workflow so the cursored PR (not
  // the current branch's) gets the action. (The merge-strategy
  // prompts became 1-key choice prompts in #1351.)
  | 'triage-pr-request-changes'

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
  | {
    type: 'appendRows'
    rows: GitLogRow[]
    /**
     * Commit count of this append as fetched from the MAIN `git log`
     * ordering (pre-dedup), when the append is a load-more page.
     * Omitted for anchored context loads, which must not advance the
     * pagination offset (#1337).
     */
    mainOrderingCount?: number
  }
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
  | { type: 'setStatusGroupHeaderFocused'; value: boolean }
  | { type: 'jumpToStatusGroup'; targetIndex: number }
  | { type: 'setInspectorTab'; value: LogInkInspectorTab }
  | { type: 'cycleInspectorTab'; delta: -1 | 1 }
  | { type: 'moveInspectorAction'; delta: number; actionCount: number }
  | { type: 'resetInspectorActionIndex' }
  | { type: 'setBootLoading'; value: boolean }
  | { type: 'setRemoteOp'; value: RemoteOpState | undefined }
  | { type: 'moveTag'; delta: number; count: number }
  | { type: 'moveStash'; delta: number; count: number }
  | { type: 'moveReflog'; delta: number; count: number }
  | { type: 'moveSubmodule'; delta: number; count: number }
  | { type: 'moveRemote'; delta: number; count: number }
  | { type: 'moveBlame'; delta: number; count: number }
  | { type: 'moveIssue'; delta: number; count: number }
  | { type: 'movePullRequestTriage'; delta: number; count: number }
  | { type: 'cycleIssueFilter' }
  | { type: 'cyclePullRequestTriageFilter' }
  | { type: 'moveWorktreeListEntry'; delta: number; count: number }
  | { type: 'moveConflictFile'; delta: number; count: number }
  | { type: 'moveToBottom' }
  | { type: 'moveToTop' }
  | { type: 'nextSidebarTab' }
  | { type: 'page'; delta: number }
  | { type: 'pageDetailPreview'; delta: number; previewLineCount: number }
  | { type: 'pageWorktreeDiff'; delta: number; lineCount: number; hunkOffsets?: number[] }
  | { type: 'previousSidebarTab' }
  | { type: 'setFilter'; value: string; promotedSelections?: PromotedSelectionsSnapshot }
  | { type: 'setActiveView'; value: LogInkView }
  | { type: 'pushView'; value: LogInkView }
  | { type: 'popView' }
  | { type: 'replaceView'; value: LogInkView }
  | { type: 'pushRepoFrame'; label: string; workdir?: string; entryRange?: LogInkRepoFrameEntryRange }
  | { type: 'popRepoFrame' }
  | { type: 'navigateHome' }
  | { type: 'returnFromCommit'; stillDirty: boolean }
  | { type: 'navigateOpenDiffForCommit'; sha: string; commitIndex: number; fileIndex?: number }
  | { type: 'navigateOpenDiffForWorktreeFile'; fileIndex: number }
  | { type: 'navigateOpenBlameForPath'; path: string }
  | { type: 'navigateOpenFileHistoryForPath'; path: string }
  | { type: 'moveFileHistory'; delta: number; count: number }
  | { type: 'navigateOpenDiffForStash'; ref: string; stashIndex?: number }
  | { type: 'navigateOpenDiffForPullRequest'; number: number; pullRequestIndex?: number }
  | { type: 'navigateOpenDiffForCompare'; base: LogInkCompareRef; head: LogInkCompareRef }
  | { type: 'setCompareBase'; value: LogInkCompareRef }
  | { type: 'clearCompareBase' }
  | { type: 'navigateOpenComposeForFile'; fileIndex: number }
  | { type: 'jumpWorktreeHunk'; delta: number; hunkOffsets: number[] }
  | { type: 'jumpCommitDiffHunk'; delta: number; hunkOffsets: number[] }
  | { type: 'focusPendingCommit' }
  | { type: 'unfocusPendingCommit' }
  | { type: 'setFocus'; value: LogInkFocus }
  | { type: 'togglePeek' }
  | { type: 'setPendingKey'; value?: string }
  | { type: 'setSidebarTab'; value: LogInkSidebarTab }
  | { type: 'restoreSidebarTab'; value: LogInkSidebarTab }
  | { type: 'setStatus'; value?: string; kind?: 'info' | 'error' | 'success' | 'warning'; loading?: boolean }
  | { type: 'setPendingPullRequestBodyDraft'; value: boolean }
  | { type: 'setWorkflowAction'; value?: string }
  | { type: 'setPendingConfirmation'; value?: string; payload?: string }
  | { type: 'setWorktreeCheckoutConflict'; value?: { branch: string; worktreePath: string; dirty: boolean } }
  | { type: 'setPendingChoice'; value?: LogInkChoicePrompt }
  | { type: 'setPendingMutationConfirmation'; value?: LogInkMutationConfirmation }
  | { type: 'setPendingItemAction'; value?: LogInkPendingItemAction }
  | { type: 'appendPaletteFilter'; value: string }
  | { type: 'backspacePaletteFilter' }
  | { type: 'clearPaletteFilter' }
  | { type: 'movePaletteSelection'; delta: number; commandCount: number }
  | { type: 'recordPaletteRecent'; value: string }
  | { type: 'toggleFilterMode' }
  | { type: 'toggleGraph' }
  | { type: 'toggleHelp' }
  | { type: 'scrollHelp'; delta: number }
  | { type: 'openHelpFilter' }
  | { type: 'appendHelpFilter'; value: string }
  | { type: 'backspaceHelpFilter' }
  | { type: 'commitHelpFilter' }
  | { type: 'clearHelpFilter' }
  | { type: 'toggleViewKeys' }
  | { type: 'toggleCommandPalette' }
  | { type: 'toggleThemePicker' }
  | { type: 'moveThemePicker'; delta: number; presetCount: number }
  | { type: 'appendThemePickerFilter'; value: string }
  | { type: 'backspaceThemePickerFilter' }
  | { type: 'clearThemePickerFilter' }
  | { type: 'openGitignorePicker'; file: string }
  | { type: 'closeGitignorePicker' }
  | { type: 'moveGitignorePicker'; delta: number; count: number }
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
  | { type: 'setChangelogLoading'; branch: string; baseLabel: string }
  | { type: 'setChangelogReady'; branch: string; baseLabel: string; text: string; generatedAt: number }
  | { type: 'setChangelogError'; branch: string; baseLabel: string; error: string }
  | { type: 'setChangelogText'; text: string; generatedAt: number }
  | { type: 'pageChangelog'; delta: number; lineCount: number }
  | { type: 'clearChangelogCache'; branch?: string }
  | { type: 'markRecentCommits'; hashes: string[]; markedAt: number }
  | { type: 'clearRecentCommits' }
  | { type: 'startSplitPlanLoad' }
  | {
      type: 'setSplitPlanReady'
      plan: CommitSplitPlan
      planContext: CommitSplitPlanContext
      fallback?: import('../../commands/commit/splitPlanGenerator').SplitPlanFallbackInfo
      dedupeWarnings?: import('../../commands/commit/splitPlanValidation').DuplicateRescueNote[]
    }
  | { type: 'setSplitPlanApplying' }
  | { type: 'setSplitPlanError'; error: string }
  | { type: 'pageSplitPlan'; delta: number; lineCount: number }
  | { type: 'clearSplitPlan' }
  | { type: 'setBisectPickMode'; mode: 'bad' | 'good'; pendingBad?: string }
  | { type: 'clearBisectPickMode' }
  | { type: 'openRebasePlan'; rows: RebasePlanRow[] }
  | { type: 'moveRebaseCursor'; delta: number }
  | { type: 'setRebaseAction'; action: RebaseTodoAction }
  | { type: 'moveRebaseRow'; delta: number }
  | { type: 'setRebaseRewordMessage'; message: string }
  | { type: 'clearRebasePlan' }
  | { type: 'setDiffLineSelectAnchor'; value?: number }
  | { type: 'setConflictResolutionLoading'; path: string }
  | {
    type: 'setConflictResolutionReady'
    path: string
    proposals: Array<Omit<LogInkConflictProposal, 'status'>>
  }
  | { type: 'setConflictResolutionError'; path: string; error: string }
  | { type: 'moveConflictProposal'; delta: number }
  | {
    type: 'setConflictProposalStatus'
    regionIndex: number
    status: 'accepted' | 'rejected'
    /** Replacement text when an $EDITOR edit changed the proposal before accept. */
    resolution?: string
  }
  | { type: 'clearConflictResolution' }

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
    return { ...state, peekReturnFocus: undefined, pendingKey: undefined }
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
    diffLineSelectAnchor: value === 'diff' ? state.diffLineSelectAnchor : undefined,
    diffSource: value === 'diff' ? state.diffSource : undefined,
    stashDiffRef: value === 'diff' ? state.stashDiffRef : undefined,
    prDiffNumber: value === 'diff' ? state.prDiffNumber : undefined,
    compareHead: value === 'diff' ? state.compareHead : undefined,
    pendingCommitFocused: value === 'history' ? state.pendingCommitFocused : false,
    statusGroupHeaderFocused: value === 'status' ? state.statusGroupHeaderFocused : false,
    // Changing the view is a deliberate destination — cancel any pending
    // peek return so the user isn't snapped back afterward.
    peekReturnFocus: undefined,
    pendingKey: undefined,
  }
}

function withPoppedView(state: LogInkState): LogInkState {
  if (state.viewStack.length <= 1) {
    return { ...state, peekReturnFocus: undefined, pendingKey: undefined }
  }

  const viewStack = state.viewStack.slice(0, -1)
  const next = topOfStack(viewStack)
  // #779 — compareBase is "cleared when the diff view is popped." We
  // detect that case by checking if the *previous* top was 'diff'.
  // The compare workflow ends when the user backs out of the compare
  // diff; on the next mark they re-set the base. Other view pops
  // preserve compareBase so the user can move between branches / tags /
  // history while hunting for a head ref.
  const wasOnDiff = state.activeView === 'diff'
  return {
    ...state,
    activeView: next,
    viewStack,
    // Restore the user's last explicit tab choice so popping out of
    // compose / status (which auto-switch the sidebar to Branches)
    // returns the user to whatever they actually had open before —
    // UNLESS we're popping INTO status/compose, where the same
    // auto-switch rule applies as on push (#1348): the Status tab next
    // to the status surface just duplicates the center pane.
    sidebarTab: next === 'status' || next === 'compose' ? 'branches' : state.userSidebarTab,
    worktreeDiffOffset: next === 'diff' ? state.worktreeDiffOffset : 0,
    diffSource: next === 'diff' ? state.diffSource : undefined,
    stashDiffRef: next === 'diff' ? state.stashDiffRef : undefined,
    prDiffNumber: next === 'diff' ? state.prDiffNumber : undefined,
    compareBase: wasOnDiff ? undefined : state.compareBase,
    compareHead: next === 'diff' ? state.compareHead : undefined,
    pendingCommitFocused: next === 'history' ? state.pendingCommitFocused : false,
    statusGroupHeaderFocused: next === 'status' ? state.statusGroupHeaderFocused : false,
    // Backing out is a deliberate navigation — cancel any peek return.
    peekReturnFocus: undefined,
    pendingKey: undefined,
  }
}

/**
 * Push a nested-repo frame onto `state.repoStack` (#931). Snapshots
 * the active view position into the new frame's `parentReturn` so a
 * subsequent pop lands the user back where they came from, then
 * resets the per-frame navigation state (active view, view stack,
 * row / file / submodule cursors, filter) so the nested frame opens
 * in a clean slate — the mental equivalent of a fresh `coco ui`
 * launched against the submodule's working dir.
 *
 * Sidebar tab + branch / tag sort are also captured into the return
 * snapshot (#995) so popping back restores the parent's choices
 * instead of letting the submodule's tab/sort bleed across the
 * boundary. The values on the *new* frame are left as-is (carried
 * over from the parent) — the load effect in app.ts re-reads
 * persistence keyed on the submodule's workdir and dispatches a
 * restore if the user has a submodule-specific saved preference.
 *
 * Other preferences (palette recents, inspector tab, diff view mode)
 * stay global by design — the user's preference shouldn't reset when
 * they cross a submodule boundary.
 *
 * Live runtime objects (`SimpleGit`, loaded `LogInkContext`) live
 * outside the reducer in `app.ts`'s parallel ref structure — this
 * helper only manages the pure view-model side of the push.
 */
function withPushedRepoFrame(
  state: LogInkState,
  payload: { label: string; workdir?: string; entryRange?: LogInkRepoFrameEntryRange }
): LogInkState {
  const newFrame: LogInkRepoFrame = {
    label: payload.label,
    workdir: payload.workdir,
    entryRange: payload.entryRange,
    parentReturn: {
      activeView: state.activeView,
      viewStack: [...state.viewStack],
      diffSource: state.diffSource,
      stashDiffRef: state.stashDiffRef,
      prDiffNumber: state.prDiffNumber,
      compareHead: state.compareHead,
      selectedIndex: state.selectedIndex,
      selectedFileIndex: state.selectedFileIndex,
      selectedSubmoduleIndex: state.selectedSubmoduleIndex,
      filter: state.filter,
      sidebarTab: state.sidebarTab,
      userSidebarTab: state.userSidebarTab,
      branchSort: state.branchSort,
      tagSort: state.tagSort,
      compareBase: state.compareBase,
      blamePath: state.blamePath,
      fileHistoryPath: state.fileHistoryPath,
      changelogCache: state.changelogCache,
      selectedWorktreeFileIndex: state.selectedWorktreeFileIndex,
      selectedBranchIndex: state.selectedBranchIndex,
      selectedTagIndex: state.selectedTagIndex,
      selectedStashIndex: state.selectedStashIndex,
      selectedWorktreeListIndex: state.selectedWorktreeListIndex,
      selectedConflictFileIndex: state.selectedConflictFileIndex,
      selectedReflogIndex: state.selectedReflogIndex,
      selectedRemoteIndex: state.selectedRemoteIndex,
      selectedBlameIndex: state.selectedBlameIndex,
      selectedFileHistoryIndex: state.selectedFileHistoryIndex,
      selectedIssueIndex: state.selectedIssueIndex,
      selectedPullRequestTriageIndex: state.selectedPullRequestTriageIndex,
    },
  }
  return {
    ...state,
    repoStack: [...state.repoStack, newFrame],
    activeView: 'history',
    viewStack: ['history'],
    selectedIndex: 0,
    selectedFileIndex: 0,
    selectedSubmoduleIndex: 0,
    filter: '',
    filterMode: false,
    pendingCommitFocused: false,
    pendingKey: undefined,
    pendingConfirmationId: undefined,
    pendingConfirmationPayload: undefined,
    pendingMutationConfirmation: undefined,
    // #1429 — a choice prompt raised in the parent (or its worktree-
    // checkout-conflict sibling) references the PARENT repo's git call;
    // it can't be answered meaningfully after drilling into a submodule.
    pendingChoice: undefined,
    worktreeCheckoutConflict: undefined,
    // #1343 — none of these survive the repo boundary. The compare
    // base, blame / file-history paths, and the branch-keyed changelog
    // cache all reference the PARENT repo's objects; the per-list
    // cursors would be arbitrary positions in the submodule's lists.
    // All captured in parentReturn above and restored on pop.
    compareBase: undefined,
    blamePath: undefined,
    fileHistoryPath: undefined,
    changelogCache: {},
    selectedWorktreeFileIndex: 0,
    selectedBranchIndex: 0,
    selectedTagIndex: 0,
    selectedStashIndex: 0,
    selectedWorktreeListIndex: 0,
    selectedConflictFileIndex: 0,
    selectedReflogIndex: 0,
    selectedRemoteIndex: 0,
    selectedBlameIndex: 0,
    selectedFileHistoryIndex: 0,
    selectedIssueIndex: 0,
    selectedPullRequestTriageIndex: 0,
  }
}

/**
 * Pop the top repo frame off `state.repoStack` (#931) and restore
 * the parent's view position from the captured `parentReturn`. A
 * no-op when the stack is already at its single root frame so this
 * action is safe to dispatch from generic input handlers (e.g. the
 * Esc auto-pop wiring that lands in a follow-up PR).
 *
 * The defensive `parentReturn` fallback handles the never-supposed-
 * to-happen case where a non-root frame somehow has no return state
 * recorded — drop the frame but leave the user's view position
 * alone rather than crash mid-session.
 */
function withPoppedRepoFrame(state: LogInkState): LogInkState {
  if (state.repoStack.length <= 1) {
    return { ...state, pendingKey: undefined }
  }
  const topFrame = state.repoStack[state.repoStack.length - 1]
  const ret = topFrame.parentReturn
  const repoStack = state.repoStack.slice(0, -1)
  if (!ret) {
    return { ...state, repoStack, pendingKey: undefined }
  }
  return {
    ...state,
    repoStack,
    activeView: ret.activeView,
    // Restore the parent's full stack (fallback for pre-field captures)
    // plus the diff identity — a pop back onto a commit diff must land
    // on a diff that knows its source and can still walk back out.
    viewStack: ret.viewStack?.length ? [...ret.viewStack] : [ret.activeView],
    diffSource: ret.diffSource,
    stashDiffRef: ret.stashDiffRef,
    prDiffNumber: ret.prDiffNumber,
    compareHead: ret.compareHead,
    selectedIndex: ret.selectedIndex,
    selectedFileIndex: ret.selectedFileIndex,
    selectedSubmoduleIndex: ret.selectedSubmoduleIndex,
    filter: ret.filter,
    filterMode: false,
    pendingCommitFocused: false,
    // #995 — restore sidebar tab + sort preferences from the captured
    // parentReturn. Without this, the submodule's tab / sort choice
    // bleeds back into the parent after pop: the user picks 'tags' in
    // a vendored submodule, pops back to the parent, and finds the
    // parent's previously-selected 'branches' tab quietly replaced.
    sidebarTab: ret.sidebarTab,
    userSidebarTab: ret.userSidebarTab,
    branchSort: ret.branchSort,
    tagSort: ret.tagSort,
    // #1343 — restore the parent's per-repo state captured at push
    // time. The `??` fallbacks cover frames captured before these
    // fields landed: paths/base fall back to cleared (safe — they'd
    // otherwise reference the WRONG repo), cursors to the top.
    compareBase: ret.compareBase,
    blamePath: ret.blamePath,
    fileHistoryPath: ret.fileHistoryPath,
    changelogCache: ret.changelogCache ?? {},
    selectedWorktreeFileIndex: ret.selectedWorktreeFileIndex ?? 0,
    selectedBranchIndex: ret.selectedBranchIndex ?? 0,
    selectedTagIndex: ret.selectedTagIndex ?? 0,
    selectedStashIndex: ret.selectedStashIndex ?? 0,
    selectedWorktreeListIndex: ret.selectedWorktreeListIndex ?? 0,
    selectedConflictFileIndex: ret.selectedConflictFileIndex ?? 0,
    selectedReflogIndex: ret.selectedReflogIndex ?? 0,
    selectedRemoteIndex: ret.selectedRemoteIndex ?? 0,
    selectedBlameIndex: ret.selectedBlameIndex ?? 0,
    selectedFileHistoryIndex: ret.selectedFileHistoryIndex ?? 0,
    selectedIssueIndex: ret.selectedIssueIndex ?? 0,
    selectedPullRequestTriageIndex: ret.selectedPullRequestTriageIndex ?? 0,
    pendingKey: undefined,
    pendingConfirmationId: undefined,
    pendingConfirmationPayload: undefined,
    pendingMutationConfirmation: undefined,
    // #1429 — mirror of the push-time clear above; a choice prompt from
    // the popped (child) frame is equally meaningless once back in the
    // parent's context.
    pendingChoice: undefined,
    worktreeCheckoutConflict: undefined,
  }
}

function withReplacedView(state: LogInkState, value: LogInkView): LogInkState {
  if (topOfStack(state.viewStack) === value) {
    return { ...state, peekReturnFocus: undefined, pendingKey: undefined }
  }

  const viewStack = [...state.viewStack.slice(0, -1), value]
  return {
    ...state,
    activeView: value,
    viewStack,
    worktreeDiffOffset: value === 'diff' ? state.worktreeDiffOffset : 0,
    diffLineSelectAnchor: value === 'diff' ? state.diffLineSelectAnchor : undefined,
    diffSource: value === 'diff' ? state.diffSource : undefined,
    stashDiffRef: value === 'diff' ? state.stashDiffRef : undefined,
    prDiffNumber: value === 'diff' ? state.prDiffNumber : undefined,
    compareHead: value === 'diff' ? state.compareHead : undefined,
    pendingCommitFocused: value === 'history' ? state.pendingCommitFocused : false,
    statusGroupHeaderFocused: value === 'status' ? state.statusGroupHeaderFocused : false,
    // Changing the view is a deliberate destination — cancel any pending
    // peek return so the user isn't snapped back afterward.
    peekReturnFocus: undefined,
    pendingKey: undefined,
  }
}

/**
 * Drop the shared filter as part of a LATERAL view switch (g-chord /
 * palette jump). `state.filter` drives every promoted list — leaving it
 * armed meant a filter typed on history silently pre-narrowed the stash /
 * branch / triage lists the user jumped to, and since workflows resolve
 * their targets from the filtered lists by index, silently re-aimed
 * destructive actions. Applied AFTER the view-switch helper so the
 * cleared filter can't disturb the switch's own bookkeeping; a no-op when
 * no filter is set or the switch stayed on the same view (`enabled`).
 */
function withClearedFilter(state: LogInkState, enabled: boolean): LogInkState {
  if (!enabled || (!state.filter && !state.filterMode)) {
    return state
  }
  return { ...withFilter(state, ''), filterMode: false }
}

/**
 * Abandon an in-flight bisect start-wizard pick when the user laterally
 * navigates away from the pick surface. The wizard flag used to survive
 * every view switch: the explanatory status line auto-dismissed, and
 * minutes later Enter on a history commit silently advanced the hidden
 * wizard instead of opening the commit's diff. The wizard's own flow —
 * `s` on bisect dispatches `setBisectPickMode` THEN `pushView('history')`
 * in one batch — stays intact because history/bisect destinations are
 * exempt (history is where picking happens; bisect is its home view).
 */
function withAbandonedBisectPick(state: LogInkState, destination: LogInkView): LogInkState {
  if (!state.bisectPickMode || destination === 'history' || destination === 'bisect') {
    return state
  }
  return { ...state, bisectPickMode: undefined, bisectPickPendingBad: undefined }
}

/**
 * Drop an open rebase plan when navigation leaves the rebase view — a
 * stale plan must never execute against a HEAD that moved while the
 * user wandered elsewhere.
 */
function withAbandonedRebasePlan(state: LogInkState, destination: LogInkView): LogInkState {
  if (!state.rebasePlan || destination === 'rebase') {
    return state
  }
  return { ...state, rebasePlan: undefined }
}

/**
 * Drop an open conflict-resolution session when navigation leaves the
 * conflicts view (#1369) — a stale proposal must never write into a
 * file that changed while the user wandered elsewhere. (Accepts are
 * content-matched as a second line of defense, but the session UI
 * itself should not linger.)
 */
function withAbandonedConflictResolution(state: LogInkState, destination: LogInkView): LogInkState {
  if (!state.conflictResolution || destination === 'conflicts') {
    return state
  }
  return { ...state, conflictResolution: undefined }
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
  // Reflog (#781) snaps to 0 on filter change rather than rectifying.
  // The list is chronological and the user is unlikely to be tracking
  // a specific entry through filter changes — the simpler reset
  // matches the "find recovery target by typing" interaction.
  const reflogIndex = filterChanged ? 0 : state.selectedReflogIndex

  return {
    ...state,
    filter,
    filteredCommits,
    selectedIndex: clampIndex(state.selectedIndex, filteredCommits.length),
    selectedFileIndex: 0,
    selectedBranchIndex: branchIndex,
    selectedTagIndex: tagIndex,
    selectedStashIndex: stashIndex,
    selectedReflogIndex: reflogIndex,
    diffPreviewOffset: 0,
    pendingKey: undefined,
  }
}

function replaceRows(state: LogInkState, rows: GitLogRow[]): LogInkState {
  // Wholesale row replacement after a server-side re-fetch (#776).
  const commits = getCommitRows(rows)
  const filteredCommits = filterCommits(commits, state.filter)
  // Preserve the cursor by HASH when the previously selected commit is
  // still in the new set — most replaceRows are refreshes after a
  // mutation (cherry-pick, fetch, every bisect good/bad mark), where
  // snapping to the top on each one lost the user's place. When the
  // commit set genuinely changed (e.g. switching from `--all` to
  // `-- some/path`), the hash won't be found and the cursor resets to
  // the top exactly as before.
  const previousSelected = getSelectedInkCommit(state)
  const preservedIndex = previousSelected
    ? filteredCommits.findIndex((commit) =>
      hashesMatchAny(commit.hash || commit.shortHash, [previousSelected.hash, previousSelected.shortHash]))
    : -1
  return {
    ...state,
    rows,
    commits,
    filteredCommits,
    // A wholesale replacement IS the main ordering's fresh window, so
    // the pagination offset resets to its commit count (#1337).
    mainHistoryCommitCount: commits.length,
    selectedIndex: preservedIndex >= 0 ? preservedIndex : 0,
    selectedFileIndex: 0,
    pendingCommitFocused: false,
    pendingKey: undefined,
    // Rows just landed — clear the boot-loading flag so the history
    // surface drops the "Loading commits…" placeholder. Safe to clear
    // unconditionally because `replaceRows` only fires after a real
    // git log returns.
    bootLoading: false,
  }
}

function appendRows(
  state: LogInkState,
  rows: GitLogRow[],
  mainOrderingCount?: number
): LogInkState {
  const selected = getSelectedInkCommit(state)

  // Dedup the merged row list by commit hash so the graph renderer —
  // which windows directly over `state.rows` (toFullGraphItems →
  // expandRowsWithSpacers) — and the selection list (deduped commits)
  // agree on one canonical, duplicate-free row order. Overlapping
  // appends, notably the anchored `loadCommitContext` page that
  // re-walks history from the tip, otherwise stack the newest commits
  // below the oldest ones already loaded. The renderer then shows the
  // initial commit directly above HEAD and the cursor can scroll
  // forever through the duplicated tail — the history graph "looping
  // back on itself". Drop graph-only topology rows that trail a dropped
  // duplicate commit too, since they describe that duplicate's lanes
  // and would otherwise dangle.
  const seenHashes = new Set<string>()
  const nextRows: GitLogRow[] = []
  let droppingTrailingGraph = false
  for (const row of [...state.rows, ...rows]) {
    if (row.type === 'commit') {
      if (seenHashes.has(row.hash)) {
        droppingTrailingGraph = true
        continue
      }
      seenHashes.add(row.hash)
      droppingTrailingGraph = false
      nextRows.push(row)
      continue
    }
    // Graph-only topology row: keep it unless it trails a just-dropped
    // duplicate commit (then it belongs to the duplicate page's lanes).
    if (droppingTrailingGraph) {
      continue
    }
    nextRows.push(row)
  }

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
    // Only main-ordering pages advance the pagination offset (#1337);
    // anchored context loads pass no count. Advanced by the FETCHED
    // count, not the post-dedup delta — `skip` addresses positions in
    // git's own output ordering.
    mainHistoryCommitCount: state.mainHistoryCommitCount + (mainOrderingCount ?? 0),
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

/**
 * Which hunk the viewport is currently showing — the index of the last
 * hunk whose `@@` header offset is at or above the viewport top
 * (`offset`). This is the single source of truth for the worktree
 * staging diff's "current hunk" (#1179): deriving it from the scroll
 * position keeps the header, the in-body highlight, and `space`/`z`
 * (stage / revert) all pointed at the hunk you're actually looking at,
 * whether you got there by hunk-jump (↑/↓) or page-scroll (PgUp/PgDn).
 * The old `indexOf(landedOffset)` approach reset to hunk 0 whenever the
 * offset wasn't exactly on a boundary, and page-scroll never updated it
 * at all — so the indicator stuck at "1/N".
 */
export function hunkIndexAtOffset(offset: number, hunkOffsets: number[]): number {
  let index = 0
  for (let i = 0; i < hunkOffsets.length; i += 1) {
    if (hunkOffsets[i] <= offset) {
      index = i
    } else {
      break
    }
  }
  return index
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
    mainHistoryCommitCount: commits.length,
    selectedIndex: 0,
    selectedFileIndex: 0,
    selectedWorktreeFileIndex: 0,
    selectedBranchIndex: 0,
    selectedTagIndex: 0,
    selectedStashIndex: 0,
    selectedWorktreeListIndex: 0,
    selectedConflictFileIndex: 0,
    selectedReflogIndex: 0,
    selectedSubmoduleIndex: 0,
    selectedRemoteIndex: 0,
    selectedBlameIndex: 0,
    selectedFileHistoryIndex: 0,
    selectedIssueIndex: 0,
    selectedPullRequestTriageIndex: 0,
    selectedIssueFilter: 'open',
    selectedPullRequestFilter: 'open',
    repoStack: [{ label: options.repoLabel || 'root', workdir: options.repoWorkdir }],
    branchSort: DEFAULT_BRANCH_SORT_MODE,
    tagSort: DEFAULT_TAG_SORT_MODE,
    paletteFilter: '',
    paletteSelectedIndex: 0,
    paletteRecent: [],
    showThemePicker: false,
    themePickerFilter: '',
    themePickerIndex: 0,
    commitCompose: createCommitComposeState(),
    diffPreviewOffset: 0,
    worktreeDiffOffset: 0,
    filter: '',
    filterMode: false,
    // Default to the full multi-ref graph (`git log --all`) so users
    // see how branches, tags, and stashes weave through the history
    // out of the box. Pre-0.54.x this defaulted to false (current
    // branch only); user feedback consistently asked for the
    // GitKraken-style "see everything" view as the starting state.
    // The `\` toggle still flips back to compact / current-branch
    // mode for users who want the cleaner single-line graph. Tests
    // override via `options.fullGraph` when they need the compact
    // case explicitly.
    fullGraph: options.fullGraph ?? true,
    showHelp: false,
    helpScrollOffset: 0,
    helpFilter: '',
    helpFilterMode: false,
    showViewKeys: false,
    showCommandPalette: false,
    workflowActionId: undefined,
    pendingConfirmationId: undefined,
    pendingConfirmationPayload: undefined,
    pendingMutationConfirmation: undefined,
    pendingKey: undefined,
    focus: 'commits',
    // Default first-time tab is 'branches' — it's the most useful
    // landing surface in the workstation (current branch + recent
    // branches with ahead/behind, switch target, etc.). Users who
    // pick a different tab have their choice persisted per-repo via
    // sidebarPersistence.ts and won't see this default again.
    sidebarTab: 'branches',
    userSidebarTab: 'branches',
    sidebarHeaderFocused: false,
    statusGroupHeaderFocused: false,
    statusFilterMask: { ...DEFAULT_LOG_INK_STATUS_FILTER_MASK },
    diffViewMode: 'unified',
    inspectorTab: 'inspector',
    inspectorActionIndex: 0,
    bootLoading: options.bootLoading ?? false,
    changelogView: { ...DEFAULT_CHANGELOG_VIEW_STATE },
    changelogCache: {},
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

/**
 * Active (top-of-stack) repo frame (#931). Always defined — the
 * stack is invariant ≥ 1. The runtime reads this when it needs the
 * frame's metadata (label for chrome, return state on pop, the
 * entry range that drove the default landing view); the parallel
 * runtime structure for the live `SimpleGit` + loaded context is
 * keyed on the stack's depth so the two never get out of sync.
 */
export function getActiveLogInkRepoFrame(state: LogInkState): LogInkRepoFrame {
  return state.repoStack[state.repoStack.length - 1]
}

/**
 * True when the user has drilled into a submodule (or deeper).
 * Drives the chrome breadcrumb's display and any future
 * frame-aware behavior that wants to know "are we in a nested
 * frame?" without inspecting the stack directly.
 */
export function isLogInkNestedRepo(state: LogInkState): boolean {
  return state.repoStack.length > 1
}

/**
 * Ordered labels for every frame on the stack, root first. Drives
 * the breadcrumb rendering: `coco-ui · vendor/lib · feat/widget`.
 */
export function getLogInkRepoStackLabels(state: LogInkState): string[] {
  return state.repoStack.map((frame) => frame.label)
}

export function applyLogInkAction(state: LogInkState, action: LogInkAction): LogInkState {
  switch (action.type) {
    case 'appendRows':
      return appendRows(state, action.rows, action.mainOrderingCount)
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
        // Same idea for the status group header — Tab cycling away
        // from 'commits' should always land back on a real file when
        // the user returns.
        statusGroupHeaderFocused: false,
        // Explicit focus cycle cancels a pending peek return — the
        // user has taken manual control of the focus.
        peekReturnFocus: undefined,
        pendingKey: undefined,
      }
    case 'focusPrevious':
      return {
        ...state,
        focus: cycleValue(FOCUS_ORDER, state.focus, -1),
        sidebarHeaderFocused: false,
        statusGroupHeaderFocused: false,
        peekReturnFocus: undefined,
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
      //
      // Uses the shared `hashesMatchAny` helper to cover the
      // short-hash auto-extension mismatch between
      // `for-each-ref --format=%(objectname:short)` (cursored ref)
      // and `git log --pretty=format:%h` (history row). Without that
      // tolerance the resolver could decide "jump" but this reducer
      // would silently no-op — the status updates but the cursor
      // doesn't move, exactly the branch-cursor bug surfaced in 0.54.1
      // testing. See `src/git/hashes.ts` for the matching rules.
      const target = action.hash
      const index = state.filteredCommits.findIndex((commit) =>
        hashesMatchAny(target, [commit.hash, commit.shortHash])
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
        worktreeDiffOffset: 0,
        // Cursor moved to a real file row — drop header focus so the
        // file Enter handler (open diff) is what fires next.
        statusGroupHeaderFocused: false,
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
    case 'setStatusGroupHeaderFocused':
      return {
        ...state,
        statusGroupHeaderFocused: action.value,
        pendingKey: undefined,
      }
    case 'jumpToStatusGroup':
      // Used by ←/→ on the status surface to land on the first file of
      // the previous / next non-empty group. Clears header focus so the
      // user is on a real file after the jump (matches the
      // sidebar pattern where ←/→ between tabs lands on items, not on
      // the next tab's header).
      return {
        ...state,
        selectedWorktreeFileIndex: Math.max(0, action.targetIndex),
        worktreeDiffOffset: 0,
        statusGroupHeaderFocused: false,
        pendingKey: undefined,
      }
    case 'setInspectorTab':
      return {
        ...state,
        inspectorTab: action.value,
        // Reset the action cursor so a fresh tab visit always starts
        // on the first action, regardless of where the user left off
        // in a previous entity context.
        inspectorActionIndex: 0,
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
        inspectorActionIndex: 0,
        pendingKey: undefined,
      }
    }
    case 'moveInspectorAction':
      return {
        ...state,
        inspectorActionIndex: clampIndex(
          state.inspectorActionIndex + action.delta,
          action.actionCount
        ),
        pendingKey: undefined,
      }
    case 'resetInspectorActionIndex':
      return {
        ...state,
        inspectorActionIndex: 0,
        pendingKey: undefined,
      }
    case 'setBootLoading':
      return {
        ...state,
        bootLoading: action.value,
        pendingKey: undefined,
      }
    case 'setRemoteOp':
      return {
        ...state,
        remoteOp: action.value,
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
    case 'moveReflog':
      return {
        ...state,
        selectedReflogIndex: clampIndex(state.selectedReflogIndex + action.delta, action.count),
        pendingKey: undefined,
      }
    case 'moveSubmodule':
      return {
        ...state,
        selectedSubmoduleIndex: clampIndex(state.selectedSubmoduleIndex + action.delta, action.count),
        pendingKey: undefined,
      }
    case 'moveRemote':
      return {
        ...state,
        selectedRemoteIndex: clampIndex(state.selectedRemoteIndex + action.delta, action.count),
        pendingKey: undefined,
      }
    case 'moveBlame':
      return {
        ...state,
        selectedBlameIndex: clampIndex(state.selectedBlameIndex + action.delta, action.count),
        pendingKey: undefined,
      }
    case 'moveFileHistory':
      return {
        ...state,
        selectedFileHistoryIndex: clampIndex(state.selectedFileHistoryIndex + action.delta, action.count),
        pendingKey: undefined,
      }
    case 'moveIssue':
      return {
        ...state,
        selectedIssueIndex: clampIndex(state.selectedIssueIndex + action.delta, action.count),
        pendingKey: undefined,
      }
    case 'movePullRequestTriage':
      return {
        ...state,
        selectedPullRequestTriageIndex: clampIndex(
          state.selectedPullRequestTriageIndex + action.delta,
          action.count
        ),
        pendingKey: undefined,
      }
    case 'cycleIssueFilter':
      // Advance the preset, snap the cursor to the top of the
      // (newly filtered) list — same UX rule as `cycleBranchSort`.
      // The list refetches on preset change via the effect in
      // app.ts, so the cursor at 0 lands on whatever was promoted.
      return {
        ...state,
        selectedIssueFilter: cycleIssueFilterPreset(state.selectedIssueFilter),
        selectedIssueIndex: 0,
        pendingKey: undefined,
      }
    case 'cyclePullRequestTriageFilter':
      return {
        ...state,
        selectedPullRequestFilter: cyclePullRequestFilterPreset(state.selectedPullRequestFilter),
        selectedPullRequestTriageIndex: 0,
        pendingKey: undefined,
      }
    case 'moveWorktreeListEntry':
      return {
        ...state,
        selectedWorktreeListIndex: clampIndex(state.selectedWorktreeListIndex + action.delta, action.count),
        pendingKey: undefined,
      }
    case 'moveConflictFile':
      return {
        ...state,
        selectedConflictFileIndex: clampIndex(state.selectedConflictFileIndex + action.delta, action.count),
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
        // Group composition changed — header focus would be ambiguous
        // (cursor lands on file 0 which may belong to a different
        // group now). Reset to clear the indicator.
        statusGroupHeaderFocused: false,
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
      // The current staging hunk is derived from the scroll offset at
      // the read sites (#1185), so paging only moves the offset.
      return {
        ...state,
        worktreeDiffOffset: clampIndex(state.worktreeDiffOffset + action.delta, action.lineCount),
        pendingKey: undefined,
      }
    case 'jumpWorktreeHunk':
      // `[`/`]` move the offset onto the next/previous hunk header; the
      // current hunk is derived from that offset at the read sites.
      return {
        ...state,
        worktreeDiffOffset: nextHunkOffset(
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
      // Lateral navigation (g-chords / palette "jump to …") lands on a
      // fresh view — clear the shared filter so it can't silently
      // pre-narrow the destination's list (and, since every workflow
      // resolves its target from the FILTERED list, silently re-aim
      // destructive actions). Drill-ins (Enter → diff/blame/…) dispatch
      // their own navigate* actions, not this one, so the filter that
      // the drilled-into view depends on survives there.
      return withAbandonedConflictResolution(
        withAbandonedRebasePlan(
          withAbandonedBisectPick(
            withClearedFilter(withPushedView(state, action.value), state.activeView !== action.value),
            action.value,
          ),
          action.value,
        ),
        action.value,
      )
    case 'popView': {
      const popped = withPoppedView(state)
      const withoutPlan = state.activeView === 'rebase' && popped.activeView !== 'rebase'
        ? { ...popped, rebasePlan: undefined }
        : popped
      return state.activeView === 'conflicts' && withoutPlan.activeView !== 'conflicts'
        ? { ...withoutPlan, conflictResolution: undefined }
        : withoutPlan
    }
    case 'replaceView':
      return withAbandonedConflictResolution(
        withAbandonedRebasePlan(
          withAbandonedBisectPick(
            withClearedFilter(withReplacedView(state, action.value), state.activeView !== action.value),
            action.value,
          ),
          action.value,
        ),
        action.value,
      )
    case 'pushRepoFrame':
      return withPushedRepoFrame(state, {
        label: action.label,
        workdir: action.workdir,
        entryRange: action.entryRange,
      })
    case 'popRepoFrame':
      return withPoppedRepoFrame(state)
    case 'navigateHome': {
      if (state.viewStack.length === 1 && topOfStack(state.viewStack) === HOME_VIEW) {
        return { ...state, pendingKey: undefined }
      }
      return {
        ...state,
        activeView: HOME_VIEW,
        viewStack: [HOME_VIEW],
        worktreeDiffOffset: 0,
        pendingCommitFocused: false,
        pendingKey: undefined,
      }
    }
    case 'returnFromCommit': {
      // After a successful commit we leave the compose view automatically.
      // Where to: a still-dirty tree the user was staging from returns to
      // the Status view so they can finish the rest; an otherwise-complete
      // commit returns to the History view, where the new commit now shows.
      // We pop frames one at a time (reusing withPoppedView) so sidebar-tab
      // and diff-state restoration stays identical to manual Esc/back —
      // this also unwinds an intermediate `diff` frame (status → diff →
      // compose) back to the status frame it sits under.
      const target: LogInkView =
        action.stillDirty && state.viewStack.includes('status') ? 'status' : HOME_VIEW
      let next = state
      while (next.viewStack.length > 1 && topOfStack(next.viewStack) !== target) {
        next = withPoppedView(next)
      }
      return { ...next, pendingKey: undefined }
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
        // The anchor is a worktree-diff concept (#1389) — a stale one
        // carried in from the staging diff made the commit diff's
        // first Esc clear invisible state instead of popping.
        diffLineSelectAnchor: undefined,
        diffSource: 'commit',
      }
    }
    case 'navigateOpenDiffForWorktreeFile': {
      const next = withPushedView(state, 'diff')
      return {
        ...next,
        selectedWorktreeFileIndex: Math.max(0, action.fileIndex),
        worktreeDiffOffset: 0,
        diffLineSelectAnchor: undefined,
        diffSource: 'worktree',
      }
    }
    case 'navigateOpenBlameForPath': {
      // Open the on-demand blame drill-down for a path. Reset the blame
      // cursor to the top whenever the path changes so blame never opens
      // mid-file; preserve it when re-opening the same path (the cached
      // hydration is still valid and the user's place is worth keeping).
      const next = withPushedView(state, 'blame')
      const samePath = state.blamePath === action.path
      return {
        ...next,
        blamePath: action.path,
        selectedBlameIndex: samePath ? state.selectedBlameIndex : 0,
      }
    }
    case 'navigateOpenFileHistoryForPath': {
      // Open the file-history drill-down (#COCO-14). Reset the cursor
      // to the top for a fresh path; preserve position when re-opening
      // the same path (cached result + user's place in the log).
      const next = withPushedView(state, 'file-history')
      const samePath = state.fileHistoryPath === action.path
      return {
        ...next,
        fileHistoryPath: action.path,
        selectedFileHistoryIndex: samePath ? state.selectedFileHistoryIndex : 0,
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
    case 'navigateOpenDiffForPullRequest': {
      const next = withPushedView(state, 'diff')
      return {
        ...next,
        diffSource: 'pr',
        prDiffNumber: action.number,
        selectedPullRequestTriageIndex: Math.max(
          0,
          action.pullRequestIndex ?? state.selectedPullRequestTriageIndex
        ),
        // Reset the diff scroll offset so the PR patch always opens at
        // the top — same reasoning as the stash branch above.
        diffPreviewOffset: 0,
        worktreeDiffOffset: 0,
        diffLineSelectAnchor: undefined,
      }
    }
    case 'navigateOpenDiffForCompare': {
      const next = withPushedView(state, 'diff')
      return {
        ...next,
        diffSource: 'compare',
        compareBase: action.base,
        compareHead: action.head,
        // Reset scroll offset so the compare patch always opens at
        // the top — same reasoning as the stash branch above.
        diffPreviewOffset: 0,
        worktreeDiffOffset: 0,
      }
    }
    case 'setCompareBase':
      return {
        ...state,
        compareBase: action.value,
        pendingKey: undefined,
      }
    case 'clearCompareBase':
      return {
        ...state,
        compareBase: undefined,
        pendingKey: undefined,
      }
    case 'navigateOpenComposeForFile': {
      const next = withPushedView(state, 'status')
      return {
        ...next,
        selectedWorktreeFileIndex: Math.max(0, action.fileIndex),
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
        // The status group header lives in the 'commits' focus on
        // the status view — clear when focus moves away so a
        // re-entry starts on a real file.
        statusGroupHeaderFocused: action.value === 'commits' ? state.statusGroupHeaderFocused : false,
        // An explicit focus set cancels a pending peek return.
        peekReturnFocus: undefined,
        pendingKey: undefined,
      }
    case 'togglePeek': {
      // Peek = "focus the sidebar with a return ticket." Closing returns
      // to the stashed focus; opening (only from a non-sidebar pane)
      // stashes the current focus and jumps to the sidebar. The render
      // layer needs no special case — `focus: 'sidebar'` already drives
      // the single-pane layout to show the sidebar full-width.
      if (state.peekReturnFocus !== undefined) {
        return {
          ...state,
          focus: state.peekReturnFocus,
          peekReturnFocus: undefined,
          sidebarHeaderFocused: false,
          pendingKey: undefined,
        }
      }
      if (state.focus === 'sidebar') {
        return state
      }
      return {
        ...state,
        focus: 'sidebar',
        peekReturnFocus: state.focus,
        pendingKey: undefined,
      }
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
        // Clearing the message resets kind to undefined so a previous
        // 'error' doesn't bleed into the next info update. Explicit
        // 'info' also clears kind for the same reason.
        statusKind: !action.value || action.kind === 'info' ? undefined : action.kind,
        // Same clearing semantics for loading — every setStatus that
        // doesn't explicitly opt in (loading: true) clears the flag so
        // a stale spinner doesn't linger after the LLM call finishes.
        statusLoading: !action.value ? undefined : (action.loading ? true : undefined),
        pendingKey: undefined,
      }
    case 'setPendingPullRequestBodyDraft':
      // PR-body draft tracker (#881 phase 4). Set true while
      // `startCreatePullRequest` is awaiting the changelog-based
      // body generation; gates the Esc cancel binding in the input
      // handler so pressing Esc during the wait skips opening the
      // follow-up prompt instead of falling through to global Esc.
      return {
        ...state,
        pendingPullRequestBodyDraft: action.value || undefined,
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
        // Only one modal prompt may own the keyboard (#1342): raising a
        // confirmation dismisses any open choice prompt so a `y` meant
        // for the confirm can't be matched against choice option keys.
        pendingChoice: action.value ? undefined : state.pendingChoice,
        // A confirmation must be what's actually on screen (#1429): help,
        // view-keys, and the command palette all render above it and eat
        // its keys, so raising one closes those overlays the same way
        // toggleHelp/toggleViewKeys/toggleCommandPalette close each other.
        showHelp: action.value ? false : state.showHelp,
        showViewKeys: action.value ? false : state.showViewKeys,
        showCommandPalette: action.value ? false : state.showCommandPalette,
        helpScrollOffset: action.value ? 0 : state.helpScrollOffset,
        helpFilter: action.value ? '' : state.helpFilter,
        helpFilterMode: action.value ? false : state.helpFilterMode,
        pendingKey: undefined,
      }
    case 'setWorktreeCheckoutConflict':
      return { ...state, worktreeCheckoutConflict: action.value, pendingKey: undefined }
    case 'setPendingChoice':
      // Mirror of setPendingConfirmation (#1342): a new choice prompt
      // displaces any pending confirmation so the two can never be
      // active (and answer-shadowing) simultaneously.
      return {
        ...state,
        pendingChoice: action.value,
        pendingConfirmationId: action.value ? undefined : state.pendingConfirmationId,
        pendingConfirmationPayload: action.value ? undefined : state.pendingConfirmationPayload,
        // Same overlay-precedence fix as setPendingConfirmation above (#1429).
        showHelp: action.value ? false : state.showHelp,
        showViewKeys: action.value ? false : state.showViewKeys,
        showCommandPalette: action.value ? false : state.showCommandPalette,
        helpScrollOffset: action.value ? 0 : state.helpScrollOffset,
        helpFilter: action.value ? '' : state.helpFilter,
        helpFilterMode: action.value ? false : state.helpFilterMode,
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
    case 'setPendingItemAction':
      // Pure marker for the in-flight row action (delete / checkout);
      // touches nothing else so the list keeps rendering normally
      // underneath the one spinner'd row.
      return { ...state, pendingItemAction: action.value }
    case 'toggleFilterMode':
      return {
        ...state,
        filterMode: !state.filterMode,
        showCommandPalette: false,
        showHelp: false,
        helpScrollOffset: 0,
        helpFilter: '',
        helpFilterMode: false,
        showViewKeys: false,
        pendingKey: undefined,
      }
    case 'toggleGraph':
      return {
        ...state,
        fullGraph: !state.fullGraph,
        pendingKey: undefined,
      }
    case 'toggleHelp': {
      const opening = !state.showHelp
      return {
        ...state,
        showHelp: opening,
        // Reset scroll position when toggling either direction so the
        // next open always starts at the top — feels more predictable
        // than picking up where the user last scrolled.
        helpScrollOffset: 0,
        helpFilter: '',
        helpFilterMode: false,
        showCommandPalette: false,
        // Opening full help supersedes the compact view-keys strip — this
        // is the progressive-disclosure step (`?` from the strip expands
        // to the full categorized help, #1137).
        showViewKeys: false,
        pendingKey: undefined,
      }
    }
    case 'toggleViewKeys':
      return {
        ...state,
        showViewKeys: !state.showViewKeys,
        // The view-keys strip is mutually exclusive with the other
        // overlays; opening it closes anything else that was showing.
        showHelp: false,
        helpScrollOffset: 0,
        helpFilter: '',
        helpFilterMode: false,
        showCommandPalette: false,
        pendingKey: undefined,
      }
    case 'scrollHelp':
      // No upper-bound clamp here — the renderer caps the offset
      // against the actual content height at render time. The
      // reducer just prevents going below 0 so callers can safely
      // pass negative deltas without us going past the top.
      return {
        ...state,
        helpScrollOffset: Math.max(0, state.helpScrollOffset + action.delta),
      }
    case 'openHelpFilter':
      return { ...state, helpFilterMode: true }
    case 'appendHelpFilter':
      // Typing narrows from the top — reset the scroll so the first
      // match is visible instead of whatever row the user had reached.
      return { ...state, helpFilter: state.helpFilter + action.value, helpScrollOffset: 0 }
    case 'backspaceHelpFilter':
      return { ...state, helpFilter: state.helpFilter.slice(0, -1), helpScrollOffset: 0 }
    case 'commitHelpFilter':
      // Enter keeps the narrowed list but returns j/k to scrolling.
      return { ...state, helpFilterMode: false }
    case 'clearHelpFilter':
      return { ...state, helpFilter: '', helpFilterMode: false, helpScrollOffset: 0 }
    case 'toggleCommandPalette': {
      const opening = !state.showCommandPalette
      return {
        ...state,
        showCommandPalette: opening,
        showHelp: false,
        helpScrollOffset: 0,
        helpFilter: '',
        helpFilterMode: false,
        showViewKeys: false,
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
    case 'toggleThemePicker': {
      const opening = !state.showThemePicker
      return {
        ...state,
        showThemePicker: opening,
        // Only one overlay at a time — close help / palette / view-keys on open.
        showHelp: false,
        showViewKeys: false,
        showCommandPalette: false,
        themePickerFilter: '',
        themePickerIndex: 0,
        pendingKey: undefined,
      }
    }
    case 'moveThemePicker':
      return {
        ...state,
        themePickerIndex: clampIndex(
          state.themePickerIndex + action.delta,
          action.presetCount
        ),
        pendingKey: undefined,
      }
    case 'appendThemePickerFilter':
      return {
        ...state,
        themePickerFilter: `${state.themePickerFilter}${action.value}`,
        themePickerIndex: 0,
        pendingKey: undefined,
      }
    case 'backspaceThemePickerFilter':
      return {
        ...state,
        themePickerFilter: state.themePickerFilter.slice(0, -1),
        themePickerIndex: 0,
        pendingKey: undefined,
      }
    case 'clearThemePickerFilter':
      return {
        ...state,
        themePickerFilter: '',
        themePickerIndex: 0,
        pendingKey: undefined,
      }
    case 'openGitignorePicker':
      return {
        ...state,
        gitignorePicker: { file: action.file, index: 0 },
        pendingKey: undefined,
      }
    case 'closeGitignorePicker':
      return {
        ...state,
        gitignorePicker: undefined,
        pendingKey: undefined,
      }
    case 'moveGitignorePicker':
      return state.gitignorePicker
        ? {
          ...state,
          gitignorePicker: {
            ...state.gitignorePicker,
            index: clampIndex(state.gitignorePicker.index + action.delta, action.count),
          },
          pendingKey: undefined,
        }
        : state
    case 'setChangelogLoading':
      return {
        ...state,
        changelogView: {
          status: 'loading',
          branch: action.branch,
          baseLabel: action.baseLabel,
          scrollOffset: 0,
        },
        pendingKey: undefined,
      }
    case 'setChangelogReady': {
      // Cache the result so re-entry (or `c` to PR) reuses it instead of
      // re-running the LLM. Keyed by branch so a checkout naturally
      // produces a fresh generation.
      // Audit finding #9: `generatedAt` arrives on the action payload
      // instead of being read from `Date.now()` here, so the reducer
      // stays pure. Dispatchers (currently `runChangelogView` in
      // app.ts) call `Date.now()` at dispatch time.
      const cached: ChangelogCacheEntry = {
        text: action.text,
        baseLabel: action.baseLabel,
        generatedAt: action.generatedAt,
      }
      return {
        ...state,
        changelogView: {
          status: 'ready',
          text: action.text,
          branch: action.branch,
          baseLabel: action.baseLabel,
          scrollOffset: 0,
        },
        changelogCache: {
          ...state.changelogCache,
          [action.branch]: cached,
        },
        pendingKey: undefined,
      }
    }
    case 'setChangelogError':
      return {
        ...state,
        changelogView: {
          status: 'error',
          branch: action.branch,
          baseLabel: action.baseLabel,
          error: action.error,
          scrollOffset: 0,
        },
        pendingKey: undefined,
      }
    case 'setChangelogText': {
      // Used by the $EDITOR round-trip: user edits the cached text, we
      // update the view AND the cache entry so subsequent re-entry
      // reflects the edits. Branch key is taken from the current view
      // (which is what the user just edited against).
      if (state.changelogView.status !== 'ready' || !state.changelogView.branch) {
        return state
      }
      const branch = state.changelogView.branch
      const existing = state.changelogCache[branch]
      return {
        ...state,
        changelogView: {
          ...state.changelogView,
          text: action.text,
        },
        changelogCache: {
          ...state.changelogCache,
          [branch]: {
            text: action.text,
            baseLabel: existing?.baseLabel || state.changelogView.baseLabel || '',
            // Updated-at timestamp reflects the edit. Not the original
            // generation time — `r` (regenerate) is the explicit knob
            // for "I want fresh LLM output, not my edits".
            // Audit finding #9: timestamp arrives on the action.
            generatedAt: action.generatedAt,
          },
        },
        pendingKey: undefined,
      }
    }
    case 'pageChangelog':
      return {
        ...state,
        changelogView: {
          ...state.changelogView,
          scrollOffset: clampIndex(
            state.changelogView.scrollOffset + action.delta,
            action.lineCount
          ),
        },
        pendingKey: undefined,
      }
    case 'clearChangelogCache': {
      // Targeted clear for a single branch, or wholesale wipe when
      // `branch` is omitted. Wholesale used on session reset / config
      // change; targeted reserved for future "this generation looks
      // wrong, drop it" UX.
      if (!action.branch) {
        return { ...state, changelogCache: {}, pendingKey: undefined }
      }
      const next = { ...state.changelogCache }
      delete next[action.branch]
      return { ...state, changelogCache: next, pendingKey: undefined }
    }
    case 'markRecentCommits':
      // Empty hash list closes out the marker — caller may use this
      // to clear early when a follow-up op fires (so old "new"
      // markers don't bleed into the next operation's surface).
      if (action.hashes.length === 0) {
        return { ...state, recentCommitHashes: undefined, pendingKey: undefined }
      }
      return {
        ...state,
        // Audit finding #9: timestamp arrives on the action payload
        // instead of being read from `Date.now()` here.
        recentCommitHashes: { hashes: action.hashes, markedAt: action.markedAt },
        pendingKey: undefined,
      }
    case 'clearRecentCommits':
      return { ...state, recentCommitHashes: undefined, pendingKey: undefined }
    case 'startSplitPlanLoad':
      // Overlay opens immediately so the user sees the loading state
      // (rather than the compose view sitting frozen while the LLM
      // call resolves). plan + planContext stay undefined until ready.
      return {
        ...state,
        splitPlan: { status: 'loading', scrollOffset: 0 },
        pendingKey: undefined,
      }
    case 'setSplitPlanReady':
      return {
        ...state,
        splitPlan: {
          status: 'ready',
          plan: action.plan,
          planContext: action.planContext,
          scrollOffset: 0,
          fallback: action.fallback,
          dedupeWarnings: action.dedupeWarnings,
        },
        pendingKey: undefined,
      }
    case 'setSplitPlanApplying':
      // Preserve plan + planContext so the overlay can keep rendering
      // the same content during apply (just with a "applying…" hint
      // overlaid). If somehow this fires without a plan loaded, fall
      // back to the loading shape.
      if (!state.splitPlan?.plan || !state.splitPlan.planContext) {
        return { ...state, splitPlan: { status: 'loading', scrollOffset: 0 }, pendingKey: undefined }
      }
      return {
        ...state,
        splitPlan: {
          ...state.splitPlan,
          status: 'applying',
        },
        pendingKey: undefined,
      }
    case 'setSplitPlanError':
      // Apply / plan failure path. We KEEP the overlay open in 'ready'
      // shape with the previous plan if we have one, so the user can
      // either retry or back out without losing context. If no plan
      // yet (failure during initial load), close the overlay — there's
      // nothing to retry from. The status line carries the message
      // either way; the `error` field is for the overlay's own copy.
      if (!state.splitPlan?.plan) {
        return { ...state, splitPlan: undefined, pendingKey: undefined }
      }
      return {
        ...state,
        splitPlan: {
          ...state.splitPlan,
          status: 'ready',
          error: action.error,
        },
        pendingKey: undefined,
      }
    case 'pageSplitPlan':
      if (!state.splitPlan) return state
      return {
        ...state,
        splitPlan: {
          ...state.splitPlan,
          scrollOffset: clampIndex(
            state.splitPlan.scrollOffset + action.delta,
            action.lineCount
          ),
        },
        pendingKey: undefined,
      }
    case 'clearSplitPlan':
      return { ...state, splitPlan: undefined, pendingKey: undefined }
    case 'openRebasePlan': {
      const next = withPushedView(state, 'rebase')
      return {
        ...next,
        rebasePlan: { rows: action.rows, selectedIndex: 0 },
      }
    }
    case 'moveRebaseCursor': {
      const plan = state.rebasePlan
      if (!plan || plan.rows.length === 0) return state
      return {
        ...state,
        rebasePlan: {
          ...plan,
          selectedIndex: clampIndex(plan.selectedIndex + action.delta, plan.rows.length),
        },
        pendingKey: undefined,
      }
    }
    case 'setRebaseAction': {
      const plan = state.rebasePlan
      const row = plan?.rows[plan.selectedIndex]
      if (!plan || !row) return state
      // Retagging away from reword drops the stashed message so a later
      // re-reword starts fresh instead of resurrecting stale text.
      const rows = plan.rows.map((entry, index) => (
        index === plan.selectedIndex
          ? { ...entry, action: action.action, newMessage: action.action === 'reword' ? entry.newMessage : undefined }
          : entry
      ))
      return { ...state, rebasePlan: { ...plan, rows }, pendingKey: undefined }
    }
    case 'moveRebaseRow': {
      const plan = state.rebasePlan
      if (!plan) return state
      const from = plan.selectedIndex
      const to = from + action.delta
      if (to < 0 || to >= plan.rows.length) return state
      const rows = [...plan.rows]
      const [moved] = rows.splice(from, 1)
      rows.splice(to, 0, moved)
      return { ...state, rebasePlan: { rows, selectedIndex: to }, pendingKey: undefined }
    }
    case 'setRebaseRewordMessage': {
      const plan = state.rebasePlan
      const row = plan?.rows[plan.selectedIndex]
      if (!plan || !row) return state
      const message = action.message.trim()
      if (!message) return { ...state, pendingKey: undefined }
      const rows = plan.rows.map((entry, index) => (
        index === plan.selectedIndex
          ? { ...entry, action: 'reword' as const, newMessage: message }
          : entry
      ))
      return { ...state, rebasePlan: { ...plan, rows }, pendingKey: undefined }
    }
    case 'setDiffLineSelectAnchor':
      return { ...state, diffLineSelectAnchor: action.value, pendingKey: undefined }
    case 'clearRebasePlan':
      return { ...state, rebasePlan: undefined, pendingKey: undefined }
    case 'setConflictResolutionLoading':
      return {
        ...state,
        conflictResolution: { path: action.path, status: 'loading', proposals: [], selectedIndex: 0 },
        pendingKey: undefined,
      }
    case 'setConflictResolutionReady':
      return {
        ...state,
        conflictResolution: {
          path: action.path,
          status: 'ready',
          proposals: action.proposals.map((proposal) => ({ ...proposal, status: 'pending' as const })),
          selectedIndex: 0,
        },
        pendingKey: undefined,
      }
    case 'setConflictResolutionError':
      return {
        ...state,
        conflictResolution: {
          path: action.path,
          status: 'error',
          error: action.error,
          proposals: [],
          selectedIndex: 0,
        },
        pendingKey: undefined,
      }
    case 'moveConflictProposal': {
      const session = state.conflictResolution
      if (!session || session.proposals.length === 0) {
        return { ...state, pendingKey: undefined }
      }
      return {
        ...state,
        conflictResolution: {
          ...session,
          selectedIndex: clampIndex(session.selectedIndex + action.delta, session.proposals.length),
        },
        pendingKey: undefined,
      }
    }
    case 'setConflictProposalStatus': {
      const session = state.conflictResolution
      if (!session) {
        return { ...state, pendingKey: undefined }
      }
      const proposals = session.proposals.map((proposal) =>
        proposal.regionIndex === action.regionIndex
          ? {
            ...proposal,
            status: action.status,
            resolution: action.resolution ?? proposal.resolution,
          }
          : proposal
      )
      // Advance the cursor to the next still-pending proposal so the
      // y/y/y flow walks the file without manual j presses.
      const nextPending = proposals.findIndex(
        (proposal, index) => index > session.selectedIndex && proposal.status === 'pending'
      )
      const anyPending = proposals.findIndex((proposal) => proposal.status === 'pending')
      const selectedIndex = nextPending !== -1
        ? nextPending
        : anyPending !== -1
          ? anyPending
          : session.selectedIndex
      return {
        ...state,
        conflictResolution: { ...session, proposals, selectedIndex },
        pendingKey: undefined,
      }
    }
    case 'clearConflictResolution':
      return { ...state, conflictResolution: undefined, pendingKey: undefined }
    case 'setBisectPickMode':
      return {
        ...state,
        bisectPickMode: action.mode,
        bisectPickPendingBad: action.pendingBad ?? state.bisectPickPendingBad,
        pendingKey: undefined,
      }
    case 'clearBisectPickMode':
      return {
        ...state,
        bisectPickMode: undefined,
        bisectPickPendingBad: undefined,
        pendingKey: undefined,
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

/**
 * Fuzzy (subsequence) score for a preset id against a lowercase query.
 * Returns `null` when the query chars don't appear in order; otherwise a
 * score where contiguous runs, a start-of-string match, and matches right
 * after a `-` separator are rewarded — so `gl` ranks `gruvbox-light` /
 * `github-light` above incidental matches, and `tn` finds `tokyo-night`.
 */
function fuzzyScoreThemePreset(preset: string, query: string): number | null {
  const target = preset.toLowerCase()
  let qi = 0
  let score = 0
  let lastMatch = -2
  for (let i = 0; i < target.length && qi < query.length; i += 1) {
    if (target[i] === query[qi]) {
      score += 1
      if (i === lastMatch + 1) score += 4 // contiguous run
      if (i === 0) score += 8 // matches the very start
      else if (target[i - 1] === '-') score += 4 // start of a word segment
      lastMatch = i
      qi += 1
    }
  }
  return qi === query.length ? score : null
}

/**
 * Filter the full preset list by a fuzzy (subsequence) query, ranked best
 * match first (ties broken by catalog order). An empty query returns every
 * preset in catalog order. Shared by the theme picker overlay renderer, the
 * input handler (for cursor bounds), and the live-preview selector so all
 * three agree on the same filtered list.
 */
export function filterThemePresets(filter: string): LogInkThemePreset[] {
  const query = filter.trim().toLowerCase()
  const all = getLogInkThemePresets()
  if (!query) {
    return all
  }
  return all
    .map((preset, index) => ({ preset, index, score: fuzzyScoreThemePreset(preset, query) }))
    .filter((entry): entry is { preset: LogInkThemePreset; index: number; score: number } => entry.score !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.preset)
}

/**
 * The preset currently under the theme-picker cursor (clamped to the
 * filtered list). `undefined` when the filter matches nothing.
 */
export function getThemePickerSelection(state: LogInkState): LogInkThemePreset | undefined {
  return getThemePickerSelectionFor(state.themePickerFilter, state.themePickerIndex)
}

/**
 * State-model-agnostic variant: the preset under the picker cursor for a
 * raw `filter` + `index`. Used by the workspace top-level surface, which
 * keeps its own state shape but shares the picker filtering.
 */
export function getThemePickerSelectionFor(
  filter: string,
  index: number
): LogInkThemePreset | undefined {
  const filtered = filterThemePresets(filter)
  if (filtered.length === 0) {
    return undefined
  }
  return filtered[clampIndex(index, filtered.length)]
}
