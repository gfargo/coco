import { LogInkFocus, LogInkView } from './inkViewModel'
import type { LogInkVisiblePane } from '../chrome/layout'
import {
    LogInkWorkflowAction,
    LogInkWorkflowActionKind,
    getLogInkWorkflowActions,
} from './inkWorkflows'

export type LogInkCommandId =
  | 'clearSearch'
  | 'commandPalette'
  | 'themePicker'
  | 'openProjectConfig'
  | 'openGlobalConfig'
  | 'gitignoreFile'
  | 'stageAll'
  | 'stagePathspec'
  | 'createStash'
  | 'commit'
  | 'cycleSort'
  | 'editCommit'
  | 'editCommitExternal'
  | 'commitSplit'
  | 'focusNext'
  | 'focusPrevious'
  | 'help'
  | 'markForCompare'
  | 'moveDown'
  | 'moveToBottom'
  | 'moveToTop'
  | 'navigateBack'
  | 'navigateBranches'
  | 'navigateCompose'
  | 'navigateConflicts'
  | 'navigateDiff'
  | 'navigateHome'
  | 'navigateBisect'
  | 'navigateIssues'
  | 'navigatePullRequest'
  | 'navigatePullRequestTriage'
  | 'navigateBlame'
  | 'navigateFileHistory'
  | 'navigateReflog'
  | 'navigateRemotes'
  | 'navigateStash'
  | 'navigateSubmodules'
  | 'navigateWorktrees'
  | 'navigateStatus'
  | 'navigateTags'
  | 'nextHunk'
  | 'nextMatch'
  | 'nextSidebarTab'
  | 'moveUp'
  | 'openSelected'
  | 'pageDown'
  | 'pageUp'
  | 'previousHunk'
  | 'previousMatch'
  | 'previousSidebarTab'
  | 'quit'
  | 'refresh'
  | 'revertSelection'
  | 'search'
  | 'toggleDiffViewMode'
  | 'toggleGraph'
  | 'viewKeys'
  | 'workflowDeleteBranch'
  | 'workflowDeleteTag'
  | 'workflowDropStash'
  | 'workflowRemoveWorktree'
  | 'workflowAbortOperation'
  | 'workflowAiCommitSummary'
  | 'workflowAiConflictHelp'
  | 'viewCherryPick'
  | 'viewRevert'
  | 'viewReset'
  | 'viewInteractiveRebase'
  | 'viewFixup'
  | 'viewRebaseOnto'
  | 'viewCreateBranchHere'
  | 'viewCreateTagHere'
  | 'viewChangelog'
  | 'yankClipboard'

export type LogInkBindingCategory =
  | 'essentials'
  | 'navigation'
  | 'movement'
  | 'view'
  | 'edit'
  | 'mutate'
  | 'history-actions'

export type LogInkKeyBinding = {
  id: LogInkCommandId
  keys: string[]
  label: string
  description: string
  contexts: Array<'normal' | 'search' | LogInkFocus | LogInkView>
}

export type LogInkHelpSubgroup = {
  category: LogInkBindingCategory
  /** Display label for the subgroup heading (e.g. "Essentials"). */
  title: string
  bindings: LogInkKeyBinding[]
}

export type LogInkHelpSection = {
  title: string
  bindings: LogInkKeyBinding[]
  /**
   * Bindings grouped by category, ordered by how commonly users reach
   * for each group. The legacy `bindings` field stays in place for
   * back-compat — renderers that don't care about subgroups can keep
   * iterating it. Subgroup ordering is fixed by the help section
   * builder so the same section in the same view always renders in
   * the same order.
   */
  subgroups: LogInkHelpSubgroup[]
}

export type LogInkCommandPaletteItem = {
  id: LogInkCommandId
  keys: string
  label: string
  description: string
}

