import { LogInkFocus, LogInkView } from './inkViewModel'
import type { LogInkVisiblePane } from '../chrome/layout'
import { getBisectFooterHints } from '../surfaces/bisect/input'
import {
    LogInkWorkflowAction,
    LogInkWorkflowActionKind,
    getLogInkWorkflowActions,
} from './inkWorkflows'
import { en } from '../../lib/i18n/en'
import { t } from '../../lib/i18n/t'

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
  // #1447 registry backfill — per-view-context command ids
  | 'workflowApplyStash'
  | 'workflowPopStash'
  | 'workflowApplyStashIndex'
  | 'workflowRenameStash'
  | 'workflowStashBranch'
  | 'workflowUndoDropStash'
  | 'workflowUndoLastAction'
  | 'workflowPushTag'
  | 'workflowDeleteRemoteTag'
  | 'workflowResolveOurs'
  | 'workflowResolveTheirs'
  | 'workflowResolveStage'
  | 'workflowContinueOperation'
  | 'workflowBisectGood'
  | 'workflowBisectBad'
  | 'workflowBisectSkip'
  | 'workflowBisectReset'
  | 'workflowBisectRun'
  | 'workflowCheckoutReflog'
  | 'workflowRemoteAdd'
  | 'workflowRemoteSetUrl'
  | 'workflowRemoteRemove'
  | 'workflowRemotePrune'
  | 'workflowSubmoduleInit'
  | 'workflowSubmoduleUpdate'
  | 'workflowSubmoduleSync'
  | 'workflowTriagePrCheckout'
  | 'workflowTriagePrOpen'
  | 'workflowTriageIssueOpen'
  | 'workflowRemoveWorktreeAndBranch'

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
    label: t(en, 'keymap.binding.moveUp.label'),
    description: t(en, 'keymap.binding.moveUp.desc'),
    contexts: ['normal', 'commits', 'sidebar'],
  },
  {
    id: 'moveDown',
    keys: ['down', 'j'],
    label: t(en, 'keymap.binding.moveDown.label'),
    description: t(en, 'keymap.binding.moveDown.desc'),
    contexts: ['normal', 'commits', 'sidebar'],
  },
  {
    id: 'pageUp',
    keys: ['page up'],
    label: t(en, 'keymap.binding.pageUp.label'),
    description: t(en, 'keymap.binding.pageUp.desc'),
    contexts: ['commits'],
  },
  {
    id: 'pageDown',
    keys: ['page down'],
    label: t(en, 'keymap.binding.pageDown.label'),
    description: t(en, 'keymap.binding.pageDown.desc'),
    contexts: ['commits'],
  },
  {
    id: 'moveToTop',
    keys: ['gg'],
    label: t(en, 'keymap.binding.moveToTop.label'),
    description: t(en, 'keymap.binding.moveToTop.desc'),
    contexts: ['commits'],
  },
  {
    id: 'moveToBottom',
    keys: ['G'],
    label: t(en, 'keymap.binding.moveToBottom.label'),
    description: t(en, 'keymap.binding.moveToBottom.desc'),
    contexts: ['commits'],
  },
  {
    id: 'nextMatch',
    keys: ['n'],
    label: t(en, 'keymap.binding.nextMatch.label'),
    description: t(en, 'keymap.binding.nextMatch.desc'),
    contexts: ['commits'],
  },
  {
    id: 'previousMatch',
    keys: ['N'],
    label: t(en, 'keymap.binding.previousMatch.label'),
    description: t(en, 'keymap.binding.previousMatch.desc'),
    contexts: ['commits'],
  },
  {
    id: 'previousSidebarTab',
    keys: ['['],
    label: t(en, 'keymap.binding.previousSidebarTab.label'),
    description: t(en, 'keymap.binding.previousSidebarTab.desc'),
    contexts: ['sidebar'],
  },
  {
    id: 'nextSidebarTab',
    keys: [']'],
    label: t(en, 'keymap.binding.nextSidebarTab.label'),
    description: t(en, 'keymap.binding.nextSidebarTab.desc'),
    contexts: ['sidebar'],
  },
  {
    id: 'previousHunk',
    keys: ['['],
    label: t(en, 'keymap.binding.previousHunk.label'),
    description: t(en, 'keymap.binding.previousHunk.desc'),
    contexts: ['commits'],
  },
  {
    id: 'nextHunk',
    keys: [']'],
    label: t(en, 'keymap.binding.nextHunk.label'),
    description: t(en, 'keymap.binding.nextHunk.desc'),
    contexts: ['commits'],
  },
  {
    id: 'focusNext',
    keys: ['tab'],
    label: t(en, 'keymap.binding.focusNext.label'),
    description: t(en, 'keymap.binding.focusNext.desc'),
    contexts: ['normal'],
  },
  {
    id: 'focusPrevious',
    keys: ['shift+tab'],
    label: t(en, 'keymap.binding.focusPrevious.label'),
    description: t(en, 'keymap.binding.focusPrevious.desc'),
    contexts: ['normal'],
  },
  {
    id: 'search',
    keys: ['/'],
    label: t(en, 'keymap.binding.search.label'),
    description: t(en, 'keymap.binding.search.desc'),
    contexts: ['normal'],
  },
  {
    id: 'clearSearch',
    keys: ['ctrl+u'],
    label: t(en, 'keymap.binding.clearSearch.label'),
    description: t(en, 'keymap.binding.clearSearch.desc'),
    contexts: ['search'],
  },
  {
    id: 'toggleGraph',
    keys: ['\\'],
    label: t(en, 'keymap.binding.toggleGraph.label'),
    description: t(en, 'keymap.binding.toggleGraph.desc'),
    contexts: ['normal', 'commits'],
  },
  {
    id: 'toggleDiffViewMode',
    keys: ['d'],
    label: t(en, 'keymap.binding.toggleDiffViewMode.label'),
    description: t(en, 'keymap.binding.toggleDiffViewMode.desc'),
    contexts: ['commits'],
  },
  {
    id: 'navigateHome',
    keys: ['gh'],
    label: t(en, 'keymap.binding.navigateHome.label'),
    description: t(en, 'keymap.binding.navigateHome.desc'),
    contexts: ['normal'],
  },
  {
    id: 'navigateStatus',
    keys: ['gs'],
    label: t(en, 'keymap.binding.navigateStatus.label'),
    description: t(en, 'keymap.binding.navigateStatus.desc'),
    contexts: ['normal'],
  },
  {
    id: 'navigateDiff',
    keys: ['gd'],
    label: t(en, 'keymap.binding.navigateDiff.label'),
    description: t(en, 'keymap.binding.navigateDiff.desc'),
    contexts: ['normal'],
  },
  {
    id: 'navigateCompose',
    keys: ['gc'],
    label: t(en, 'keymap.binding.navigateCompose.label'),
    description: t(en, 'keymap.binding.navigateCompose.desc'),
    contexts: ['normal'],
  },
  {
    id: 'navigateBranches',
    keys: ['gb'],
    label: t(en, 'keymap.binding.navigateBranches.label'),
    description: t(en, 'keymap.binding.navigateBranches.desc'),
    contexts: ['normal'],
  },
  {
    id: 'navigateTags',
    keys: ['gt'],
    label: t(en, 'keymap.binding.navigateTags.label'),
    description: t(en, 'keymap.binding.navigateTags.desc'),
    contexts: ['normal'],
  },
  {
    id: 'navigateStash',
    keys: ['gz'],
    label: t(en, 'keymap.binding.navigateStash.label'),
    description: t(en, 'keymap.binding.navigateStash.desc'),
    contexts: ['normal'],
  },
  {
    id: 'createStash',
    keys: ['gZ'],
    label: t(en, 'keymap.binding.createStash.label'),
    description: t(en, 'keymap.binding.createStash.desc'),
    contexts: ['normal'],
  },
  {
    id: 'navigateWorktrees',
    keys: ['gw'],
    label: t(en, 'keymap.binding.navigateWorktrees.label'),
    description: t(en, 'keymap.binding.navigateWorktrees.desc'),
    contexts: ['normal'],
  },
  {
    id: 'navigatePullRequest',
    keys: ['gp'],
    label: t(en, 'keymap.binding.navigatePullRequest.label'),
    description: t(en, 'keymap.binding.navigatePullRequest.desc'),
    contexts: ['normal'],
  },
  {
    id: 'navigatePullRequestTriage',
    keys: ['gP'],
    label: t(en, 'keymap.binding.navigatePullRequestTriage.label'),
    description: t(en, 'keymap.binding.navigatePullRequestTriage.desc'),
    contexts: ['normal'],
  },
  {
    id: 'navigateIssues',
    keys: ['gi'],
    label: t(en, 'keymap.binding.navigateIssues.label'),
    description: t(en, 'keymap.binding.navigateIssues.desc'),
    contexts: ['normal'],
  },
  {
    id: 'navigateConflicts',
    keys: ['gx'],
    label: t(en, 'keymap.binding.navigateConflicts.label'),
    description: t(en, 'keymap.binding.navigateConflicts.desc'),
    contexts: ['normal'],
  },
  {
    id: 'navigateReflog',
    keys: ['gr'],
    label: t(en, 'keymap.binding.navigateReflog.label'),
    description: t(en, 'keymap.binding.navigateReflog.desc'),
    contexts: ['normal'],
  },
  {
    // OSS-1606 — pop the session-scoped undo stack (branch delete /
    // stash drop / reset / tag delete) and run its recorded inverse.
    // Lives in the `g` chord namespace alongside the other global/meta
    // commands rather than a bare key, so it can't collide with any
    // per-view single-letter binding.
    id: 'workflowUndoLastAction',
    keys: ['gu'],
    label: t(en, 'keymap.binding.workflowUndoLastAction.label'),
    description: t(en, 'keymap.binding.workflowUndoLastAction.desc'),
    contexts: ['normal'],
  },
  {
    id: 'navigateBisect',
    keys: ['gB'],
    label: t(en, 'keymap.binding.navigateBisect.label'),
    description: t(en, 'keymap.binding.navigateBisect.desc'),
    contexts: ['normal'],
  },
  {
    id: 'navigateSubmodules',
    keys: ['gM'],
    label: t(en, 'keymap.binding.navigateSubmodules.label'),
    description: t(en, 'keymap.binding.navigateSubmodules.desc'),
    contexts: ['normal'],
  },
  {
    id: 'navigateRemotes',
    keys: ['gn'],
    label: t(en, 'keymap.binding.navigateRemotes.label'),
    description: t(en, 'keymap.binding.navigateRemotes.desc'),
    contexts: ['normal'],
  },
  {
    id: 'navigateBlame',
    keys: ['b'],
    label: t(en, 'keymap.binding.navigateBlame.label'),
    description: t(en, 'keymap.binding.navigateBlame.desc'),
    contexts: ['status', 'diff'],
  },
  {
    id: 'navigateFileHistory',
    keys: ['L'],
    label: t(en, 'keymap.binding.navigateFileHistory.label'),
    description: t(en, 'keymap.binding.navigateFileHistory.desc'),
    contexts: ['status', 'diff', 'blame'],
  },
  {
    id: 'markForCompare',
    keys: ['m'],
    label: t(en, 'keymap.binding.markForCompare.label'),
    description: t(en, 'keymap.binding.markForCompare.desc'),
    contexts: ['commits'],
  },
  {
    id: 'navigateBack',
    keys: ['<', 'esc'],
    label: t(en, 'keymap.binding.navigateBack.label'),
    description: t(en, 'keymap.binding.navigateBack.desc'),
    contexts: ['normal'],
  },
  {
    id: 'openSelected',
    keys: ['enter'],
    label: t(en, 'keymap.binding.openSelected.label'),
    description: t(en, 'keymap.binding.openSelected.desc'),
    contexts: ['commits'],
  },
  {
    id: 'refresh',
    keys: ['r'],
    label: t(en, 'keymap.binding.refresh.label'),
    description: t(en, 'keymap.binding.refresh.desc'),
    contexts: ['normal'],
  },
  {
    id: 'revertSelection',
    keys: ['z'],
    label: t(en, 'keymap.binding.revertSelection.label'),
    // #1361 — outside a revertable file/hunk target, `z` falls through
    // to the global undo (reflog-powered inverse of the last operation).
    description: t(en, 'keymap.binding.revertSelection.desc'),
    contexts: ['commits'],
  },
  {
    id: 'editCommit',
    keys: ['e'],
    label: t(en, 'keymap.binding.editCommit.label'),
    description: t(en, 'keymap.binding.editCommit.desc'),
    contexts: ['commits'],
  },
  {
    id: 'editCommitExternal',
    keys: ['E'],
    label: t(en, 'keymap.binding.editCommitExternal.label'),
    description: t(en, 'keymap.binding.editCommitExternal.desc'),
    contexts: ['commits'],
  },
  {
    id: 'commitSplit',
    keys: ['S'],
    label: t(en, 'keymap.binding.commitSplit.label'),
    description: t(en, 'keymap.binding.commitSplit.desc'),
    contexts: ['commits'],
  },
  {
    id: 'commit',
    keys: ['c'],
    label: t(en, 'keymap.binding.commit.label'),
    description: t(en, 'keymap.binding.commit.desc'),
    contexts: ['status', 'diff', 'compose'],
  },
  {
    id: 'cycleSort',
    keys: ['s'],
    label: t(en, 'keymap.binding.cycleSort.label'),
    description: t(en, 'keymap.binding.cycleSort.desc'),
    contexts: ['commits'],
  },
  {
    id: 'yankClipboard',
    keys: ['y', 'Y'],
    label: t(en, 'keymap.binding.yankClipboard.label'),
    description: t(en, 'keymap.binding.yankClipboard.desc'),
    contexts: ['commits'],
  },
  {
    id: 'help',
    keys: ['?'],
    label: t(en, 'keymap.binding.help.label'),
    description: t(en, 'keymap.binding.help.desc'),
    contexts: ['normal'],
  },
  {
    id: 'commandPalette',
    keys: [':'],
    label: t(en, 'keymap.binding.commandPalette.label'),
    description: t(en, 'keymap.binding.commandPalette.desc'),
    contexts: ['normal'],
  },
  {
    id: 'workflowDeleteBranch',
    keys: ['D'],
    label: t(en, 'keymap.binding.workflowDeleteBranch.label'),
    description: t(en, 'keymap.binding.workflowDeleteBranch.desc'),
    contexts: ['normal', 'sidebar', 'detail'],
  },
  {
    id: 'workflowDeleteTag',
    keys: ['T'],
    label: t(en, 'keymap.binding.workflowDeleteTag.label'),
    description: t(en, 'keymap.binding.workflowDeleteTag.desc'),
    contexts: ['normal', 'sidebar', 'detail'],
  },
  {
    id: 'workflowDropStash',
    keys: ['X'],
    label: t(en, 'keymap.binding.workflowDropStash.label'),
    description: t(en, 'keymap.binding.workflowDropStash.desc'),
    contexts: ['normal', 'sidebar', 'detail'],
  },
  {
    id: 'workflowRemoveWorktree',
    keys: ['W'],
    label: t(en, 'keymap.binding.workflowRemoveWorktree.label'),
    description: t(en, 'keymap.binding.workflowRemoveWorktree.desc'),
    contexts: ['normal', 'sidebar', 'detail'],
  },
  {
    id: 'workflowAbortOperation',
    keys: ['A'],
    label: t(en, 'keymap.binding.workflowAbortOperation.label'),
    description: t(en, 'keymap.binding.workflowAbortOperation.desc'),
    contexts: ['normal', 'sidebar', 'detail'],
  },
  {
    id: 'workflowAiCommitSummary',
    keys: ['I'],
    label: t(en, 'keymap.binding.workflowAiCommitSummary.label'),
    description: t(en, 'keymap.binding.workflowAiCommitSummary.desc'),
    contexts: ['normal', 'sidebar', 'detail'],
  },
  {
    id: 'workflowAiConflictHelp',
    keys: ['M'],
    label: t(en, 'keymap.binding.workflowAiConflictHelp.label'),
    description: t(en, 'keymap.binding.workflowAiConflictHelp.desc'),
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
    label: t(en, 'keymap.binding.viewCherryPick.label'),
    description: t(en, 'keymap.binding.viewCherryPick.desc'),
    contexts: ['history'],
  },
  {
    id: 'viewRevert',
    keys: ['R'],
    label: t(en, 'keymap.binding.viewRevert.label'),
    description: t(en, 'keymap.binding.viewRevert.desc'),
    contexts: ['history'],
  },
  {
    id: 'viewReset',
    keys: ['Z'],
    label: t(en, 'keymap.binding.viewReset.label'),
    description: t(en, 'keymap.binding.viewReset.desc'),
    contexts: ['history'],
  },
  {
    id: 'viewFixup',
    keys: ['f'],
    label: t(en, 'keymap.binding.viewFixup.label'),
    description: t(en, 'keymap.binding.viewFixup.desc'),
    contexts: ['history'],
  },
  {
    id: 'viewInteractiveRebase',
    keys: ['i'],
    label: t(en, 'keymap.binding.viewInteractiveRebase.label'),
    description: t(en, 'keymap.binding.viewInteractiveRebase.desc'),
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
    label: t(en, 'keymap.binding.viewRebaseOnto.label'),
    description: t(en, 'keymap.binding.viewRebaseOnto.desc'),
    contexts: ['branches'],
  },
  {
    id: 'viewCreateBranchHere',
    keys: ['B'],
    label: t(en, 'keymap.binding.viewCreateBranchHere.label'),
    description: t(en, 'keymap.binding.viewCreateBranchHere.desc'),
    contexts: ['history'],
  },
  {
    id: 'viewCreateTagHere',
    keys: ['gT'],
    label: t(en, 'keymap.binding.viewCreateTagHere.label'),
    description: t(en, 'keymap.binding.viewCreateTagHere.desc'),
    contexts: ['history'],
  },
  {
    id: 'viewKeys',
    keys: ['g?'],
    label: t(en, 'keymap.binding.viewKeys.label'),
    description: t(en, 'keymap.binding.viewKeys.desc'),
    contexts: ['normal'],
  },
  {
    id: 'themePicker',
    keys: ['gC'],
    label: t(en, 'keymap.binding.themePicker.label'),
    description: t(en, 'keymap.binding.themePicker.desc'),
    contexts: ['normal'],
  },
  {
    id: 'openProjectConfig',
    keys: ['gk'],
    label: t(en, 'keymap.binding.openProjectConfig.label'),
    description: t(en, 'keymap.binding.openProjectConfig.desc'),
    contexts: ['normal'],
  },
  {
    id: 'openGlobalConfig',
    keys: ['gK'],
    label: t(en, 'keymap.binding.openGlobalConfig.label'),
    description: t(en, 'keymap.binding.openGlobalConfig.desc'),
    contexts: ['normal'],
  },
  {
    id: 'gitignoreFile',
    keys: ['i'],
    label: t(en, 'keymap.binding.gitignoreFile.label'),
    description: t(en, 'keymap.binding.gitignoreFile.desc'),
    contexts: ['status'],
  },
  {
    id: 'stageAll',
    keys: ['A'],
    label: t(en, 'keymap.binding.stageAll.label'),
    description: t(en, 'keymap.binding.stageAll.desc'),
    contexts: ['status', 'compose'],
  },
  {
    id: 'stagePathspec',
    keys: ['+'],
    label: t(en, 'keymap.binding.stagePathspec.label'),
    description: t(en, 'keymap.binding.stagePathspec.desc'),
    contexts: ['status', 'compose'],
  },
  {
    id: 'viewChangelog',
    keys: ['L'],
    label: t(en, 'keymap.binding.viewChangelog.label'),
    description: t(en, 'keymap.binding.viewChangelog.desc'),
    contexts: ['history', 'branches'],
  },
  // ── #1447 registry backfill: per-view-context bindings ─────────────
  // These views had imperative key dispatch in inkInput.ts but zero
  // entries in this declarative table, making `g?` / `?` / `:` blind
  // to them. Each entry matches the inkInput handler's per-view guard.
  //
  // ── Stash view ─────────────────────────────────────────────────────
  {
    id: 'workflowApplyStash',
    keys: ['a'],
    label: t(en, 'keymap.binding.workflowApplyStash.label'),
    description: t(en, 'keymap.binding.workflowApplyStash.desc'),
    contexts: ['stash'],
  },
  {
    id: 'workflowPopStash',
    keys: ['p'],
    label: t(en, 'keymap.binding.workflowPopStash.label'),
    description: t(en, 'keymap.binding.workflowPopStash.desc'),
    contexts: ['stash'],
  },
  {
    id: 'workflowApplyStashIndex',
    keys: ['A'],
    label: t(en, 'keymap.binding.workflowApplyStashIndex.label'),
    description: t(en, 'keymap.binding.workflowApplyStashIndex.desc'),
    contexts: ['stash'],
  },
  {
    id: 'workflowRenameStash',
    keys: ['R'],
    label: t(en, 'keymap.binding.workflowRenameStash.label'),
    description: t(en, 'keymap.binding.workflowRenameStash.desc'),
    contexts: ['stash'],
  },
  {
    id: 'workflowStashBranch',
    keys: ['b'],
    label: t(en, 'keymap.binding.workflowStashBranch.label'),
    description: t(en, 'keymap.binding.workflowStashBranch.desc'),
    contexts: ['stash'],
  },
  {
    id: 'workflowUndoDropStash',
    keys: ['u'],
    label: t(en, 'keymap.binding.workflowUndoDropStash.label'),
    description: t(en, 'keymap.binding.workflowUndoDropStash.desc'),
    contexts: ['stash'],
  },
  // ── Tags view ──────────────────────────────────────────────────────
  {
    id: 'workflowPushTag',
    keys: ['P'],
    label: t(en, 'keymap.binding.workflowPushTag.label'),
    description: t(en, 'keymap.binding.workflowPushTag.desc'),
    contexts: ['tags'],
  },
  {
    id: 'workflowDeleteRemoteTag',
    keys: ['R'],
    label: t(en, 'keymap.binding.workflowDeleteRemoteTag.label'),
    description: t(en, 'keymap.binding.workflowDeleteRemoteTag.desc'),
    contexts: ['tags'],
  },
  // ── Conflicts view ─────────────────────────────────────────────────
  {
    id: 'workflowResolveOurs',
    keys: ['U'],
    label: t(en, 'keymap.binding.workflowResolveOurs.label'),
    description: t(en, 'keymap.binding.workflowResolveOurs.desc'),
    contexts: ['conflicts'],
  },
  {
    id: 'workflowResolveTheirs',
    keys: ['u'],
    label: t(en, 'keymap.binding.workflowResolveTheirs.label'),
    description: t(en, 'keymap.binding.workflowResolveTheirs.desc'),
    contexts: ['conflicts'],
  },
  {
    id: 'workflowResolveStage',
    keys: ['s'],
    label: t(en, 'keymap.binding.workflowResolveStage.label'),
    description: t(en, 'keymap.binding.workflowResolveStage.desc'),
    contexts: ['conflicts'],
  },
  {
    id: 'workflowContinueOperation',
    keys: ['C'],
    label: t(en, 'keymap.binding.workflowContinueOperation.label'),
    description: t(en, 'keymap.binding.workflowContinueOperation.desc'),
    contexts: ['conflicts'],
  },
  // ── Bisect view ────────────────────────────────────────────────────
  {
    id: 'workflowBisectGood',
    keys: ['y'],
    label: t(en, 'keymap.binding.workflowBisectGood.label'),
    description: t(en, 'keymap.binding.workflowBisectGood.desc'),
    contexts: ['bisect'],
  },
  {
    id: 'workflowBisectBad',
    keys: ['b'],
    label: t(en, 'keymap.binding.workflowBisectBad.label'),
    description: t(en, 'keymap.binding.workflowBisectBad.desc'),
    contexts: ['bisect'],
  },
  {
    id: 'workflowBisectSkip',
    keys: ['s'],
    label: t(en, 'keymap.binding.workflowBisectSkip.label'),
    description: t(en, 'keymap.binding.workflowBisectSkip.desc'),
    contexts: ['bisect'],
  },
  {
    id: 'workflowBisectReset',
    keys: ['x'],
    label: t(en, 'keymap.binding.workflowBisectReset.label'),
    description: t(en, 'keymap.binding.workflowBisectReset.desc'),
    contexts: ['bisect'],
  },
  {
    id: 'workflowBisectRun',
    keys: ['R'],
    label: t(en, 'keymap.binding.workflowBisectRun.label'),
    description: t(en, 'keymap.binding.workflowBisectRun.desc'),
    contexts: ['bisect'],
  },
  // ── Reflog view ────────────────────────────────────────────────────
  {
    id: 'workflowCheckoutReflog',
    keys: ['c'],
    label: t(en, 'keymap.binding.workflowCheckoutReflog.label'),
    description: t(en, 'keymap.binding.workflowCheckoutReflog.desc'),
    contexts: ['reflog'],
  },
  // ── Remotes view ───────────────────────────────────────────────────
  {
    id: 'workflowRemoteAdd',
    keys: ['a'],
    label: t(en, 'keymap.binding.workflowRemoteAdd.label'),
    description: t(en, 'keymap.binding.workflowRemoteAdd.desc'),
    contexts: ['remotes'],
  },
  {
    id: 'workflowRemoteSetUrl',
    keys: ['e'],
    label: t(en, 'keymap.binding.workflowRemoteSetUrl.label'),
    description: t(en, 'keymap.binding.workflowRemoteSetUrl.desc'),
    contexts: ['remotes'],
  },
  {
    id: 'workflowRemoteRemove',
    keys: ['x'],
    label: t(en, 'keymap.binding.workflowRemoteRemove.label'),
    description: t(en, 'keymap.binding.workflowRemoteRemove.desc'),
    contexts: ['remotes'],
  },
  {
    id: 'workflowRemotePrune',
    keys: ['p'],
    label: t(en, 'keymap.binding.workflowRemotePrune.label'),
    description: t(en, 'keymap.binding.workflowRemotePrune.desc'),
    contexts: ['remotes'],
  },
  // ── Submodules view ────────────────────────────────────────────────
  {
    id: 'workflowSubmoduleInit',
    keys: ['i'],
    label: t(en, 'keymap.binding.workflowSubmoduleInit.label'),
    description: t(en, 'keymap.binding.workflowSubmoduleInit.desc'),
    contexts: ['submodules'],
  },
  {
    id: 'workflowSubmoduleUpdate',
    keys: ['u'],
    label: t(en, 'keymap.binding.workflowSubmoduleUpdate.label'),
    description: t(en, 'keymap.binding.workflowSubmoduleUpdate.desc'),
    contexts: ['submodules'],
  },
  {
    id: 'workflowSubmoduleSync',
    keys: ['s'],
    label: t(en, 'keymap.binding.workflowSubmoduleSync.label'),
    description: t(en, 'keymap.binding.workflowSubmoduleSync.desc'),
    contexts: ['submodules'],
  },
  // ── Pull-request triage view ───────────────────────────────────────
  {
    id: 'workflowTriagePrCheckout',
    keys: ['C'],
    label: t(en, 'keymap.binding.workflowTriagePrCheckout.label'),
    description: t(en, 'keymap.binding.workflowTriagePrCheckout.desc'),
    contexts: ['pull-request-triage'],
  },
  {
    id: 'workflowTriagePrOpen',
    keys: ['O'],
    label: t(en, 'keymap.binding.workflowTriagePrOpen.label'),
    description: t(en, 'keymap.binding.workflowTriagePrOpen.desc'),
    contexts: ['pull-request-triage'],
  },
  // ── Issues triage view ─────────────────────────────────────────────
  {
    id: 'workflowTriageIssueOpen',
    keys: ['O'],
    label: t(en, 'keymap.binding.workflowTriageIssueOpen.label'),
    description: t(en, 'keymap.binding.workflowTriageIssueOpen.desc'),
    contexts: ['issues'],
  },
  // ── Worktrees view ─────────────────────────────────────────────────
  {
    id: 'workflowRemoveWorktreeAndBranch',
    keys: ['D'],
    label: t(en, 'keymap.binding.workflowRemoveWorktreeAndBranch.label'),
    description: t(en, 'keymap.binding.workflowRemoveWorktreeAndBranch.desc'),
    contexts: ['worktrees'],
  },
  {
    id: 'quit',
    keys: ['q', 'ctrl+c'],
    label: t(en, 'keymap.binding.quit.label'),
    description: t(en, 'keymap.binding.quit.desc'),
    contexts: ['normal', 'search'],
  },
]

