import { BranchOverview } from '../../git/branchData'
import { GitLogCommitRow } from '../../commands/log/data'
import { GitOperationOverview } from '../../git/operationData'
import { ProviderOverview } from '../../git/providerData'
import { PullRequestOverview } from '../../git/pullRequestData'
import { StashOverview } from '../../git/stashData'
import { WorktreeOverview } from '../../git/statusData'
import { TagOverview } from '../../git/tagData'
import { WorktreeOverview as WorktreeListOverview } from '../../git/worktreeData'

export type LogInkWorkflowContext = {
  branches?: BranchOverview
  contextLoading?: boolean
  operation?: GitOperationOverview
  provider?: ProviderOverview
  pullRequest?: PullRequestOverview
  selectedCommit?: GitLogCommitRow
  stashes?: StashOverview
  tags?: TagOverview
  worktree?: WorktreeOverview
  worktreeList?: WorktreeListOverview
}

export type LogInkWorkflowSection = {
  title: string
  lines: string[]
}

export type LogInkWorkflowActionKind = 'normal' | 'destructive' | 'ai'

export type LogInkWorkflowAction = {
  id: string
  key: string
  label: string
  description: string
  kind: LogInkWorkflowActionKind
  requiresConfirmation: boolean
  estimatedTokens?: number
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

export function getLogInkWorkflowSections(context: LogInkWorkflowContext): LogInkWorkflowSection[] {
  const currentBranch = context.branches?.currentBranch || context.provider?.currentBranch || '<detached>'
  const dirty = context.branches?.dirty ? 'dirty worktree' : 'clean worktree'
  const loading = context.contextLoading
  const currentPullRequest = context.provider?.currentPullRequest || context.pullRequest?.currentPullRequest
  const repository = context.provider?.repository
  const repoName = repository?.owner && repository.name
    ? `${repository.owner}/${repository.name}`
    : repository?.message || 'local repository'
  const operation = context.operation
  const worktree = context.worktree

  return [
    {
      title: 'Branch',
      lines: [
        `Current: ${currentBranch}`,
        `State: ${dirty}`,
        loading && !context.branches
          ? 'Branch data loading'
          : context.branches
          ? `${countLabel(context.branches.localBranches.length, 'local branch', 'local branches')} | ${countLabel(context.branches.remoteBranches.length, 'remote branch', 'remote branches')}`
          : 'Branch data unavailable',
      ],
    },
    {
      title: 'Provider / PR',
      lines: [
        `Repository: ${repoName}`,
        loading && !context.provider && !context.pullRequest
          ? 'Provider and pull request data loading'
          : currentPullRequest
          ? `PR #${currentPullRequest.number} ${currentPullRequest.state}${currentPullRequest.isDraft ? ' draft' : ''}`
          : 'No pull request detected for current branch',
        context.provider?.authenticated === false ? 'Provider auth: offline' : 'Provider auth: available',
      ],
    },
    {
      title: 'Status',
      lines: loading && !worktree
        ? ['Status data loading']
        : worktree
        ? [
          `${countLabel(worktree.stagedCount, 'staged file')}`,
          `${countLabel(worktree.unstagedCount, 'unstaged file')}`,
          `${countLabel(worktree.untrackedCount, 'untracked file')}`,
        ]
        : ['Status data unavailable'],
    },
    {
      title: 'Tags / Stashes / Worktrees',
      lines: [
        loading && !context.tags ? 'Tags loading' : context.tags ? countLabel(context.tags.tags.length, 'tag') : 'Tags unavailable',
        loading && !context.stashes ? 'Stashes loading' : context.stashes ? countLabel(context.stashes.stashes.length, 'stash', 'stashes') : 'Stashes unavailable',
        context.worktreeList
          ? countLabel(context.worktreeList.worktrees.length, 'worktree')
          : loading
            ? 'Worktrees loading'
            : 'Worktrees unavailable',
      ],
    },
    {
      title: 'Operation / AI',
      lines: [
        loading && !operation
          ? 'Operation data loading'
          : operation?.operation
          ? `${operation.operation} in progress with ${countLabel(operation.conflictedFiles.length, 'conflict')}`
          : 'No merge, rebase, cherry-pick, or revert in progress',
        context.selectedCommit
          ? `AI actions target ${context.selectedCommit.shortHash}; estimates shown before execution`
          : 'AI actions require a selected commit',
      ],
    },
  ]
}

export function getLogInkWorkflowActions(): LogInkWorkflowAction[] {
  return [
    {
      id: 'checkout-branch',
      key: 'enter',
      label: 'Checkout selected branch',
      description: 'Switch to the selected local or remote branch.',
      kind: 'normal',
      requiresConfirmation: false,
    },
    {
      id: 'create-pr',
      key: 'C',
      label: 'Create pull request',
      description: 'Create a pull request from the current branch.',
      kind: 'normal',
      requiresConfirmation: false,
    },
    {
      // Per-view-only: scoped to the history view in inkInput so `c`
      // doesn't fire elsewhere. Empty key keeps it palette-discoverable
      // without registering a global hotkey.
      id: 'cherry-pick-commit',
      key: '',
      label: 'Cherry-pick commit',
      description: 'Apply the selected commit on top of the current branch (after confirmation).',
      kind: 'destructive',
      requiresConfirmation: true,
    },
    {
      // Per-view-only: scoped to the commit-diff explore in inkInput.
      // Routed through the y-confirm path because `git checkout <sha> --
      // <path>` overwrites the worktree file unconditionally and we
      // want the user to acknowledge that before discarding any local
      // edits to the path.
      id: 'checkout-file-from-commit',
      key: '',
      label: 'Cherry-pick file from commit',
      description: 'Materialize the selected file from this commit into the working tree (after confirmation).',
      kind: 'destructive',
      requiresConfirmation: true,
    },
    {
      // Per-view-only: scoped to the stash-diff explorer in inkInput.
      // Same overwrite rationale as `checkout-file-from-commit` — the
      // y-confirm path is the dirty-tree warning.
      id: 'checkout-file-from-stash',
      key: '',
      label: 'Cherry-pick file from stash',
      description: 'Materialize the selected file from this stash into the working tree (after confirmation).',
      kind: 'destructive',
      requiresConfirmation: true,
    },
    {
      // Per-view-only: scoped to commit-diff and stash-diff explores in
      // inkInput (key: H). The action is non-destructive in the sense
      // that `git apply` won't lose any data — `git apply -R` undoes
      // it cleanly — so it bypasses the y-confirm path. The patch text
      // travels via the action's `payload` field. Empty key keeps the
      // workflow palette-discoverable without registering a global
      // hotkey (the palette path can't synthesize the patch text and
      // surfaces a hint instead — actual dispatch is from H in diff
      // view).
      id: 'apply-hunk-worktree',
      key: '',
      label: 'Apply hunk to worktree',
      description: 'Extract the hunk under the cursor and apply it to the working tree via `git apply`.',
      kind: 'normal',
      requiresConfirmation: false,
    },
    {
      // Sibling of `apply-hunk-worktree` — same extraction path, but
      // `git apply --cached` so the patch lands in the index without
      // touching the worktree. Bound to the `gH` chord in inkInput.
      id: 'apply-hunk-index',
      key: '',
      label: 'Apply hunk to index',
      description: 'Extract the hunk under the cursor and apply it to the index via `git apply --cached`.',
      kind: 'normal',
      requiresConfirmation: false,
    },
    {
      id: 'open-pr',
      key: 'O',
      label: 'Open PR / repo',
      description: 'Open the current branch\'s pull request in the browser, or the repo page if there\'s no PR.',
      kind: 'normal',
      requiresConfirmation: false,
    },
    {
      id: 'fetch-remotes',
      key: 'F',
      label: 'Fetch all remotes',
      description: 'Run `git fetch --all --prune` and silently refresh context.',
      kind: 'normal',
      requiresConfirmation: false,
    },
    {
      id: 'pull-current-branch',
      key: 'U',
      label: 'Pull current branch',
      description: 'Run `git pull --ff-only` against the current branch.',
      kind: 'normal',
      requiresConfirmation: false,
    },
    {
      id: 'push-current-branch',
      key: 'P',
      label: 'Push current branch',
      description: 'Run `git push` for the current branch.',
      kind: 'normal',
      requiresConfirmation: false,
    },
    // Per-view variants of fetch / pull / push that act on the
    // cursored branch instead of the current one. Empty `key` keeps
    // them palette-discoverable without registering a global hotkey —
    // inkInput.ts dispatches them contextually when the user presses
    // F / U / P while the branches sidebar is focused. Outside that
    // context, the F / U / P keys still fire the global *-current-*
    // / fetch-remotes variants above.
    {
      id: 'fetch-selected-branch',
      key: '',
      label: 'Fetch selected branch',
      description: 'Run `git fetch <remote> <branch>` for the cursored branch in the branches view / sidebar.',
      kind: 'normal',
      requiresConfirmation: false,
    },
    {
      id: 'pull-selected-branch',
      key: '',
      label: 'Pull selected branch',
      description: 'Pull the cursored branch in the branches view / sidebar. Falls back to a fast-forward-only refspec fetch when the branch is not currently checked out; refuses non-FF.',
      kind: 'normal',
      requiresConfirmation: false,
    },
    {
      id: 'push-selected-branch',
      key: '',
      label: 'Push selected branch',
      description: 'Run `git push <remote> <branch>` for the cursored branch in the branches view / sidebar.',
      kind: 'normal',
      requiresConfirmation: false,
    },
    {
      // Per-view-only — the inkInput handler scopes this to the tags
      // surface so we don't expose `R` as a remote-delete from elsewhere.
      // The empty `key` keeps the workflow palette-discoverable but does
      // not register a global hotkey.
      id: 'delete-remote-tag',
      key: '',
      label: 'Delete remote tag',
      description: 'Push :tag to origin to delete the selected tag remotely after confirmation.',
      kind: 'destructive',
      requiresConfirmation: true,
    },
    {
      id: 'stage-file',
      key: 'space',
      label: 'Stage or unstage file',
      description: 'Toggle the selected status file between staged and unstaged.',
      kind: 'normal',
      requiresConfirmation: false,
    },
    // Status surface group-level batch ops (#791 follow-up). Triggered
    // by Enter when the cursor is on a status group header
    // (Staged / Unstaged / Untracked). Empty `key` keeps them
    // palette-discoverable without registering a global hotkey — the
    // Enter-on-header path in inkInput is the canonical trigger.
    {
      id: 'unstage-all-staged',
      key: '',
      label: 'Unstage all staged files',
      description: 'Unstage every file currently in the staged group.',
      kind: 'normal',
      requiresConfirmation: false,
    },
    {
      id: 'stage-all-unstaged',
      key: '',
      label: 'Stage all unstaged files',
      description: 'Stage every modified-but-not-staged file.',
      kind: 'normal',
      requiresConfirmation: false,
    },
    {
      id: 'stage-all-untracked',
      key: '',
      label: 'Stage all untracked files',
      description: 'Add every untracked file to the index after confirmation.',
      kind: 'destructive',
      requiresConfirmation: true,
    },
    {
      id: 'delete-branch',
      key: 'D',
      label: 'Delete branch',
      description: 'Delete the selected branch after confirmation.',
      kind: 'destructive',
      requiresConfirmation: true,
    },
    {
      // No key binding — this is raised by the runtime as a second
      // confirmation when a safe `delete-branch` (`git branch -d`) is
      // rejected for an unmerged branch. Reachable from the `:` palette
      // too, as an explicit force-delete that still gates on y-confirm.
      id: 'force-delete-branch',
      key: '',
      label: 'Force-delete branch',
      description: 'Force-delete the selected branch even if it is not fully merged (git branch -D).',
      kind: 'destructive',
      requiresConfirmation: true,
    },
    {
      // #0.71 — rebase the current branch onto the cursored branch/ref
      // (non-interactive `git rebase <ref>`). Per-view-only: the inkInput
      // handler scopes the `r` keystroke to the branches surface and the
      // runtime resolves the cursored + current branch, so the empty
      // `key` keeps it palette-discoverable without registering a global
      // hotkey. The most dangerous op in this release — it rewrites the
      // current branch's history — so it gates on the y-confirm path with
      // a warning naming both branches. A conflict leaves the repo
      // mid-rebase; the existing `gx` / `A` surfaces reflect and unwind
      // it (no `--continue` / `--abort` workflow added here, by design).
      id: 'rebase-onto-branch',
      key: '',
      label: 'Rebase current onto selected ref',
      description: 'Rebase the current branch onto the cursored branch / ref (non-interactive) after confirmation.',
      kind: 'destructive',
      requiresConfirmation: true,
    },
    {
      id: 'delete-tag',
      key: 'T',
      label: 'Delete tag',
      description: 'Delete the selected tag after confirmation.',
      kind: 'destructive',
      requiresConfirmation: true,
    },
    {
      id: 'drop-stash',
      key: 'X',
      label: 'Drop stash',
      description: 'Drop the selected stash after confirmation.',
      kind: 'destructive',
      requiresConfirmation: true,
    },
    {
      // Palette-only create variants (empty `key`): no global hotkey to
      // collide with `S` / `gZ`, reachable from `:`. Both stash a quick
      // WIP entry with the requested scope.
      id: 'stash-staged',
      key: '',
      label: 'Stash staged only',
      description: 'Stash just the staged (index) changes — `git stash push --staged`.',
      kind: 'normal',
      requiresConfirmation: false,
    },
    {
      id: 'stash-keep-index',
      key: '',
      label: 'Stash keeping index',
      description: 'Stash everything but leave the index intact for an immediate commit — `git stash push --keep-index`.',
      kind: 'normal',
      requiresConfirmation: false,
    },
    {
      id: 'remove-worktree',
      key: 'W',
      label: 'Remove worktree',
      description: 'Remove the selected linked worktree after confirmation.',
      kind: 'destructive',
      requiresConfirmation: true,
    },
    {
      // Per-view-only — the inkInput handler scopes this to the
      // worktrees surface so the global `D` keystroke (delete-branch)
      // keeps working from elsewhere. The empty `key` keeps the
      // workflow palette-discoverable but does not register a global
      // hotkey that would collide with delete-branch.
      id: 'remove-worktree-and-branch',
      key: '',
      label: 'Remove worktree + delete branch',
      description: 'Remove the selected worktree and delete the branch it was tracking after confirmation.',
      kind: 'destructive',
      requiresConfirmation: true,
    },
    {
      id: 'abort-operation',
      key: 'A',
      label: 'Abort operation',
      description: 'Abort the in-progress Git operation after confirmation.',
      kind: 'destructive',
      requiresConfirmation: true,
    },
    // #783 — full PR action panel. All five entries are palette-only
    // (`key: ''`) — actual dispatch is per-view scoped in inkInput so
    // the keys stay free outside the pull-request view. Merge / close /
    // approve / request-changes route through the y-confirm path
    // because each is irreversible (or near-irreversible) once gh
    // publishes it; comment is a free-form prompt with no extra
    // confirmation since the body itself is the affirmative action.
    {
      id: 'merge-pr',
      key: '',
      label: 'Merge pull request',
      description: 'Merge the current branch\'s pull request (prompts for merge / squash / rebase, then confirms).',
      kind: 'destructive',
      requiresConfirmation: true,
    },
    {
      id: 'close-pr',
      key: '',
      label: 'Close pull request',
      description: 'Close the current pull request without merging.',
      kind: 'destructive',
      requiresConfirmation: true,
    },
    {
      id: 'approve-pr',
      key: '',
      label: 'Approve pull request',
      description: 'Submit an approving review on the current pull request.',
      kind: 'normal',
      requiresConfirmation: true,
    },
    {
      id: 'request-changes-pr',
      key: '',
      label: 'Request changes on pull request',
      description: 'Submit a change-request review (prompts for the review body, then confirms).',
      kind: 'normal',
      requiresConfirmation: true,
    },
    {
      id: 'comment-pr',
      key: '',
      label: 'Comment on pull request',
      description: 'Add a comment to the current pull request (prompts for body).',
      kind: 'normal',
      requiresConfirmation: false,
    },
    // #882 phase 5 — triage-view destructive verbs. Each routed
    // through the y-confirm path so single-keystroke `x` / `a` /
    // `R` / `m` never silently rewrites publicly-visible state.
    // The runner reads the cursored item from the filtered list
    // at confirm-time — the cursor can't move while the
    // confirmation overlay is up, so no stale-target risk.
    {
      id: 'triage-issue-close',
      key: '',
      label: 'Close issue',
      description: 'Close the cursored issue on the triage list view.',
      kind: 'destructive',
      requiresConfirmation: true,
    },
    {
      id: 'triage-issue-reopen',
      key: '',
      label: 'Reopen issue',
      description: 'Reopen the cursored issue on the triage list view.',
      kind: 'normal',
      requiresConfirmation: true,
    },
    {
      id: 'triage-pr-merge',
      key: '',
      label: 'Merge pull request',
      description: 'Merge the cursored pull request on the triage list view (prompts for merge / squash / rebase, then confirms).',
      kind: 'destructive',
      requiresConfirmation: true,
    },
    {
      id: 'triage-pr-close',
      key: '',
      label: 'Close pull request',
      description: 'Close the cursored pull request on the triage list view without merging.',
      kind: 'destructive',
      requiresConfirmation: true,
    },
    {
      id: 'triage-pr-approve',
      key: '',
      label: 'Approve pull request',
      description: 'Submit an approving review on the cursored pull request.',
      kind: 'normal',
      requiresConfirmation: true,
    },
    {
      id: 'triage-pr-request-changes',
      key: '',
      label: 'Request changes on pull request',
      description: 'Submit a change-request review on the cursored pull request (prompts for body, then confirms).',
      kind: 'normal',
      requiresConfirmation: true,
    },
    {
      // Per-view-only: scoped to the history view in inkInput so `R`
      // doesn't fire elsewhere (it's also `R` for rename in branches
      // and delete-remote-tag in tags). Empty key keeps it
      // palette-discoverable without registering a global hotkey.
      id: 'revert-commit',
      key: '',
      label: 'Revert commit',
      description: 'Revert the cursored commit by adding an inverse commit on top of HEAD.',
      kind: 'destructive',
      requiresConfirmation: true,
    },
    {
      // Per-view-only: scoped to the history view in inkInput. Triggers
      // a mode prompt (soft / mixed / hard) before the reset runs so
      // `Z` alone never silently rewrites history.
      id: 'reset-to-commit',
      key: '',
      label: 'Reset to commit',
      description: 'Move the current branch tip to the cursored commit (prompts for soft / mixed / hard).',
      kind: 'destructive',
      requiresConfirmation: true,
    },
    {
      // Per-view-only: scoped to the history view in inkInput (key `B`).
      // The prompt itself is the affirmative gate — the user has to
      // type a branch name before anything happens — so this skips the
      // y-confirm path. Empty key keeps it palette-discoverable; the
      // palette path can't synthesize a branch name and surfaces a
      // hint instead.
      //
      // Distinct from `create-branch` (palette / `+` on branches view),
      // which uses `git switch -c` and switches onto the new branch.
      // This workflow uses `git branch <name> <sha>` and stays put —
      // GitKraken's "create branch here" semantic.
      id: 'create-branch-here',
      key: '',
      label: 'Create branch from commit',
      description: 'Create a branch pointed at the cursored commit (does not switch).',
      kind: 'normal',
      requiresConfirmation: false,
    },
    {
      // Per-view-only: scoped to the history view in inkInput via the
      // `gT` chord (bare `T` is taken by delete-tag on the tags view).
      // Same prompt-as-confirmation pattern as create-branch-here.
      // Lightweight tag — annotated tags remain available through the
      // existing `+` flow on the tags view.
      id: 'create-tag-here',
      key: '',
      label: 'Create tag at commit',
      description: 'Create a lightweight tag at the cursored commit.',
      kind: 'normal',
      requiresConfirmation: false,
    },
    {
      // Per-view-only: scoped to the history view in inkInput. `i`
      // (lowercase) is used instead of `I` so the existing `I`
      // ai-commit-summary workflow stays reachable on the history
      // view — `i` matches the `git rebase -i` flag mnemonic anyway.
      id: 'interactive-rebase',
      key: '',
      label: 'Interactive rebase',
      description: 'Start an interactive rebase from the cursored commit (opens $GIT_EDITOR for the todo list).',
      kind: 'destructive',
      requiresConfirmation: true,
    },
    {
      // #0.67 — reflog "time machine". Scoped to the reflog view in
      // inkInput (key `c`). Checking out a reflog entry detaches HEAD at
      // that commit so the user can inspect or recover from it — it's
      // reversible (no refs move) so it skips the y-confirm path.
      // Reset-to-entry and branch-from-entry reuse the existing
      // `reset-to-commit` / `create-branch-here` workflows (a reflog
      // entry is just a commit by hash); only checkout is reflog-specific.
      id: 'checkout-reflog-entry',
      key: 'c',
      label: 'Checkout reflog entry',
      description: 'Check out the commit at the cursored reflog entry (detaches HEAD).',
      kind: 'normal',
      requiresConfirmation: false,
    },
    {
      // #0.71 — submodule maintenance actions. All three are scoped
      // per-view in inkInput (active only when activeView ===
      // 'submodules') so their single-letter keys (i / u / s) stay free
      // elsewhere. Empty `key` keeps them palette-discoverable. None are
      // destructive — init/update/sync can't lose committed work — so
      // they run immediately, no y-confirm.
      id: 'submodule-init',
      key: '',
      label: 'Submodule: init',
      description: 'Register the cursored submodule in .git/config from its .gitmodules entry.',
      kind: 'normal',
      requiresConfirmation: false,
    },
    {
      id: 'submodule-update',
      key: '',
      label: 'Submodule: update',
      description: 'Fetch and check out the cursored submodule at the pinned commit (init first if needed).',
      kind: 'normal',
      requiresConfirmation: false,
    },
    {
      id: 'submodule-sync',
      key: '',
      label: 'Submodule: sync URL',
      description: 'Re-sync the cursored submodule’s remote URL from .gitmodules into config.',
      kind: 'normal',
      requiresConfirmation: false,
    },
    {
      // #0.71 — remote management. All four are scoped per-view in
      // inkInput (active only when activeView === 'remotes') so their
      // single-letter keys (a / e / x / p) stay free elsewhere. Empty
      // `key` keeps them palette-discoverable. add / set-url collect
      // input via a prompt (the prompt is the affirmative gate); remove
      // and prune are destructive (they drop refs) so they route through
      // the y-confirm path.
      id: 'remote-add',
      key: '',
      label: 'Remote: add',
      description: 'Add a new remote (prompts for `name url`).',
      kind: 'normal',
      requiresConfirmation: false,
    },
    {
      id: 'remote-set-url',
      key: '',
      label: 'Remote: set URL',
      description: 'Repoint the cursored remote at a new URL (prompts for the URL).',
      kind: 'normal',
      requiresConfirmation: false,
    },
    {
      id: 'remote-remove',
      key: '',
      label: 'Remote: remove',
      description: 'Remove the cursored remote and its tracking refs after confirmation.',
      kind: 'destructive',
      requiresConfirmation: true,
    },
    {
      id: 'remote-prune',
      key: '',
      label: 'Remote: prune',
      description: 'Prune stale remote-tracking refs for the cursored remote after confirmation.',
      kind: 'destructive',
      requiresConfirmation: true,
    },
    {
      // #784 — bisect workflow actions. All four are scoped per-view in
      // inkInput (active only when activeView === 'bisect') so the
      // single-letter keys stay free elsewhere. Empty `key` keeps them
      // palette-discoverable. Reset is the only destructive one — it
      // throws away the bisect state — so it routes through y-confirm;
      // good / bad / skip are recoverable via `git bisect log` and run
      // immediately.
      id: 'bisect-good',
      key: '',
      label: 'Bisect: mark good',
      description: 'Mark the current bisect candidate as good and advance to the next one.',
      kind: 'normal',
      requiresConfirmation: false,
    },
    {
      id: 'bisect-bad',
      key: '',
      label: 'Bisect: mark bad',
      description: 'Mark the current bisect candidate as bad and advance to the next one.',
      kind: 'normal',
      requiresConfirmation: false,
    },
    {
      id: 'bisect-skip',
      key: '',
      label: 'Bisect: skip candidate',
      description: 'Skip the current bisect candidate (e.g. it does not build) and advance.',
      kind: 'normal',
      requiresConfirmation: false,
    },
    {
      id: 'bisect-reset',
      key: '',
      label: 'Bisect: reset',
      description: 'End the bisect session and restore HEAD. Discards in-progress bisect state.',
      kind: 'destructive',
      requiresConfirmation: true,
    },
    {
      // #879 item 5 — `git bisect run <cmd>` integration. Empty `key`
      // because the supported entry is the input prompt fired by `R`
      // on the active bisect view; palette execution wouldn't have a
      // command payload to pass. `kind: 'normal'` because the loop is
      // recoverable via `git bisect reset`. The prompt itself serves
      // as the implicit confirmation.
      id: 'bisect-run',
      key: '',
      label: 'Bisect: run command',
      description: 'Drive the bisect via `git bisect run sh -c <command>` — exit code marks good/bad/skip.',
      kind: 'normal',
      requiresConfirmation: false,
    },
    {
      // #879 item 4 — in-TUI bisect start wizard. Empty `key` keeps
      // the keybinding out of the global map; the supported entry
      // point is `s` on the bisect empty state, which fires the
      // wizard inline (two Enter taps on history). Marked as 'normal'
      // (not destructive) because `git bisect start` is recoverable
      // via `git bisect reset` and doesn't modify worktree content.
      id: 'bisect-start-from-history',
      key: '',
      label: 'Bisect: start from history selections',
      description: 'Run git bisect start with the bad/good commits picked from history (newline-separated payload).',
      kind: 'normal',
      requiresConfirmation: false,
    },
    {
      id: 'ai-commit-summary',
      key: 'I',
      label: 'AI commit summary',
      description: 'Summarize the selected commit with token/cost awareness.',
      kind: 'ai',
      requiresConfirmation: true,
      estimatedTokens: 800,
    },
    {
      id: 'ai-conflict-help',
      key: 'M',
      label: 'AI conflict help',
      description: 'Explain conflicted files and suggest resolution steps.',
      kind: 'ai',
      requiresConfirmation: true,
      estimatedTokens: 1200,
    },
  ]
}

export function getLogInkWorkflowActionByKey(
  inputValue: string
): LogInkWorkflowAction | undefined {
  // Workflow actions with an empty `key` are palette-only — they
  // exist so the command palette can surface them but should never
  // match a raw keystroke. Without this guard, any unbound key
  // (left/right arrow, function keys) that arrives with an empty
  // inputValue would `find()` the first empty-key entry —
  // `cherry-pick-commit` — and pop its confirmation dialog.
  if (!inputValue) {
    return undefined
  }
  return getLogInkWorkflowActions().find((action) => action.key === inputValue)
}

export function getLogInkWorkflowActionById(
  id: string | undefined
): LogInkWorkflowAction | undefined {
  if (!id) {
    return undefined
  }

  return getLogInkWorkflowActions().find((action) => action.id === id)
}