export const LOG_INK_KEY_BINDINGS: LogInkKeyBinding[] = [
  {
    id: 'moveUp',
    keys: ['up', 'k'],
    label: 'move up',
    description: 'Move the current selection up.',
    contexts: ['normal', 'commits', 'sidebar'],
  },
  {
    id: 'moveDown',
    keys: ['down', 'j'],
    label: 'move down',
    description: 'Move the current selection down.',
    contexts: ['normal', 'commits', 'sidebar'],
  },
  {
    id: 'pageUp',
    keys: ['page up'],
    label: 'page up',
    description: 'Move a page up in the commit list.',
    contexts: ['commits'],
  },
  {
    id: 'pageDown',
    keys: ['page down'],
    label: 'page down',
    description: 'Move a page down in the commit list.',
    contexts: ['commits'],
  },
  {
    id: 'moveToTop',
    keys: ['gg'],
    label: 'top',
    description: 'Jump to the first visible commit.',
    contexts: ['commits'],
  },
  {
    id: 'moveToBottom',
    keys: ['G'],
    label: 'bottom',
    description: 'Jump to the last visible commit.',
    contexts: ['commits'],
  },
  {
    id: 'nextMatch',
    keys: ['n'],
    label: 'next match',
    description: 'Move to the next visible search result.',
    contexts: ['commits'],
  },
  {
    id: 'previousMatch',
    keys: ['N'],
    label: 'previous match',
    description: 'Move to the previous visible search result.',
    contexts: ['commits'],
  },
  {
    id: 'previousSidebarTab',
    keys: ['['],
    label: 'previous tab',
    description: 'Move to the previous repository sidebar tab (outside diff view).',
    contexts: ['sidebar'],
  },
  {
    id: 'nextSidebarTab',
    keys: [']'],
    label: 'next tab',
    description: 'Move to the next repository sidebar tab (outside diff view).',
    contexts: ['sidebar'],
  },
  {
    id: 'previousHunk',
    keys: ['['],
    label: 'previous hunk',
    description: 'Jump to the previous diff hunk in the current diff view.',
    contexts: ['commits'],
  },
  {
    id: 'nextHunk',
    keys: [']'],
    label: 'next hunk',
    description: 'Jump to the next diff hunk in the current diff view.',
    contexts: ['commits'],
  },
  {
    id: 'focusNext',
    keys: ['tab'],
    label: 'focus',
    description: 'Move focus to the next panel.',
    contexts: ['normal'],
  },
  {
    id: 'focusPrevious',
    keys: ['shift+tab'],
    label: 'focus back',
    description: 'Move focus to the previous panel.',
    contexts: ['normal'],
  },
  {
    id: 'search',
    keys: ['/'],
    label: 'search',
    description: 'Filter commits by hash, author, ref, or message.',
    contexts: ['normal'],
  },
  {
    id: 'clearSearch',
    keys: ['ctrl+u'],
    label: 'clear',
    description: 'Clear the active search filter.',
    contexts: ['search'],
  },
  {
    id: 'toggleGraph',
    keys: ['\\'],
    label: 'graph',
    description: 'Toggle compact and full graph display.',
    contexts: ['normal', 'commits'],
  },
  {
    id: 'toggleDiffViewMode',
    keys: ['d'],
    label: 'split/unified',
    description: 'Toggle the diff view between unified and side-by-side split rendering. Falls back to unified on narrow terminals.',
    contexts: ['commits'],
  },
  {
    id: 'navigateHome',
    keys: ['gh'],
    label: 'home',
    description: 'Jump to the history root view (clears the navigation stack).',
    contexts: ['normal'],
  },
  {
    id: 'navigateStatus',
    keys: ['gs'],
    label: 'status',
    description: 'Push the working-tree status view onto the navigation stack.',
    contexts: ['normal'],
  },
  {
    id: 'navigateDiff',
    keys: ['gd'],
    label: 'diff',
    description: 'Push the diff view for the selected commit or file.',
    contexts: ['normal'],
  },
  {
    id: 'navigateCompose',
    keys: ['gc'],
    label: 'compose',
    description: 'Push the commit-compose view (draft + staged-files summary).',
    contexts: ['normal'],
  },
  {
    id: 'navigateBranches',
    keys: ['gb'],
    label: 'branches',
    description: 'Push the branches view (local branches with divergence info).',
    contexts: ['normal'],
  },
  {
    id: 'navigateTags',
    keys: ['gt'],
    label: 'tags',
    description: 'Push the tags view.',
    contexts: ['normal'],
  },
  {
    id: 'navigateStash',
    keys: ['gz'],
    label: 'stash',
    description: 'Push the stash view (gz; gs is reserved for status).',
    contexts: ['normal'],
  },
  {
    id: 'createStash',
    keys: ['gZ'],
    label: 'stash changes',
    description: 'Stash all changes (tracked + untracked) with an optional message — works from any view, including status/diff/compose. Empty message creates a quick WIP stash.',
    contexts: ['normal'],
  },
  {
    id: 'navigateWorktrees',
    keys: ['gw'],
    label: 'worktrees',
    description: 'Push the linked worktrees view.',
    contexts: ['normal'],
  },
  {
    id: 'navigatePullRequest',
    keys: ['gp'],
    label: 'pull request',
    description: 'Push the dedicated pull-request action panel for the current branch.',
    contexts: ['normal'],
  },
  {
    id: 'navigatePullRequestTriage',
    keys: ['gP'],
    label: 'PR triage',
    description: 'Push the multi-PR triage list view (#882). Capital P disambiguates from `gp` which targets the single-PR panel for the current branch.',
    contexts: ['normal'],
  },
  {
    id: 'navigateIssues',
    keys: ['gi'],
    label: 'issues',
    description: 'Push the issue triage list view (#882).',
    contexts: ['normal'],
  },
  {
    id: 'navigateConflicts',
    keys: ['gx'],
    label: 'conflicts',
    description: 'Push the conflict resolution helper view (available during merge/rebase/cherry-pick/revert).',
    contexts: ['normal'],
  },
  {
    id: 'navigateReflog',
    keys: ['gr'],
    label: 'reflog',
    description: 'Push the reflog browser view — chronological recovery log.',
    contexts: ['normal'],
  },
  {
    id: 'navigateBisect',
    keys: ['gB'],
    label: 'bisect',
    description: 'Push the bisect workflow view (#784). Capital B disambiguates from gb (branches). Available whenever a bisect is in progress; surfaces the current candidate and the good / bad / skip / reset action keys.',
    contexts: ['normal'],
  },
  {
    id: 'navigateSubmodules',
    keys: ['gM'],
    label: 'submodules',
    description: 'Push the submodules view (#932). Lists every registered submodule with status / pinned commit / tracking branch / remote. Capital M disambiguates from the single-letter `m` (mark compare base).',
    contexts: ['normal'],
  },
  {
    id: 'navigateRemotes',
    keys: ['gn'],
    label: 'remotes',
    description: 'Push the remotes view (#0.71). Lists every configured remote with its fetch / push URLs and offers add / remove / set-url / prune actions. `n` for network/remotes; gr is already reflog.',
    contexts: ['normal'],
  },
  {
    id: 'navigateBlame',
    keys: ['b'],
    label: 'blame',
    description: 'Open the on-demand `git blame` drill-down for the cursored file (#0.71). Available on a file row in the status view (and on the worktree diff). Blame is loaded lazily and cached per path; j/k scrolls, esc returns. `b` is free in these contexts — elsewhere it pages / marks bad.',
    contexts: ['status', 'diff'],
  },
  {
    id: 'navigateFileHistory',
    keys: ['L'],
    label: 'file history',
    description: 'Open the file-history drill-down (`git log --follow`) for the cursored file. Tracks renames; j/k scrolls, Enter opens the diff, Esc returns.',
    contexts: ['status', 'diff', 'blame'],
  },
  {
    id: 'markForCompare',
    keys: ['m'],
    label: 'mark compare',
    description: 'Mark the cursored ref (branch / tag / commit) as the base for a compare-two-refs diff (#779). Press again on the same ref to clear; with a base set, Enter on another ref opens the compare diff.',
    contexts: ['commits'],
  },
  {
    id: 'navigateBack',
    keys: ['<', 'esc'],
    label: 'back',
    description: 'Pop the navigation stack and return to the previous view.',
    contexts: ['normal'],
  },
  {
    id: 'openSelected',
    keys: ['enter'],
    label: 'open',
    description: 'Open the diff for the selected commit (history) or file (status).',
    contexts: ['commits'],
  },
  {
    id: 'refresh',
    keys: ['r'],
    label: 'refresh',
    description: 'Refresh repository context and selected commit details.',
    contexts: ['normal'],
  },
  {
    id: 'revertSelection',
    keys: ['z'],
    label: 'revert',
    description: 'Ask to revert the selected file or hunk.',
    contexts: ['commits'],
  },
  {
    id: 'editCommit',
    keys: ['e'],
    label: 'edit commit',
    description: 'Edit the manual commit summary or body inline.',
    contexts: ['commits'],
  },
  {
    id: 'editCommitExternal',
    keys: ['E'],
    label: 'edit in $EDITOR',
    description: 'Open the current commit draft in $EDITOR (or $VISUAL) for full editing, write-back on save.',
    contexts: ['commits'],
  },
  {
    id: 'commitSplit',
    keys: ['S'],
    label: 'split commit',
    description: 'Generate a plan to split staged changes into multiple coherent commits; review and apply from an overlay.',
    contexts: ['commits'],
  },
  {
    id: 'commit',
    keys: ['c'],
    label: 'commit',
    description: 'Create a commit from staged changes with the current draft.',
    contexts: ['status', 'diff', 'compose'],
  },
  {
    id: 'cycleSort',
    keys: ['s'],
    label: 'sort',
    description: 'Cycle the sort mode in branches (name/recent/ahead) or tags (recent/name).',
    contexts: ['commits'],
  },
  {
    id: 'yankClipboard',
    keys: ['y', 'Y'],
    label: 'yank',
    description: 'Copy the cursored identifier (commit hash, branch shortName, stash ref, file path, or tag name) to the clipboard. Y yanks the short hash on history and commit-diff views.',
    contexts: ['commits'],
  },
  {
    id: 'help',
    keys: ['?'],
    label: 'help',
    description: 'Open or close the help panel.',
    contexts: ['normal'],
  },
  {
    id: 'commandPalette',
    keys: [':'],
    label: 'commands',
    description: 'Open the command palette for less common actions.',
    contexts: ['normal'],
  },
  {
    id: 'workflowDeleteBranch',
    keys: ['D'],
    label: 'delete branch',
    description: 'Delete the selected branch after confirmation.',
    contexts: ['normal', 'sidebar', 'detail'],
  },
  {
    id: 'workflowDeleteTag',
    keys: ['T'],
    label: 'delete tag',
    description: 'Delete the selected tag after confirmation.',
    contexts: ['normal', 'sidebar', 'detail'],
  },
  {
    id: 'workflowDropStash',
    keys: ['X'],
    label: 'drop stash',
    description: 'Drop the selected stash after confirmation.',
    contexts: ['normal', 'sidebar', 'detail'],
  },
  {
    id: 'workflowRemoveWorktree',
    keys: ['W'],
    label: 'remove worktree',
    description: 'Remove the selected linked worktree after confirmation.',
    contexts: ['normal', 'sidebar', 'detail'],
  },
  {
    id: 'workflowAbortOperation',
    keys: ['A'],
    label: 'abort operation',
    description: 'Abort the in-progress Git operation after confirmation.',
    contexts: ['normal', 'sidebar', 'detail'],
  },
  {
    id: 'workflowAiCommitSummary',
    keys: ['I'],
    label: 'AI commit summary',
    description: 'Summarize the selected commit with AI (token/cost awareness).',
    contexts: ['normal', 'sidebar', 'detail'],
  },
  {
    id: 'workflowAiConflictHelp',
    keys: ['M'],
    label: 'AI conflict help',
    description: 'Explain conflicted files and suggest resolution steps with AI.',
    contexts: ['normal', 'sidebar', 'detail'],
  },
  // ── History-view-only mutating bindings ───────────────────────────
  // These keys are dispatched contextually in inkInput.ts when the
  // user is on the history view. Documented as proper bindings here
  // so they show up in the "This view (history)" help section. The
  // descriptions match the workflow registry entries that actually
  // execute when the keys fire.
  {
    id: 'viewCherryPick',
    keys: ['c'],
    label: 'cherry-pick',
    description: 'Cherry-pick the cursored commit onto the current branch.',
    contexts: ['history'],
  },
  {
    id: 'viewRevert',
    keys: ['R'],
    label: 'revert commit',
    description: 'Revert the cursored commit (adds an inverse commit on HEAD).',
    contexts: ['history'],
  },
  {
    id: 'viewReset',
    keys: ['Z'],
    label: 'reset to commit',
    description: 'Move the branch tip to the cursored commit (prompts for soft/mixed/hard).',
    contexts: ['history'],
  },
  {
    id: 'viewFixup',
    keys: ['f'],
    label: 'fixup into commit',
    description: 'Commit the staged changes as a fixup! of the cursored commit; offers an immediate autosquash.',
    contexts: ['history'],
  },
  {
    id: 'viewInteractiveRebase',
    keys: ['i'],
    label: 'interactive rebase',
    description: 'Start an interactive rebase from the cursored commit.',
    contexts: ['history'],
  },
  {
    // #0.71 — branches-view-only. `r` rebases the current branch onto the
    // cursored branch / ref (non-interactive). Scoped to `branches` so it
    // doesn't collide with the global `r` refresh (context `normal`); the
    // resolver in inkInput intercepts it before the refresh path. The
    // most dangerous op in the release, so it routes through the
    // y-confirm gate with a warning naming both branches.
    id: 'viewRebaseOnto',
    keys: ['r'],
    label: 'rebase onto',
    description: 'Rebase the current branch onto the cursored branch / ref (non-interactive) after confirmation.',
    contexts: ['branches'],
  },
  {
    id: 'viewCreateBranchHere',
    keys: ['B'],
    label: 'create branch here',
    description: 'Create a branch at the cursored commit (does not switch).',
    contexts: ['history'],
  },
  {
    id: 'viewCreateTagHere',
    keys: ['gT'],
    label: 'create tag here',
    description: 'Create a lightweight tag at the cursored commit.',
    contexts: ['history'],
  },
  {
    id: 'viewKeys',
    keys: ['g?'],
    label: 'keys',
    description: 'Show the single-key actions available in the current view (which-key strip).',
    contexts: ['normal'],
  },
  {
    id: 'themePicker',
    keys: ['gC'],
    label: 'theme picker',
    description: 'Browse, live-preview, and apply a color theme.',
    contexts: ['normal'],
  },
  {
    id: 'openProjectConfig',
    keys: ['gk'],
    label: 'project config',
    description: 'Open this repo’s .coco.json in $EDITOR (creates a starter file if missing).',
    contexts: ['normal'],
  },
  {
    id: 'openGlobalConfig',
    keys: ['gK'],
    label: 'global config',
    description: 'Open ~/.config/coco/config.json in $EDITOR (creates a starter file if missing).',
    contexts: ['normal'],
  },
  {
    id: 'gitignoreFile',
    keys: ['i'],
    label: 'gitignore',
    description: 'Add the cursored file or folder to .gitignore (pick a pattern).',
    contexts: ['status'],
  },
  {
    id: 'stageAll',
    keys: ['A'],
    label: 'stage all',
    description: 'Stage every change in the worktree (git add -A).',
    contexts: ['status', 'compose'],
  },
  {
    id: 'stagePathspec',
    keys: ['+'],
    label: 'stage paths',
    description: 'Stage files matching a typed pathspec (. / src/ / *.ts / a list).',
    contexts: ['status', 'compose'],
  },
  {
    id: 'viewChangelog',
    keys: ['L'],
    label: 'changelog',
    description: 'Generate a changelog from the current view context.',
    contexts: ['history', 'branches'],
  },
  {
    id: 'quit',
    keys: ['q', 'ctrl+c'],
    label: 'quit',
    description: 'Quit the interactive log.',
    contexts: ['normal', 'search'],
  },
]