export type GetLogInkFooterHintsOptions = {
  activeView?: LogInkView
  /** Used to differentiate the diff-view hints between commit / worktree
   *  / stash sources without reaching into runtime state. */
  diffSource?: 'commit' | 'worktree' | 'stash' | 'compare' | 'pr'
  filterMode: boolean
  focus: LogInkFocus
  showHelp: boolean
  /** True while the help overlay's own type-to-filter input is active
   *  (distinct from `filterMode`, the commit-list search filter). */
  helpFilterMode?: boolean
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
  /** True while a bisect session is in progress. The bisect view's
   *  mark/skip/run/reset keys are gated on an active session, so the
   *  footer must not advertise them from the empty-state view. */
  bisectActive?: boolean
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
  /**
   * Depth of the session-scoped undo stack (OSS-1606). When > 0, the
   * default (non-overlay) global hint cluster surfaces `gu undo (N)` so
   * the safety net stays discoverable exactly when it's actionable —
   * hidden the rest of the time rather than advertising a key that
   * would just report "nothing to undo".
   */
  undoStackSize?: number
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

const NORMAL_GLOBAL_HINTS = [t(en, 'keymap.footer.gJump'), t(en, 'keymap.footer.back'), t(en, 'keymap.footer.help'), t(en, 'keymap.footer.cmds'), t(en, 'keymap.footer.qQuit')]

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
const SINGLE_PANE_GLOBAL_HINTS = [t(en, 'keymap.footer.help'), t(en, 'keymap.footer.qQuit')]
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
  // The undo safety net (OSS-1606) belongs with the other essentials, not
  // `edit` (compose-surface authoring) — it's a global recovery action,
  // not a commit-message key, and its whole point is to be easy to find.
  workflowUndoLastAction: 'essentials',
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
  essentials: t(en, 'keymap.category.essentials'),
  navigation: t(en, 'keymap.category.navigation'),
  movement: t(en, 'keymap.category.movement'),
  view: t(en, 'keymap.category.view'),
  edit: t(en, 'keymap.category.edit'),
  'history-actions': t(en, 'keymap.category.history-actions'),
  mutate: t(en, 'keymap.category.mutate'),
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
  return `${t(en, 'keymap.footer.paneSwitcherPrefix')} ${label('sidebar')} ${label('main')} ${label('inspector')}`
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
      contextual: [t(en, 'keymap.footer.vEscMain'), ...hints.contextual.slice(0, SINGLE_PANE_VIEW_HINT_LIMIT)],
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
    // No `v peek` on the staging diff (#1389): `v` is line-select
    // there (the input layer gates the peek off it), and advertising
    // peek over select was how line-staging silently vanished on
    // narrow terminals.
    const onWorktreeDiff = options.activeView === 'diff' && options.diffSource === 'worktree'
    const lead =
      options.focus === 'sidebar' || onWorktreeDiff
        ? [singlePaneSwitcherHint(options.focus)]
        : [singlePaneSwitcherHint(options.focus), t(en, 'keymap.footer.peek')]
    return {
      contextual: [...lead, ...hints.contextual.slice(0, SINGLE_PANE_VIEW_HINT_LIMIT)],
      global: SINGLE_PANE_GLOBAL_HINTS,
    }
  }
  // OSS-1606 — surface the undo stack ONLY in the default (non-overlay)
  // global cluster: the reference-equality check against
  // NORMAL_GLOBAL_HINTS confirms we're in one of the plain per-view /
  // per-focus branches below, not mid-overlay (help / palette / filter /
  // split-plan), where `gu` isn't actually live and advertising it would
  // be a footer lie. Hidden entirely at depth 0 rather than always
  // shown-but-inert — an undo hint that does nothing is noise.
  if (options.undoStackSize && options.undoStackSize > 0 && hints.global === NORMAL_GLOBAL_HINTS) {
    return { ...hints, global: [...NORMAL_GLOBAL_HINTS, t(en, 'keymap.footer.undo', { count: options.undoStackSize })] }
  }
  return hints
}

