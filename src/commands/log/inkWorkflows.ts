import { BranchOverview } from './branchData'
import { GitLogCommitRow } from './data'
import { GitOperationOverview } from './operationData'
import { ProviderOverview } from './providerData'
import { PullRequestOverview } from './pullRequestData'
import { StashOverview } from './stashData'
import { WorktreeOverview } from './statusData'
import { TagOverview } from './tagData'
import { WorktreeOverview as WorktreeListOverview } from './worktreeData'

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
    {
      id: 'delete-branch',
      key: 'D',
      label: 'Delete branch',
      description: 'Delete the selected branch after confirmation.',
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
      id: 'remove-worktree',
      key: 'W',
      label: 'Remove worktree',
      description: 'Remove the selected linked worktree after confirmation.',
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