export type GetLogInkFooterHintsOptions = {
  activeView?: LogInkView
  /** Used to differentiate the diff-view hints between commit / worktree
   *  / stash sources without reaching into runtime state. */
  diffSource?: 'commit' | 'worktree' | 'stash' | 'compare'
  filterMode: boolean
  focus: LogInkFocus
  showHelp: boolean
  showCommandPalette?: boolean
  /**
   * Split-plan overlay state (#907 / #919). When `'ready'`, the footer
   * surfaces overlay-local bindings (y apply / r regen / esc cancel /
   * scroll keys) instead of the underlying compose-view hints — the
   * underlying view's keystrokes are all intercepted while the
   * overlay is open. `'loading'` and `'applying'` get simpler hints
   * since most keys are no-ops in those phases.
   */
  splitPlanStatus?: 'loading' | 'ready' | 'applying'
  /** Set when the user has pressed a chord prefix (e.g. `g`) and the
   * dispatcher is waiting for the second key. The footer surfaces the
   * available continuations inline as a fallback for the popup overlay. */
  pendingKey?: string
  /** Active sidebar tab — used to surface the per-tab in-sidebar ops
   *  (checkout / apply / pop / drop / etc.) when sidebar is focused. */
  sidebarTab?: 'status' | 'branches' | 'tags' | 'stashes' | 'worktrees'
  /** Item count for the active sidebar tab — empty content tabs fall
   *  back to the generic "enter open" hint instead of showing per-item
   *  ops the user cannot reach. */
  sidebarItemCount?: number
  /**
   * Current diff view rendering mode (#785). When set on the diff view
   * the footer surfaces `d split` / `d unified` so users see what `d`
   * will switch to.
   */
  diffViewMode?: 'unified' | 'split'
  /**
   * True when a compare base is set (#779). Compare-flow target views
   * (branches / tags / history) swap their `enter` hint to show
   * "enter compare" so users know the override is active. Also adds
   * "m clear" so they can bail out of the flow without remembering a
   * separate cancel key.
   */
  compareBaseSet?: boolean
  /**
   * True on narrow terminals where only one pane renders at a time
   * (sidebar / main / inspector, Tab-cycled). When set, the footer
   * prepends a pane switcher showing which pane is active so the user
   * keeps their orientation without the other two panes on screen. */
  singlePane?: boolean
  /**
   * True while the user is peeking the sidebar (#1135 v2) — a momentary
   * single-pane glance. The footer swaps the switcher for the snap-back
   * affordance (`v/esc → main`) since the user is mid-glance, not
   * navigating. */
  peeking?: boolean
}