function computeLogInkFooterHints(options: GetLogInkFooterHintsOptions): LogInkFooterHints {
  if (options.pendingKey) {
    const continuations = getLogInkChordContinuations(options.pendingKey)
    if (continuations.length > 0) {
      return {
        contextual: [
          t(en, 'keymap.footer.chordPending', { key: options.pendingKey }),
          ...continuations.map((entry) => `${entry.key} ${entry.label}`),
        ],
        global: [t(en, 'keymap.footer.escCancel')],
      }
    }
  }

  if (options.filterMode) {
    return {
      contextual: [t(en, 'keymap.footer.enterApply'), t(en, 'keymap.footer.escCancel'), t(en, 'keymap.footer.ctrlUClear')],
      global: [t(en, 'keymap.footer.qQuit')],
    }
  }

  if (options.showHelp) {
    if (options.helpFilterMode) {
      return {
        contextual: [t(en, 'keymap.footer.enterKeep'), t(en, 'keymap.footer.escClear'), t(en, 'keymap.footer.typeToFilter')],
        global: [t(en, 'keymap.footer.qQuit')],
      }
    }
    // Every key here is live inside the help handler — the old set
    // advertised `tab focus` and `/ search` while the handler
    // swallowed both ("a footer that lies about a key is a bug",
    // #1355). `/` is now true: it opens the overlay's type-to-filter.
    return {
      contextual: [t(en, 'keymap.footer.close'), t(en, 'keymap.footer.filter'), t(en, 'keymap.footer.jKScroll')],
      global: [t(en, 'keymap.footer.qQuit')],
    }
  }

  if (options.showCommandPalette) {
    return {
      contextual: [t(en, 'keymap.footer.close2'), t(en, 'keymap.footer.dTXConfirm'), t(en, 'keymap.footer.iMAi')],
      global: [t(en, 'keymap.footer.help'), t(en, 'keymap.footer.qQuit')],
    }
  }

  // Split-plan overlay claims the footer while open — the underlying
  // view's keystrokes are intercepted, so surfacing them would be
  // misleading. Each phase gets its own hint set since most keys
  // no-op during loading / applying.
  if (options.splitPlanStatus === 'ready') {
    return {
      contextual: [
        t(en, 'keymap.footer.scroll'),
        t(en, 'keymap.footer.pgUpDn'),
        t(en, 'keymap.footer.gGTopBot'),
        t(en, 'keymap.footer.yApply'),
        t(en, 'keymap.footer.rRegen'),
        t(en, 'keymap.footer.escCancel'),
      ],
      global: [t(en, 'keymap.footer.qQuit')],
    }
  }
  if (options.splitPlanStatus === 'loading') {
    return {
      contextual: [t(en, 'keymap.footer.generatingPlan'), t(en, 'keymap.footer.escCancel')],
      global: [t(en, 'keymap.footer.qQuit')],
    }
  }
  if (options.splitPlanStatus === 'applying') {
    // No `q quit` here (unlike the loading/ready phases above) — the
    // dispatcher deliberately blocks quitting mid-apply to avoid
    // abandoning a half-applied split, so advertising it would be a
    // footer lie.
    return {
      contextual: [t(en, 'keymap.footer.applyingSplit')],
      global: [],
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
          t(en, 'keymap.footer.branches'), t(en, 'keymap.footer.tab'), t(en, 'keymap.footer.enterCheckout'),
          t(en, 'keymap.footer.fFetch'), t(en, 'keymap.footer.uPull'), t(en, 'keymap.footer.pPush'),
          t(en, 'keymap.footer.dDelete'), t(en, 'keymap.footer.rRename'), t(en, 'keymap.footer.uUpstream'),
        ],
        global: NORMAL_GLOBAL_HINTS,
      }
    }
    if (itemsPresent && options.sidebarTab === 'stashes') {
      return {
        contextual: [t(en, 'keymap.footer.stashes'), t(en, 'keymap.footer.tab'), t(en, 'keymap.footer.enterDiff'), t(en, 'keymap.footer.aApply'), t(en, 'keymap.footer.pPop'), t(en, 'keymap.footer.xDrop')],
        global: NORMAL_GLOBAL_HINTS,
      }
    }
    if (itemsPresent && options.sidebarTab === 'tags') {
      return {
        contextual: [t(en, 'keymap.footer.tags'), t(en, 'keymap.footer.tab'), t(en, 'keymap.footer.new'), t(en, 'keymap.footer.pPush'), t(en, 'keymap.footer.tDelete')],
        global: NORMAL_GLOBAL_HINTS,
      }
    }
    if (itemsPresent && options.sidebarTab === 'worktrees') {
      return {
        contextual: [t(en, 'keymap.footer.worktrees'), t(en, 'keymap.footer.tab'), t(en, 'keymap.footer.wRemove')],
        global: NORMAL_GLOBAL_HINTS,
      }
    }
    return {
      contextual: [t(en, 'keymap.footer.tab'), t(en, 'keymap.footer.15Jump'), t(en, 'keymap.footer.enterOpen'), t(en, 'keymap.footer.tabFocus')],
      global: NORMAL_GLOBAL_HINTS,
    }
  }

  if (options.focus === 'detail') {
    return {
      contextual: [t(en, 'keymap.footer.files'), t(en, 'keymap.footer.pgupPgdnDiff'), t(en, 'keymap.footer.tabFocus')],
      global: NORMAL_GLOBAL_HINTS,
    }
  }

  const view = options.activeView ?? 'history'
  const hints = LOG_INK_FOOTER_HINT_REGISTRY[view]
  return hints ? hints(options) : historyHints(options)
}

