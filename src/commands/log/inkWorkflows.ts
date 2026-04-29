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
        context.branches
          ? `${countLabel(context.branches.localBranches.length, 'local branch', 'local branches')} | ${countLabel(context.branches.remoteBranches.length, 'remote branch', 'remote branches')}`
          : 'Branch data unavailable',
      ],
    },
    {
      title: 'Provider / PR',
      lines: [
        `Repository: ${repoName}`,
        currentPullRequest
          ? `PR #${currentPullRequest.number} ${currentPullRequest.state}${currentPullRequest.isDraft ? ' draft' : ''}`
          : 'No pull request detected for current branch',
        context.provider?.authenticated === false ? 'Provider auth: offline' : 'Provider auth: available',
      ],
    },
    {
      title: 'Status',
      lines: worktree
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
        context.tags ? countLabel(context.tags.tags.length, 'tag') : 'Tags unavailable',
        context.stashes ? countLabel(context.stashes.stashes.length, 'stash', 'stashes') : 'Stashes unavailable',
        context.worktreeList
          ? countLabel(context.worktreeList.worktrees.length, 'worktree')
          : 'Worktrees unavailable',
      ],
    },
    {
      title: 'Operation / AI',
      lines: [
        operation?.operation
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