export type LogInkChordContinuation = {
  /** Single character — the second key in the chord (e.g. `h` for `gh`). */
  key: string
  label: string
  description: string
}

/**
 * Surface the second-key continuations for a chord prefix (e.g. `g`)
 * as a flat list, sourced from the canonical keymap so the help, footer
 * hint, and which-key overlay all stay in sync. Continuations are sorted
 * by key for stable, scannable output.
 */
export function getLogInkChordContinuations(prefix: string): LogInkChordContinuation[] {
  const continuations: LogInkChordContinuation[] = []
  for (const binding of LOG_INK_KEY_BINDINGS) {
    for (const keys of binding.keys) {
      if (keys.length === 2 && keys.startsWith(prefix)) {
        continuations.push({
          key: keys.charAt(1),
          label: binding.label,
          description: binding.description,
        })
        break
      }
    }
  }
  return continuations.sort((a, b) => a.key.localeCompare(b.key))
}

/**
 * Footer hints split into two slots so the chrome can render them in
 * separate spans:
 *   `contextual` — what changes with mode, view, or focus.
 *   `global`     — persistent affordances (help · commands · quit).
 */
export type LogInkFooterHints = {
  contextual: string[]
  global: string[]
}

/**
 * Bindings considered "global" — always available regardless of which view
 * or pane has focus. Surfaced as a separate group in the help overlay and
 * always rendered in the footer's global slot.
 */
const GLOBAL_BINDING_IDS: LogInkCommandId[] = [
  'help',
  'commandPalette',
  'workflowDeleteBranch',
  'workflowDeleteTag',
  'workflowDropStash',
  'workflowRemoveWorktree',
  'workflowAbortOperation',
  'workflowAiCommitSummary',
  'workflowAiConflictHelp',
  'focusNext',
  'focusPrevious',
  'refresh',
  'quit',
  'navigateHome',
  'navigateStatus',
  'navigateDiff',
  'navigateCompose',
  'navigateBranches',
  'navigateTags',
  'navigateStash',
  'navigateWorktrees',
  'navigatePullRequest',
  'navigatePullRequestTriage',
  'navigateIssues',
  'navigateConflicts',
  'navigateReflog',
  'navigateBisect',
  'navigateBack',
]

const NORMAL_GLOBAL_HINTS = ['g jump', '< back', '? help', ': cmds', 'q quit']

/**
 * Narrow single-pane footer budget (#1135). On terminals below the
 * single-pane breakpoint the pane switcher (`tab: …`, ~29 cells) plus
 * the snap-back / peek affordance already claim most of an 80-cell row,
 * so the per-view hint tail and the global cluster are trimmed to what
 * fits without clipping — the switcher is the orientation anchor and
 * must stay whole. The dropped bindings remain one `?` (help) away.
 *
 *   - keep only the first view hint (the most actionable for the view)
 *   - shrink the global cluster to the two recovery essentials
 */
const SINGLE_PANE_GLOBAL_HINTS = ['? help', 'q quit']
const SINGLE_PANE_VIEW_HINT_LIMIT = 1

/**
 * Per-binding category mapping. Used to subdivide the help overlay's
 * Global and view sections into named clusters so users don't face a
 * 30-row wall of keys with no visual structure.
 *
 * Bindings without an explicit entry default to `'movement'` (for
 * commit-list / sidebar movement) or `'navigation'` (for globals).
 * The categorization is intentionally coarse — too many groups
 * fragments the help and forces users to remember a category
 * taxonomy on top of the bindings themselves.
 */
const BINDING_CATEGORY_BY_ID: Partial<Record<LogInkCommandId, LogInkBindingCategory>> = {
  // ── Essentials: most-used keys, surfaced first so newcomers see
  //    them above everything else.
  help: 'essentials',
  commandPalette: 'essentials',
  themePicker: 'view',
  openProjectConfig: 'view',
  openGlobalConfig: 'view',
  gitignoreFile: 'mutate',
  stageAll: 'mutate',
  stagePathspec: 'mutate',
  createStash: 'mutate',
  quit: 'essentials',
  refresh: 'essentials',
  navigateBack: 'essentials',
  // ── Navigation: focus + view jumps. The g-prefix navigation chords
  //    cluster here so users learn them as a set.
  focusNext: 'navigation',
  focusPrevious: 'navigation',
  navigateHome: 'navigation',
  navigateStatus: 'navigation',
  navigateDiff: 'navigation',
  navigateCompose: 'navigation',
  navigateBranches: 'navigation',
  navigateTags: 'navigation',
  navigateStash: 'navigation',
  navigateWorktrees: 'navigation',
  navigatePullRequest: 'navigation',
  navigatePullRequestTriage: 'navigation',
  navigateIssues: 'navigation',
  navigateConflicts: 'navigation',
  navigateReflog: 'navigation',
  navigateBisect: 'navigation',
  navigateSubmodules: 'navigation',
  navigateRemotes: 'navigation',
  // ── Movement: cursor movement + search navigation within a view.
  moveUp: 'movement',
  moveDown: 'movement',
  pageUp: 'movement',
  pageDown: 'movement',
  moveToTop: 'movement',
  moveToBottom: 'movement',
  nextMatch: 'movement',
  previousMatch: 'movement',
  nextHunk: 'movement',
  previousHunk: 'movement',
  nextSidebarTab: 'movement',
  previousSidebarTab: 'movement',
  // ── View: visual toggles + search/filter that change what's shown
  //    without mutating the repo.
  search: 'view',
  clearSearch: 'view',
  toggleGraph: 'view',
  toggleDiffViewMode: 'view',
  markForCompare: 'view',
  openSelected: 'view',
  cycleSort: 'view',
  yankClipboard: 'view',
  // ── Edit: compose-surface authoring keys.
  commit: 'edit',
  editCommit: 'edit',
  editCommitExternal: 'edit',
  commitSplit: 'edit',
  revertSelection: 'edit',
  // ── Mutate: destructive / AI workflows that fire from anywhere
  //    (hence the global confirmation gating).
  workflowDeleteBranch: 'mutate',
  workflowDeleteTag: 'mutate',
  workflowDropStash: 'mutate',
  workflowRemoveWorktree: 'mutate',
  workflowAbortOperation: 'mutate',
  workflowAiCommitSummary: 'mutate',
  workflowAiConflictHelp: 'mutate',
  // Branches-view-only rebase-onto (#0.71) — a confirmation-gated
  // destructive op, grouped with the global mutate cluster.
  viewRebaseOnto: 'mutate',
  // ── History actions: per-view-only mutations scoped to the history
  //    surface. Distinct from the global mutate cluster so users see
  //    them grouped under their actual context.
  viewCherryPick: 'history-actions',
  viewRevert: 'history-actions',
  viewReset: 'history-actions',
  viewInteractiveRebase: 'history-actions',
  viewCreateBranchHere: 'history-actions',
  viewCreateTagHere: 'history-actions',
  viewChangelog: 'history-actions',
}