function statusHints(): LogInkFooterHints {
  return {
    contextual: [t(en, 'keymap.footer.files'), t(en, 'keymap.footer.enterHunks'), t(en, 'keymap.footer.spaceStage'), t(en, 'keymap.footer.aStageAll'), t(en, 'keymap.footer.zRevert'), t(en, 'keymap.footer.eCCompose')],
    global: NORMAL_GLOBAL_HINTS,
  }
}

function diffHints(options: GetLogInkFooterHintsOptions): LogInkFooterHints {
  // Surface what `d` will switch *to* — labels the next mode rather
  // than the current one so the hint reads as a verb. The split-mode
  // hint is only shown for the read-only diff sources (commit/stash);
  // the worktree diff stays unified-only for now.
  const splitToggleHint = options.diffViewMode === 'split' ? t(en, 'keymap.footer.dUnified') : t(en, 'keymap.footer.dSplit')
  if (options.diffSource === 'stash') {
    return {
      contextual: [t(en, 'keymap.footer.jKLines'), t(en, 'keymap.footer.file'), t(en, 'keymap.footer.cCherryPick'), t(en, 'keymap.footer.hApplyHunk'), splitToggleHint, t(en, 'keymap.footer.escBack')],
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
      contextual: [t(en, 'keymap.footer.jKLines'), t(en, 'keymap.footer.hunk'), t(en, 'keymap.footer.cCherryPick'), t(en, 'keymap.footer.hApplyHunk'), splitToggleHint, t(en, 'keymap.footer.escBack')],
      global: NORMAL_GLOBAL_HINTS,
    }
  }
  if (options.diffSource === 'compare') {
    // Compare-two-refs (#779): read-only diff with no per-file
    // cherry-pick or hunk apply (those don't make sense across
    // arbitrary refs). Just scroll + back out.
    return {
      contextual: [t(en, 'keymap.footer.jKLines'), splitToggleHint, t(en, 'keymap.footer.escBack')],
      global: NORMAL_GLOBAL_HINTS,
    }
  }
  if (options.diffSource === 'pr') {
    // PR-triage drill-in (#1363): read-only like compare (the files
    // live on the PR's head branch, so no cherry-pick / hunk apply /
    // open-in-editor), but with the stash diff's per-file `[/]` jump.
    // `C` checks the PR's branch out locally — the "review this
    // properly" follow-up to reading the patch.
    return {
      contextual: [t(en, 'keymap.footer.jKLines'), t(en, 'keymap.footer.file'), t(en, 'keymap.footer.cCheckout'), splitToggleHint, t(en, 'keymap.footer.escBack')],
      global: NORMAL_GLOBAL_HINTS,
    }
  }
  // Worktree (staging) diff. Consistent with the commit/stash diffs
  // (#1185): j/k scroll lines, [/] jump between hunks. space stages /
  // unstages the hunk under the viewport, a stages the whole file, z
  // discards the current hunk.
  return {
    contextual: [t(en, 'keymap.footer.jKLines'), t(en, 'keymap.footer.hunk'), t(en, 'keymap.footer.vSelect'), t(en, 'keymap.footer.spaceStage'), t(en, 'keymap.footer.aStageFile'), t(en, 'keymap.footer.zDiscard'), t(en, 'keymap.footer.oEdit'), t(en, 'keymap.footer.escBack')],
    global: NORMAL_GLOBAL_HINTS,
  }
}