/**
 * Display order + display title for each category in help sections.
 * The order is "what users reach for most often, first" — essentials
 * before everything, mutations last because they're confirmation-gated
 * power moves rather than everyday operations.
 */
const CATEGORY_ORDER: LogInkBindingCategory[] = [
  'essentials',
  'navigation',
  'movement',
  'view',
  'edit',
  'history-actions',
  'mutate',
]

const CATEGORY_TITLES: Record<LogInkBindingCategory, string> = {
  essentials: 'Essentials',
  navigation: 'Navigate',
  movement: 'Move',
  view: 'View & search',
  edit: 'Edit & compose',
  'history-actions': 'History actions',
  mutate: 'Workflows (confirm)',
}

function categorizeBinding(
  binding: LogInkKeyBinding,
  isGlobal: boolean
): LogInkBindingCategory {
  const explicit = BINDING_CATEGORY_BY_ID[binding.id]
  if (explicit) return explicit
  // Sensible defaults for any binding that hasn't been categorized
  // yet — globals fall into navigation, view-scoped fall into
  // movement. New bindings stay reachable in the help without
  // requiring a category entry up front.
  return isGlobal ? 'navigation' : 'movement'
}

function buildSubgroups(
  bindings: LogInkKeyBinding[],
  isGlobal: boolean
): LogInkHelpSubgroup[] {
  const buckets = new Map<LogInkBindingCategory, LogInkKeyBinding[]>()
  for (const binding of bindings) {
    const category = categorizeBinding(binding, isGlobal)
    const bucket = buckets.get(category)
    if (bucket) {
      bucket.push(binding)
    } else {
      buckets.set(category, [binding])
    }
  }

  const subgroups: LogInkHelpSubgroup[] = []
  for (const category of CATEGORY_ORDER) {
    const bucketBindings = buckets.get(category)
    if (bucketBindings && bucketBindings.length > 0) {
      subgroups.push({
        category,
        title: CATEGORY_TITLES[category],
        bindings: bucketBindings,
      })
    }
  }

  return subgroups
}

export function formatBindingKeys(binding: LogInkKeyBinding): string {
  return binding.keys.join('/')
}

/**
 * Render the navigation `viewStack` as a breadcrumb suitable for the
 * chrome header. A single-frame stack at the root view returns an empty
 * string so the header stays compact when nothing has been pushed.
 *
 * Examples:
 *   `[history]`             → ''
 *   `[history, diff]`       → 'history › diff'
 *   `[status, diff]`        → 'status › diff'
 *   `[history, diff, status]` → 'history › diff › status'
 */
export function formatLogInkBreadcrumb(viewStack: LogInkView[]): string {
  if (viewStack.length === 0) {
    return ''
  }

  if (viewStack.length === 1 && viewStack[0] === 'history') {
    return ''
  }

  // Pure location breadcrumb — no trailing back-hint. The footer's
  // global `< back` hint already names the walk-back key, so repeating
  // `← <` on every nested view was redundant header chrome (TUI audit).
  return viewStack.join(' › ')
}

/**
 * Render the nested-repo navigation stack (#931) as a breadcrumb suitable
 * for the chrome header. Returns an empty string for a root-only stack
 * so the header stays compact when nothing has been pushed.
 *
 * The trailing `← esc` reminds the user that Esc (not `<`) pops the
 * repo stack — a distinct key from the footer's global `< back`, so
 * unlike the view breadcrumb (pure location) the repo crumb keeps its
 * hint. The repo breadcrumb shows in addition to the view breadcrumb when
 * both stacks are non-trivial; the chrome layer is responsible for
 * laying them out side by side.
 *
 * Examples:
 *   `[root]`                     → ''
 *   `[coco, vendor/lib]`         → 'coco › vendor/lib   ← esc'
 *   `[coco, vendor/lib, deep]`   → 'coco › vendor/lib › deep   ← esc'
 */
export function formatLogInkRepoBreadcrumb(repoStack: ReadonlyArray<{ label: string }>): string {
  if (repoStack.length <= 1) {
    return ''
  }
  return `${repoStack.map((frame) => frame.label).join(' › ')}   ← esc`
}

/**
 * Combine the repo-stack and view-stack breadcrumb segments for the
 * header chrome (#931). Each segment is independently rendered by its
 * formatter and may be empty; this helper interleaves the leading
 * spacing so the header builder doesn't have to branch on four cases.
 *
 *   repoCrumb=''       viewCrumb=''       → ''
 *   repoCrumb='X'      viewCrumb=''       → '  X'
 *   repoCrumb=''       viewCrumb='Y'      → '  Y'
 *   repoCrumb='X'      viewCrumb='Y'      → '  X    Y'
 *
 * Two leading spaces match the existing chrome — they separate the
 * breadcrumb from the trailing repo/branch segment in the title row.
 * Four spaces between segments give the repo crumb visual breathing
 * room before the view crumb begins.
 */
export function combineLogInkBreadcrumbSegments(repoCrumb: string, viewCrumb: string): string {
  if (repoCrumb && viewCrumb) {
    return `  ${repoCrumb}    ${viewCrumb}`
  }
  if (repoCrumb) {
    return `  ${repoCrumb}`
  }
  if (viewCrumb) {
    return `  ${viewCrumb}`
  }
  return ''
}

/**
 * Single-pane pane switcher hint, e.g. `tab: [sidebar] main inspector`.
 * The active pane (derived from focus: sidebar → sidebar, detail →
 * inspector, otherwise main) is bracketed so the user can see which of
 * the three panes Tab will move them away from. Surfaced only on narrow
 * terminals where the other two panes aren't on screen.
 */
function singlePaneSwitcherHint(focus: LogInkFocus): string {
  const active: LogInkVisiblePane =
    focus === 'sidebar' ? 'sidebar' : focus === 'detail' ? 'inspector' : 'main'
  const label = (pane: LogInkVisiblePane) => (pane === active ? `[${pane}]` : pane)
  return `tab: ${label('sidebar')} ${label('main')} ${label('inspector')}`
}

export function getLogInkFooterHints(options: GetLogInkFooterHintsOptions): LogInkFooterHints {
  const hints = computeLogInkFooterHints(options)
  // While peeking the sidebar (#1135 v2) the footer shows the snap-back
  // affordance instead of the switcher — the user is mid-glance, not
  // navigating, so `v`/Esc returning to main is the relevant action. The
  // view-hint tail + globals are trimmed to fit the narrow row (see
  // SINGLE_PANE_GLOBAL_HINTS).
  if (options.peeking) {
    return {
      contextual: ['v/esc → main', ...hints.contextual.slice(0, SINGLE_PANE_VIEW_HINT_LIMIT)],
      global: SINGLE_PANE_GLOBAL_HINTS,
    }
  }
  // On narrow terminals only one pane is on screen, so prepend a Tab
  // pane switcher for orientation. The caller (footer) only sets
  // `singlePane` in the plain per-pane states — while an overlay or
  // filter owns the screen the visible pane is forced (or input is
  // captured) and Tab does something else, so the switcher is
  // suppressed there to avoid showing a pane that isn't active. From the
  // main / inspector pane we also surface `v peek` so the momentary
  // sidebar glance is discoverable. The full per-view hint cluster +
  // global cluster don't fit alongside the switcher at the 80-col floor,
  // so both are trimmed (the dropped keys stay reachable via `?`).
  if (options.singlePane) {
    const lead =
      options.focus === 'sidebar'
        ? [singlePaneSwitcherHint(options.focus)]
        : [singlePaneSwitcherHint(options.focus), 'v peek']
    return {
      contextual: [...lead, ...hints.contextual.slice(0, SINGLE_PANE_VIEW_HINT_LIMIT)],
      global: SINGLE_PANE_GLOBAL_HINTS,
    }
  }
  return hints
}

function computeLogInkFooterHints(options: GetLogInkFooterHintsOptions): LogInkFooterHints {
  if (options.pendingKey) {
    const continuations = getLogInkChordContinuations(options.pendingKey)
    if (continuations.length > 0) {
      return {
        contextual: [
          `${options.pendingKey} …`,
          ...continuations.map((entry) => `${entry.key} ${entry.label}`),
        ],
        global: ['esc cancel'],
      }
    }
  }

  if (options.filterMode) {
    return {
      contextual: ['enter apply', 'esc cancel', 'ctrl+u clear'],
      global: ['q quit'],
    }
  }

  if (options.showHelp) {
    return {
      contextual: ['? close', 'tab focus', '/ search'],
      global: ['q quit'],
    }
  }

  if (options.showCommandPalette) {
    return {
      contextual: [': close', 'D/T/X confirm', 'I/M AI'],
      global: ['? help', 'q quit'],
    }
  }

  // Split-plan overlay claims the footer while open — the underlying
  // view's keystrokes are intercepted, so surfacing them would be
  // misleading. Each phase gets its own hint set since most keys
  // no-op during loading / applying.
  if (options.splitPlanStatus === 'ready') {
    return {
      contextual: [
        '↑/↓ scroll',
        'pg up/dn',
        'g/G top/bot',
        'y apply',
        'r regen',
        'esc cancel',
      ],
      global: ['q quit'],
    }
  }
  if (options.splitPlanStatus === 'loading') {
    return {
      contextual: ['generating plan…', 'esc cancel'],
      global: ['q quit'],
    }
  }
  if (options.splitPlanStatus === 'applying') {
    return {
      contextual: ['applying split…'],
      global: ['q quit'],
    }
  }

  if (options.focus === 'sidebar') {
    // Per-tab hints when the active tab has selectable items — the user
    // can act on the cursored entity without leaving the workstation
    // view. Status tab + empty content tabs fall back to the generic
    // "enter open" hint that drills into the dedicated view.
    const itemsPresent = (options.sidebarItemCount ?? 0) > 0
    if (itemsPresent && options.sidebarTab === 'branches') {
      // P / U / F fire the global pull-current-branch, push-current-branch,
      // fetch-remotes workflows — already implemented, just not visible in
      // the footer before. Surfacing them here matters because the user's
      // attention is on a branch when the branches sidebar is focused;
      // pull / push / fetch are the next obvious actions.
      //
      // Note: `U` and `P` currently operate on the CURRENT branch, not the
      // cursored one. Task #5 will extend them to act on the cursored row;
      // until then the labels read as "current-branch ops" by virtue of
      // matching the workflow descriptions.
      return {
        contextual: [
          '↑/↓ branches', '←/→ tab', 'enter checkout',
          'F fetch', 'U pull', 'P push',
          'D delete', 'R rename', 'u upstream',
        ],
        global: NORMAL_GLOBAL_HINTS,
      }
    }
    if (itemsPresent && options.sidebarTab === 'stashes') {
      return {
        contextual: ['↑/↓ stashes', '←/→ tab', 'enter diff', 'a apply', 'p pop', 'X drop'],
        global: NORMAL_GLOBAL_HINTS,
      }
    }
    if (itemsPresent && options.sidebarTab === 'tags') {
      return {
        contextual: ['↑/↓ tags', '←/→ tab', '+ new', 'P push', 'T delete'],
        global: NORMAL_GLOBAL_HINTS,
      }
    }
    if (itemsPresent && options.sidebarTab === 'worktrees') {
      return {
        contextual: ['↑/↓ worktrees', '←/→ tab', 'W remove'],
        global: NORMAL_GLOBAL_HINTS,
      }
    }
    return {
      contextual: ['←/→ tab', '1-5 jump', 'enter open', 'tab focus'],
      global: NORMAL_GLOBAL_HINTS,
    }
  }

  if (options.focus === 'detail') {
    return {
      contextual: ['↑/↓ files', 'pgup/pgdn diff', 'tab focus'],
      global: NORMAL_GLOBAL_HINTS,
    }
  }

  if (options.activeView === 'status') {
    return {
      contextual: ['↑/↓ files', 'enter hunks', 'space stage', 'A stage all', 'z revert', 'e/c compose'],
      global: NORMAL_GLOBAL_HINTS,
    }
  }

  if (options.activeView === 'diff') {
    // Surface what `d` will switch *to* — labels the next mode rather
    // than the current one so the hint reads as a verb. The split-mode
    // hint is only shown for the read-only diff sources (commit/stash);
    // the worktree diff stays unified-only for now.
    const splitToggleHint = options.diffViewMode === 'split' ? 'd unified' : 'd split'
    if (options.diffSource === 'stash') {
      return {
        contextual: ['j/k lines', '[/] file', 'c cherry-pick', 'H apply hunk', splitToggleHint, 'esc back'],
        global: NORMAL_GLOBAL_HINTS,
      }
    }
    if (options.diffSource === 'commit') {
      // Commit-diff explore: read-only diff, but `c` cherry-picks the
      // cursored file from the commit into the worktree, and `H`
      // (or `gH` for index) applies just the cursored hunk. `j/k`
      // line-scroll the diff body; `[`/`]` jump between hunks — the
      // footer labels match the actual handlers (commit diff has no
      // per-file `[/]` jump; that's the stash diff).
      return {
        contextual: ['j/k lines', '[/] hunk', 'c cherry-pick', 'H apply hunk', splitToggleHint, 'esc back'],
        global: NORMAL_GLOBAL_HINTS,
      }
    }
    if (options.diffSource === 'compare') {
      // Compare-two-refs (#779): read-only diff with no per-file
      // cherry-pick or hunk apply (those don't make sense across
      // arbitrary refs). Just scroll + back out.
      return {
        contextual: ['j/k lines', splitToggleHint, 'esc back'],
        global: NORMAL_GLOBAL_HINTS,
      }
    }
    // Worktree (staging) diff. Consistent with the commit/stash diffs
    // (#1185): j/k scroll lines, [/] jump between hunks. space stages /
    // unstages the hunk under the viewport, a stages the whole file, z
    // discards the current hunk.
    return {
      contextual: ['j/k lines', '[/] hunk', 'space stage', 'a stage file', 'z discard', 'o edit', 'esc back'],
      global: NORMAL_GLOBAL_HINTS,
    }
  }

  if (options.activeView === 'compose') {
    return {
      contextual: ['e edit', 'c commit', 'A stage all', '+ stage…', 'S split', 'I AI draft', 'esc back'],
      global: NORMAL_GLOBAL_HINTS,
    }
  }

  if (options.activeView === 'branches') {
    if (options.compareBaseSet) {
      return {
        contextual: ['↑/↓ branches', 'enter compare', 'm clear', 'esc back'],
        global: NORMAL_GLOBAL_HINTS,
      }
    }
    return {
      contextual: ['↑/↓ branches', 'enter checkout', '+ new', 'D delete', 'r rebase', 'm compare', 's sort', 'y yank'],
      global: NORMAL_GLOBAL_HINTS,
    }
  }

  if (options.activeView === 'tags') {
    if (options.compareBaseSet) {
      return {
        contextual: ['↑/↓ tags', 'enter compare', 'm clear', 'esc back'],
        global: NORMAL_GLOBAL_HINTS,
      }
    }
    return {
      contextual: ['↑/↓ tags', '+ new', 'P push', 'T delete', 'm compare', 's sort', 'y yank'],
      global: NORMAL_GLOBAL_HINTS,
    }
  }

  if (options.activeView === 'stash') {
    return {
      contextual: ['↑/↓ stashes', 'enter diff', 'a/A apply', 'p pop', 'R rename', 'b branch', 'X drop · u undo'],
      global: NORMAL_GLOBAL_HINTS,
    }
  }

  if (options.activeView === 'worktrees') {
    return {
      contextual: ['↑/↓ worktrees', 'W remove', 'esc back'],
      global: NORMAL_GLOBAL_HINTS,
    }
  }

  if (options.activeView === 'pull-request') {
    return {
      // #783 — full PR action panel. Five mutating ops scoped to this
      // view: m / x / a / R / c, plus O for open-in-browser (already
      // a global). Each routes through y-confirm or an input prompt;
      // none fire silently.
      contextual: ['m merge', 'x close', 'a approve', 'R changes', 'c comment', 'O open', 'esc back'],
      global: NORMAL_GLOBAL_HINTS,
    }
  }

  if (options.activeView === 'conflicts') {
    return {
      contextual: ['↑/↓ files', 'enter diff', 's stage', 'u incoming', 'U yours', 'o edit', 'C continue*', 'esc back'],
      global: NORMAL_GLOBAL_HINTS,
    }
  }

  if (options.activeView === 'reflog') {
    return {
      contextual: ['↑/↓ entries', 'enter inspect', 'c checkout', 'B branch', 'Z reset', 'esc back'],
      global: NORMAL_GLOBAL_HINTS,
    }
  }

  if (options.activeView === 'issues') {
    return {
      // #882 phase 4-6 — read + additive mutations + destructive
      // (gated through y-confirm) + filter cycling. AI summarize
      // (`I`) deferred to a follow-up.
      contextual: ['↑/↓ issues', 'f filter', 'O open', 'y yank URL', 'c comment', 'L label', 'A assign', 'x close*', 'X reopen', 'esc back'],
      global: NORMAL_GLOBAL_HINTS,
    }
  }

  if (options.activeView === 'pull-request-triage') {
    return {
      // #882 phase 4-6 — full PR action panel scoped to the triage
      // list + filter cycling. AI summarize (`I`) deferred to a
      // follow-up.
      contextual: ['↑/↓ PRs', 'f filter', 'O open', 'y yank URL', 'c comment', 'L label', 'A assign', 'm merge*', 'x close*', 'a approve', 'R changes*', 'esc back'],
      global: NORMAL_GLOBAL_HINTS,
    }
  }

  if (options.activeView === 'submodules') {
    return {
      contextual: ['↑/↓ entries', 'i init', 'u update', 's sync', 'y yank path', 'Y yank sha', '/ filter', 'esc back'],
      global: NORMAL_GLOBAL_HINTS,
    }
  }

  if (options.activeView === 'remotes') {
    return {
      // #0.71 — remote management. add / set-url prompt for input
      // (the prompt is the gate); remove / prune route through the
      // y-confirm path (`*` marks the destructive ones).
      contextual: ['↑/↓ remotes', 'a add', 'e set-url', 'x remove*', 'p prune*', 'y yank url', '/ filter', 'esc back'],
      global: NORMAL_GLOBAL_HINTS,
    }
  }

  if (options.activeView === 'blame') {
    return {
      // #0.71 — on-demand blame drill-down. Read-only: j/k scroll the
      // windowed line list, esc pops back to the file list.
      // #COCO-14 — L drills from blame into the file-history log.
      contextual: ['↑/↓ lines', 'gg/G top/bottom', 'L file log', 'esc back'],
      global: NORMAL_GLOBAL_HINTS,
    }
  }

  if (options.activeView === 'file-history') {
    return {
      // #COCO-14 — file-history drill-down. j/k scroll the commit list,
      // enter opens the diff for the cursored commit, esc returns.
      contextual: ['↑/↓ commits', 'gg/G top/bottom', 'enter diff', 'esc back'],
      global: NORMAL_GLOBAL_HINTS,
    }
  }

  if (options.activeView === 'bisect') {
    return {
      contextual: ['g good', 'b bad', 's skip', 'R run', 'x reset', 'esc back'],
      global: NORMAL_GLOBAL_HINTS,
    }
  }

  if (options.activeView === 'changelog') {
    return {
      contextual: ['j/k scroll', 'pg up/dn', 'y yank', 'E $EDITOR', 'c PR', 'r regen', '< back'],
      global: NORMAL_GLOBAL_HINTS,
    }
  }

  if (options.compareBaseSet) {
    // History view with a compare base set — Enter is overridden to
    // open the compare diff; show the override + the bail-out key.
    // Mutate / new chips are dropped so the footer doesn't compete
    // with the active workflow.
    return {
      contextual: ['↑/↓ move', 'enter compare', 'm clear', 'esc back'],
      global: NORMAL_GLOBAL_HINTS,
    }
  }

  return {
    // History view default hints. Mutating ops (`c` cherry-pick, `R`
    // revert, `Z` reset, `i` interactive-rebase) all route through a
    // y-confirm or mode prompt — none fire silently from the keystroke.
    // `B` create-branch-here and `gT` create-tag-here use a prompt as
    // the affirmative gate (typing the name is the confirmation).
    // Grouped into compact `c/R/Z/i mutate` and `B/gT new` chips so
    // the footer stays scannable; full descriptions live in `?` help
    // and the palette.
    contextual: ['↑/↓ move', 'enter diff', 'c/R/Z/i mutate', 'f fixup', 'B/gT new', 'm compare', 'y/Y yank', '/ search'],
    global: NORMAL_GLOBAL_HINTS,
  }
}