function composeHints(): LogInkFooterHints {
  return {
    contextual: [t(en, 'keymap.footer.eEdit'), t(en, 'keymap.footer.cCommit'), t(en, 'keymap.footer.aAmend'), t(en, 'keymap.footer.aStageAll'), t(en, 'keymap.footer.stage'), t(en, 'keymap.footer.sSplit'), t(en, 'keymap.footer.iAiDraft'), t(en, 'keymap.footer.escBack')],
    global: NORMAL_GLOBAL_HINTS,
  }
}

function branchesHints(options: GetLogInkFooterHintsOptions): LogInkFooterHints {
  if (options.compareBaseSet) {
    return {
      contextual: [t(en, 'keymap.footer.branches'), t(en, 'keymap.footer.enterCompare'), t(en, 'keymap.footer.mClear'), t(en, 'keymap.footer.escBack')],
      global: NORMAL_GLOBAL_HINTS,
    }
  }
  return {
    // `x/v mark` covers both multi-select primitives (#1361): x
    // toggles a mark, v anchors a range; D then deletes the batch.
    contextual: [t(en, 'keymap.footer.branches'), t(en, 'keymap.footer.enterCheckout'), t(en, 'keymap.footer.new'), t(en, 'keymap.footer.xVMark'), t(en, 'keymap.footer.dDelete'), t(en, 'keymap.footer.rRebase'), t(en, 'keymap.footer.mCompare'), t(en, 'keymap.footer.sSort'), t(en, 'keymap.footer.yYank')],
    global: NORMAL_GLOBAL_HINTS,
  }
}