export type GetLogInkHelpSectionsOptions = {
  activeView: LogInkView
  focus: LogInkFocus
}

function bindingMatchesViewContext(
  binding: LogInkKeyBinding,
  options: GetLogInkHelpSectionsOptions
): boolean {
  if (binding.contexts.includes(options.focus)) {
    return true
  }

  if (binding.contexts.includes(options.activeView)) {
    return true
  }

  if (binding.contexts.includes('normal')) {
    return true
  }

  return false
}

/**
 * Help bindings grouped for the persistent help overlay.
 *
 * Returns two top-level groups:
 *   - `Global` — bindings that work from any view or focus.
 *   - `This view (...)` — bindings relevant to the current view + focus.
 *
 * The active-view label is appended so users always know which section
 * applies to where they currently are.
 */
export function getLogInkHelpSections(
  options: GetLogInkHelpSectionsOptions
): LogInkHelpSection[] {
  const globals = LOG_INK_KEY_BINDINGS.filter((binding) =>
    GLOBAL_BINDING_IDS.includes(binding.id)
  )

  const viewBindings = LOG_INK_KEY_BINDINGS.filter((binding) =>
    !GLOBAL_BINDING_IDS.includes(binding.id) && bindingMatchesViewContext(binding, options)
  )

  return [
    {
      title: 'Global',
      bindings: globals,
      subgroups: buildSubgroups(globals, true),
    },
    {
      title: `This view (${options.activeView})`,
      bindings: viewBindings,
      subgroups: buildSubgroups(viewBindings, false),
    },
  ]
}