function tagsHints(options: GetLogInkFooterHintsOptions): LogInkFooterHints {
  if (options.compareBaseSet) {
    return {
      contextual: [t(en, 'keymap.footer.tags'), t(en, 'keymap.footer.enterCompare'), t(en, 'keymap.footer.mClear'), t(en, 'keymap.footer.escBack')],
      global: NORMAL_GLOBAL_HINTS,
    }
  }
  return {
    contextual: [t(en, 'keymap.footer.tags'), t(en, 'keymap.footer.new'), t(en, 'keymap.footer.pPush'), t(en, 'keymap.footer.tDelete'), t(en, 'keymap.footer.mCompare'), t(en, 'keymap.footer.sSort'), t(en, 'keymap.footer.yYank')],
    global: NORMAL_GLOBAL_HINTS,
  }
}

function stashHints(): LogInkFooterHints {
  return {
    // #1361 — x/v mark covers both multi-select primitives, same as
    // the branches view.
    contextual: [t(en, 'keymap.footer.stashes'), t(en, 'keymap.footer.enterDiff'), t(en, 'keymap.footer.aAApply'), t(en, 'keymap.footer.pPop'), t(en, 'keymap.footer.rRename'), t(en, 'keymap.footer.bBranch'), t(en, 'keymap.footer.xVMark'), t(en, 'keymap.footer.xDropUUndo')],
    global: NORMAL_GLOBAL_HINTS,
  }
}