/**
 * True when a key string is a single, bare printable key (e.g. `c`, `R`,
 * `[`) rather than a chord (`gh`, `gg`) or a named special key (`up`,
 * `page down`). Used by the which-key view-keys strip, which surfaces only
 * the single-key overloads — the chord set already has its own overlay.
 */
function isBareSingleKey(key: string): boolean {
  return key.length === 1 && key !== ' '
}

/**
 * Single-key bindings available in the current view (#1137). Powers the
 * `g?` which-key strip: the per-view counterpart to the `g`-chord overlay.
 *
 * Sourced entirely from `LOG_INK_KEY_BINDINGS` (no duplicated key data) and
 * filtered the same way the help overlay's "This view" section is — by
 * `contexts` against the active view + focus — then narrowed to bindings
 * that expose at least one bare single key. Globals (`q`, `?`, `/`, `:`, …)
 * are excluded: they're always available and already live in the footer and
 * onboarding tour, so the strip stays focused on the deliberate per-view
 * overloads (`c`, `R`, `a`, `m`, `S`, `[`/`]`, …) the keymap guard protects.
 *
 * Sorted by the first bare key for stable, scannable output.
 */
export function getLogInkViewKeyBindings(
  options: GetLogInkHelpSectionsOptions
): LogInkKeyBinding[] {
  return LOG_INK_KEY_BINDINGS
    .filter((binding) =>
      !GLOBAL_BINDING_IDS.includes(binding.id) &&
      bindingMatchesViewContext(binding, options) &&
      binding.keys.some(isBareSingleKey)
    )
    .sort((a, b) => {
      const aKey = a.keys.find(isBareSingleKey) ?? ''
      const bKey = b.keys.find(isBareSingleKey) ?? ''
      return aKey.localeCompare(bKey)
    })
}

/**
 * Format only the bare single keys of a binding for the view-keys strip
 * (e.g. `['up', 'k']` → `k`). Named/chord keys are dropped — the strip is
 * about the single-key affordance, and the full key list lives in `?` help.
 */
export function formatBindingBareKeys(binding: LogInkKeyBinding): string {
  return binding.keys.filter(isBareSingleKey).join(' / ')
}

export function getLogInkCommandPaletteItems(): LogInkCommandPaletteItem[] {
  return LOG_INK_KEY_BINDINGS.map((binding) => ({
    id: binding.id,
    keys: formatBindingKeys(binding),
    label: binding.label,
    description: binding.description,
  }))
}

/**
 * Unified palette command type — covers both keybinding-derived commands
 * (`'binding'`) and workflow actions (`'workflow'`). The palette renderer
 * iterates these and the executor dispatches the right events for each.
 */
export type LogInkPaletteCommandKind = 'binding' | 'workflow'

export type LogInkPaletteCommand = {
  id: string
  kind: LogInkPaletteCommandKind
  keys: string
  label: string
  description: string
  workflowKind?: LogInkWorkflowActionKind
  requiresConfirmation?: boolean
}

function bindingToPaletteCommand(binding: LogInkKeyBinding): LogInkPaletteCommand {
  return {
    id: binding.id,
    kind: 'binding',
    keys: formatBindingKeys(binding),
    label: binding.label,
    description: binding.description,
  }
}

function workflowToPaletteCommand(action: LogInkWorkflowAction): LogInkPaletteCommand {
  return {
    id: action.id,
    kind: 'workflow',
    keys: action.key,
    label: action.label,
    description: action.description,
    workflowKind: action.kind,
    requiresConfirmation: action.requiresConfirmation,
  }
}

/**
 * The full palette command set: every keybinding plus every workflow
 * action. Phase 6 onwards, both surfaces are filterable and executable
 * from `:`.
 */
export function getLogInkPaletteCommands(): LogInkPaletteCommand[] {
  return [
    ...LOG_INK_KEY_BINDINGS.map(bindingToPaletteCommand),
    ...getLogInkWorkflowActions().map(workflowToPaletteCommand),
  ]
}

function paletteSearchableFields(command: LogInkPaletteCommand): string[] {
  return [command.label, command.description, command.keys, command.id]
}

function scorePaletteCommand(command: LogInkPaletteCommand, term: string): number | undefined {
  const normalized = term.trim().toLowerCase()
  if (!normalized) {
    return 0
  }

  let best: number | undefined
  for (const raw of paletteSearchableFields(command)) {
    const value = raw.toLowerCase()

    if (value === normalized) {
      return 1000
    }

    if (value.startsWith(normalized)) {
      const fieldScore = 800 - Math.min(value.length - normalized.length, 200)
      best = best === undefined ? fieldScore : Math.max(best, fieldScore)
      continue
    }

    const substringIndex = value.indexOf(normalized)
    if (substringIndex >= 0) {
      const fieldScore = 600 - Math.min(substringIndex, 200)
      best = best === undefined ? fieldScore : Math.max(best, fieldScore)
      continue
    }
  }

  if (best !== undefined) {
    return best
  }

  // Loose character-subsequence fallback, LABEL ONLY. Running it across
  // every searchable field (descriptions especially) made short queries
  // match most of the registry — "changel" pulled in yank, submodules,
  // and "Request changes" because their long descriptions happened to
  // contain those seven letters in order somewhere. The label is short
  // enough that a scattered-letter match still reads as intentional.
  const label = command.label.toLowerCase()
  let searchIndex = 0
  let distance = 0

  for (const character of normalized) {
    const nextIndex = label.indexOf(character, searchIndex)
    if (nextIndex < 0) {
      return undefined
    }
    distance += nextIndex - searchIndex
    searchIndex = nextIndex + 1
  }

  return 300 - Math.min(distance, 200)
}

/**
 * Filter and sort the palette command list by user query.
 *   - Empty filter: float `recent` IDs to the top, preserve registry order
 *     for everything else.
 *   - Non-empty filter: fuzzy score, descending; ties broken by registry
 *     order. Commands that don't match are dropped.
 */
export function filterLogInkPaletteCommands(
  commands: LogInkPaletteCommand[],
  filter: string,
  recent: string[]
): LogInkPaletteCommand[] {
  if (!filter.trim()) {
    if (recent.length === 0) {
      return [...commands]
    }
    const recentIndex = new Map(recent.map((id, index) => [id, index]))
    const recentCommands: LogInkPaletteCommand[] = []
    const others: LogInkPaletteCommand[] = []
    for (const command of commands) {
      if (recentIndex.has(command.id)) {
        recentCommands.push(command)
      } else {
        others.push(command)
      }
    }
    recentCommands.sort((a, b) => (recentIndex.get(a.id) || 0) - (recentIndex.get(b.id) || 0))
    return [...recentCommands, ...others]
  }

  return commands
    .map((command, index) => ({
      command,
      index,
      score: scorePaletteCommand(command, filter),
    }))
    .filter((entry): entry is { command: LogInkPaletteCommand; index: number; score: number } =>
      entry.score !== undefined
    )
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.command)
}