function worktreesHints(): LogInkFooterHints {
  return {
    contextual: [t(en, 'keymap.footer.worktrees'), t(en, 'keymap.footer.wRemove'), t(en, 'keymap.footer.escBack')],
    global: NORMAL_GLOBAL_HINTS,
  }
}

function pullRequestHints(): LogInkFooterHints {
  // #783 — full PR action panel. Five mutating ops scoped to this
  // view: m / x / a / R / c, plus O for open-in-browser (already
  // a global). Each routes through y-confirm or an input prompt;
  // none fire silently. OSS-1615 adds K (re-run failed checks,
  // fires directly) and M (auto-merge, opens the strategy picker).
  // #1933 adds d (mark ready) / X (reopen), both confirm-gated like
  // a/approve.
  return {
    contextual: [t(en, 'keymap.footer.mMerge'), t(en, 'keymap.footer.xClose'), t(en, 'keymap.footer.aApprove'), t(en, 'keymap.footer.dReady'), t(en, 'keymap.footer.xReopen'), t(en, 'keymap.footer.rChanges'), t(en, 'keymap.footer.cComment'), t(en, 'keymap.footer.kRerunChecks'), t(en, 'keymap.footer.mAutoMerge'), t(en, 'keymap.footer.oOpen'), t(en, 'keymap.footer.escBack')],
    global: NORMAL_GLOBAL_HINTS,
  }
}

function rebaseHints(): LogInkFooterHints {
  return {
    contextual: [t(en, 'keymap.footer.move'), t(en, 'keymap.footer.jKReorder'), t(en, 'keymap.footer.pSFDERetag'), t(en, 'keymap.footer.rReword'), t(en, 'keymap.footer.enterRun'), t(en, 'keymap.footer.escBack')],
    global: NORMAL_GLOBAL_HINTS,
  }
}

function conflictsHints(): LogInkFooterHints {
  return {
    contextual: [t(en, 'keymap.footer.files'), t(en, 'keymap.footer.enterDiff'), t(en, 'keymap.footer.sStage'), t(en, 'keymap.footer.uIncoming'), t(en, 'keymap.footer.uYours'), t(en, 'keymap.footer.oEdit'), t(en, 'keymap.footer.cContinue'), t(en, 'keymap.footer.escBack')],
    global: NORMAL_GLOBAL_HINTS,
  }
}

function reflogHints(): LogInkFooterHints {
  return {
    contextual: [t(en, 'keymap.footer.entries'), t(en, 'keymap.footer.enterInspect'), t(en, 'keymap.footer.cCheckout2'), t(en, 'keymap.footer.bBranch2'), t(en, 'keymap.footer.zReset'), t(en, 'keymap.footer.escBack')],
    global: NORMAL_GLOBAL_HINTS,
  }
}

function issuesHints(): LogInkFooterHints {
  // #882 phase 4-6 — read + additive mutations + destructive
  // (gated through y-confirm) + filter cycling. AI summarize
  // (`I`) deferred to a follow-up.
  return {
    contextual: [t(en, 'keymap.footer.issues'), t(en, 'keymap.footer.fFilter'), t(en, 'keymap.footer.oOpen'), t(en, 'keymap.footer.yYankUrl'), t(en, 'keymap.footer.cComment'), t(en, 'keymap.footer.lLabel'), t(en, 'keymap.footer.aAssign'), t(en, 'keymap.footer.xClose2'), t(en, 'keymap.footer.xReopen'), t(en, 'keymap.footer.escBack')],
    global: NORMAL_GLOBAL_HINTS,
  }
}

function pullRequestTriageHints(): LogInkFooterHints {
  // #882 phase 4-6 — full PR action panel scoped to the triage
  // list + filter cycling; #1363 adds the review pair (enter →
  // read the diff, C → check the branch out locally). OSS-1615 adds K
  // (re-run failed checks) and M (auto-merge). #1933 adds d (mark
  // ready) / X (reopen). AI summarize (`I`) deferred to a follow-up.
  return {
    contextual: [t(en, 'keymap.footer.prs'), t(en, 'keymap.footer.enterDiff'), t(en, 'keymap.footer.cCheckout'), t(en, 'keymap.footer.fFilter'), t(en, 'keymap.footer.oOpen'), t(en, 'keymap.footer.yYankUrl'), t(en, 'keymap.footer.cComment'), t(en, 'keymap.footer.lLabel'), t(en, 'keymap.footer.aAssign'), t(en, 'keymap.footer.mMerge2'), t(en, 'keymap.footer.xClose2'), t(en, 'keymap.footer.aApprove'), t(en, 'keymap.footer.dReady'), t(en, 'keymap.footer.xReopen'), t(en, 'keymap.footer.rChanges2'), t(en, 'keymap.footer.kRerunChecks'), t(en, 'keymap.footer.mAutoMerge2'), t(en, 'keymap.footer.escBack')],
    global: NORMAL_GLOBAL_HINTS,
  }
}

function submodulesHints(): LogInkFooterHints {
  return {
    contextual: [t(en, 'keymap.footer.entries'), t(en, 'keymap.footer.iInit'), t(en, 'keymap.footer.uUpdate'), t(en, 'keymap.footer.sSync'), t(en, 'keymap.footer.yYankPath'), t(en, 'keymap.footer.yYankSha'), t(en, 'keymap.footer.filter'), t(en, 'keymap.footer.escBack')],
    global: NORMAL_GLOBAL_HINTS,
  }
}

function remotesHints(): LogInkFooterHints {
  // #0.71 — remote management. add / set-url prompt for input
  // (the prompt is the gate); remove / prune route through the
  // y-confirm path (`*` marks the destructive ones).
  return {
    contextual: [t(en, 'keymap.footer.remotes'), t(en, 'keymap.footer.aAdd'), t(en, 'keymap.footer.eSetUrl'), t(en, 'keymap.footer.xRemove'), t(en, 'keymap.footer.pPrune'), t(en, 'keymap.footer.yYankUrl2'), t(en, 'keymap.footer.filter'), t(en, 'keymap.footer.escBack')],
    global: NORMAL_GLOBAL_HINTS,
  }
}

function blameHints(): LogInkFooterHints {
  // #0.71 — on-demand blame drill-down. Read-only: j/k scroll the
  // windowed line list, esc pops back to the file list.
  // #COCO-14 — L drills from blame into the file-history log.
  return {
    contextual: [t(en, 'keymap.footer.lines'), t(en, 'keymap.footer.ggGTopBottom'), t(en, 'keymap.footer.lFileLog'), t(en, 'keymap.footer.escBack')],
    global: NORMAL_GLOBAL_HINTS,
  }
}

function fileHistoryHints(): LogInkFooterHints {
  // #COCO-14 — file-history drill-down. j/k scroll the commit list,
  // enter opens the diff for the cursored commit, esc returns.
  return {
    contextual: [t(en, 'keymap.footer.commits'), t(en, 'keymap.footer.ggGTopBottom'), t(en, 'keymap.footer.enterDiff'), t(en, 'keymap.footer.escBack')],
    global: NORMAL_GLOBAL_HINTS,
  }
}

function changelogHints(): LogInkFooterHints {
  return {
    contextual: [t(en, 'keymap.footer.jKScroll'), t(en, 'keymap.footer.pgUpDn'), t(en, 'keymap.footer.yYank'), t(en, 'keymap.footer.eEditor'), t(en, 'keymap.footer.cPr'), t(en, 'keymap.footer.rRegen'), t(en, 'keymap.footer.back')],
    global: NORMAL_GLOBAL_HINTS,
  }
}

function historyHints(options: GetLogInkFooterHintsOptions): LogInkFooterHints {
  if (options.compareBaseSet) {
    // History view with a compare base set — Enter is overridden to
    // open the compare diff; show the override + the bail-out key.
    // Mutate / new chips are dropped so the footer doesn't compete
    // with the active workflow.
    return {
      contextual: [t(en, 'keymap.footer.move'), t(en, 'keymap.footer.enterCompare'), t(en, 'keymap.footer.mClear'), t(en, 'keymap.footer.escBack')],
      global: NORMAL_GLOBAL_HINTS,
    }
  }

  // History view default hints. Mutating ops (`c` cherry-pick, `R`
  // revert, `Z` reset, `i` interactive-rebase) all route through a
  // y-confirm or mode prompt — none fire silently from the keystroke.
  // `B` create-branch-here and `gT` create-tag-here use a prompt as
  // the affirmative gate (typing the name is the confirmation).
  // Grouped into compact `c/R/Z/i mutate` and `B/gT new` chips so
  // the footer stays scannable; full descriptions live in `?` help
  // and the palette. `v range` (#1361) anchors a span for `c` to
  // cherry-pick as one command instead of the single cursored commit.
  return {
    contextual: [t(en, 'keymap.footer.move'), t(en, 'keymap.footer.enterDiff'), t(en, 'keymap.footer.cRZIMutate'), t(en, 'keymap.footer.fFixup'), t(en, 'keymap.footer.bGtNew'), t(en, 'keymap.footer.mCompare'), t(en, 'keymap.footer.vRange'), t(en, 'keymap.footer.yYYank'), t(en, 'keymap.footer.search')],
    global: NORMAL_GLOBAL_HINTS,
  }
}

const LOG_INK_FOOTER_HINT_REGISTRY: Partial<
  Record<LogInkView, (options: GetLogInkFooterHintsOptions) => LogInkFooterHints>
> = {
  status: statusHints,
  diff: diffHints,
  compose: composeHints,
  branches: branchesHints,
  tags: tagsHints,
  stash: stashHints,
  worktrees: worktreesHints,
  'pull-request': pullRequestHints,
  rebase: rebaseHints,
  conflicts: conflictsHints,
  reflog: reflogHints,
  issues: issuesHints,
  'pull-request-triage': pullRequestTriageHints,
  submodules: submodulesHints,
  remotes: remotesHints,
  blame: blameHints,
  'file-history': fileHistoryHints,
  bisect: (options) => getBisectFooterHints(options, NORMAL_GLOBAL_HINTS),
  changelog: changelogHints,
  history: historyHints,
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

  // "This view" leads (#1355): users press `?` to answer "what can I
  // do HERE" — the global set is reference material, not the answer.
  return [
    {
      title: t(en, 'keymap.section.thisView', { view: options.activeView }),
      bindings: viewBindings,
      subgroups: buildSubgroups(viewBindings, false),
    },
    {
      title: t(en, 'keymap.section.global'),
      bindings: globals,
      subgroups: buildSubgroups(globals, true),
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
