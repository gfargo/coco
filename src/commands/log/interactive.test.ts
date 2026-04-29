import { GitCommitDetail, GitLogRow } from './data'
import { createLogTuiState } from './interactiveState'
import { renderInteractiveLog } from './interactive'
import { BranchOverview } from './branchData'
import { PullRequestOverview } from './pullRequestData'
import { TagOverview, TagRangeSummary } from './tagData'
import { WorktreeOverview } from './statusData'
import { WorktreeHunkOverview } from './statusHunks'
import { StashOverview } from './stashData'
import { WorktreeOverview as WorktreeListOverview } from './worktreeData'
import { GitOperationOverview } from './operationData'
import { ProviderOverview } from './providerData'

const rows: GitLogRow[] = [
  {
    type: 'commit',
    graph: '*',
    shortHash: 'abc1234',
    hash: 'abc1234',
    date: '2026-04-27',
    author: 'Coco Test',
    refs: ['HEAD -> main'],
    message: 'feat: add interactive log',
  },
]

const detail: GitCommitDetail = {
  shortHash: 'abc1234',
  hash: 'abc1234',
  date: '2026-04-27',
  author: 'Coco Test',
  refs: ['HEAD -> main'],
  message: 'feat: add interactive log',
  body: 'Adds the first terminal UI.',
  files: [
    {
      status: 'A',
      path: 'src/commands/log/interactive.ts',
    },
  ],
}

const branches: BranchOverview = {
  currentBranch: 'main',
  dirty: true,
  localBranches: [
    {
      type: 'local',
      name: 'refs/heads/main',
      shortName: 'main',
      hash: 'abc1234',
      upstream: 'origin/main',
      current: true,
      date: '2026-04-27',
      subject: 'feat: add interactive log',
      ahead: 1,
      behind: 2,
    },
  ],
  remoteBranches: [
    {
      type: 'remote',
      name: 'refs/remotes/origin/main',
      shortName: 'origin/main',
      hash: 'abc1234',
      current: false,
      remote: 'origin',
      date: '2026-04-27',
      subject: 'feat: add interactive log',
      ahead: 0,
      behind: 0,
    },
  ],
}

const pullRequest: PullRequestOverview = {
  available: true,
  authenticated: true,
  repository: {
    owner: 'gfargo',
    name: 'coco',
  },
  currentBranch: 'feature/log-prs',
  currentPullRequest: {
    number: 123,
    title: 'Add PR workflow',
    url: 'https://github.com/gfargo/coco/pull/123',
    state: 'OPEN',
    isDraft: false,
    headRefName: 'feature/log-prs',
    baseRefName: 'main',
  },
}

const tags: TagOverview = {
  tags: [
    {
      name: '0.33.0',
      hash: 'abc1234',
      date: '2026-04-27',
      subject: 'release v0.33.0',
    },
  ],
}

const tagRangeSummary: TagRangeSummary = {
  from: '0.33.0',
  to: 'HEAD',
  commitCount: 4,
  authors: ['Coco Test'],
  changedFiles: ['src/commands/log/interactive.ts'],
}

const worktree: WorktreeOverview = {
  stagedCount: 1,
  unstagedCount: 1,
  untrackedCount: 1,
  files: [
    {
      path: 'staged.ts',
      indexStatus: 'M',
      worktreeStatus: ' ',
      state: 'staged',
    },
    {
      path: 'unstaged.ts',
      indexStatus: ' ',
      worktreeStatus: 'M',
      state: 'unstaged',
    },
    {
      path: 'new.ts',
      indexStatus: '?',
      worktreeStatus: '?',
      state: 'untracked',
    },
  ],
}

const statusHunks = {
  filePath: 'unstaged.ts',
  hunks: [
    {
      id: 'unstaged.ts::unstaged-hunk-1',
      filePath: 'unstaged.ts',
      state: 'unstaged',
      header: '@@ -1,1 +1,1 @@',
      preview: '-old +new',
      patch: {},
      hunk: {},
    },
  ],
} as WorktreeHunkOverview

const stashOverview: StashOverview = {
  stashes: [
    {
      ref: 'stash@{0}',
      hash: 'abc123',
      date: '2026-04-28 09:00:00 -0400',
      branch: 'main',
      message: 'save local edits',
      files: ['src/a.ts', 'src/b.ts'],
    },
  ],
}

const worktreeList: WorktreeListOverview = {
  currentPath: '/repo',
  worktrees: [
    {
      path: '/repo',
      head: 'abc123',
      branch: 'main',
      detached: false,
      bare: false,
      current: true,
      dirty: false,
    },
    {
      path: '/repo-feature',
      head: 'def456',
      branch: 'feature/log',
      detached: false,
      bare: false,
      current: false,
      dirty: true,
    },
  ],
}

const reflog = [
  {
    selector: 'HEAD@{0}',
    hash: 'abc1234',
    subject: 'commit: feat: add interactive log',
  },
]

const operationOverview: GitOperationOverview = {
  operation: 'merge',
  conflictedFiles: [
    {
      path: 'src/conflict.ts',
      indexStatus: 'U',
      worktreeStatus: 'U',
    },
  ],
  conflictMarkers: [
    {
      path: 'src/conflict.ts',
      line: 12,
      marker: '<<<<<<< HEAD',
    },
  ],
  hooks: {
    hooksPath: '/repo/.git/hooks',
    configuredHooks: ['pre-commit', 'commit-msg'],
  },
  aiConflictHelpAvailable: true,
}

const providerOverview: ProviderOverview = {
  authenticated: true,
  currentBranch: 'feature/log-prs',
  repository: {
    provider: 'github',
    remote: 'origin',
    owner: 'gfargo',
    name: 'coco',
    webUrl: 'https://github.com/gfargo/coco',
    defaultBranch: 'main',
  },
  currentPullRequest: {
    number: 123,
    title: 'Add PR workflow',
    state: 'OPEN',
    isDraft: false,
    reviewDecision: 'APPROVED',
    statusCheckRollup: [
      {
        name: 'test',
        conclusion: 'SUCCESS',
      },
    ],
  },
}

describe('log interactive renderer', () => {
  it('renders commit navigation, selected details, changed files, and help', () => {
    const output = renderInteractiveLog(createLogTuiState(rows), detail, branches, pullRequest, tags, undefined, worktree, {}, {
      height: 70,
      width: 140,
    })

    expect(output).toContain('coco log')
    expect(output).toContain('1/1 commits')
    expect(output).toContain('feat: add interactive log')
    expect(output).toContain('Changed files:')
    expect(output).toContain('A  src/commands/log/interactive.ts')
    expect(output).toContain('Branches: main | dirty worktree')
    expect(output).toContain('* main +1/-2 vs origin/main')
    expect(output).toContain('origin/main')
    expect(output).toContain('Pull request: #123 OPEN feature/log-prs -> main')
    expect(output).toContain('Add PR workflow')
    expect(output).toContain('0.33.0')
    expect(output).toContain('Status: 1 staged, 1 unstaged, 1 untracked')
    expect(output).toContain('c commit')
    expect(output).toContain('e amend')
    expect(output).toContain('w reword')
    expect(output).toContain('h hash')
    expect(output).toContain('= compare')
    expect(output).toContain('S split plan')
    expect(output).toContain('A split apply')
    expect(output).toContain('Operation: unavailable')
    expect(output).toContain('Keys:')
    expect(output).toContain('Commit actions: e amend HEAD | w reword HEAD')
  })

  it('renders provider context, checks, and compare state', () => {
    const output = renderInteractiveLog(
      createLogTuiState(rows),
      detail,
      branches,
      pullRequest,
      tags,
      undefined,
      worktree,
      {
        focus: 'commits',
      },
      {
        height: 90,
        width: 140,
      },
      {},
      {
        providerCompareBase: 'main',
      },
      undefined,
      providerOverview
    )

    expect(output).toContain('Provider: github gfargo/coco | default main | authenticated')
    expect(output).toContain('Repository: https://github.com/gfargo/coco')
    expect(output).toContain('Provider PR: #123 OPEN review APPROVED')
    expect(output).toContain('Checks: test:SUCCESS')
    expect(output).toContain('Provider compare base: main')
    expect(output).toContain('Provider actions: R repo | L branch | O commit | U compare | o PR')
  })

  it('renders in-progress operation, conflicts, hooks, and no-verify state', () => {
    const output = renderInteractiveLog(
      createLogTuiState(rows),
      detail,
      branches,
      pullRequest,
      tags,
      undefined,
      worktree,
      {
        focus: 'commits',
        pendingOperationAction: 'abort',
        noVerify: true,
      },
      {
        height: 90,
        width: 140,
      },
      {},
      {},
      operationOverview
    )

    expect(output).toContain('Operation: merge in progress | no-verify on')
    expect(output).toContain('Pending abort: press G to confirm abort merge')
    expect(output).toContain('Conflicts: 1')
    expect(output).toContain('UU src/conflict.ts')
    expect(output).toContain('src/conflict.ts:12 <<<<<<< HEAD')
    expect(output).toContain('Hooks: pre-commit, commit-msg')
    expect(output).toContain('AI conflict help: opt-in action planned')
  })

  it('renders commit history actions and recovery state', () => {
    const output = renderInteractiveLog(
      createLogTuiState(rows),
      detail,
      branches,
      pullRequest,
      tags,
      undefined,
      worktree,
      {
        focus: 'commits',
        pendingResetCommit: 'abc1234',
        pendingResetMode: 'mixed',
      },
      {
        height: 80,
        width: 140,
      },
      {},
      {
        compareBase: {
          hash: 'abc1234',
          shortHash: 'abc1234',
          message: 'feat: add interactive log',
        },
        reflog,
      }
    )

    expect(output).toContain('History:')
    expect(output).toContain('Pending reset: press X to reset --mixed to abc1234')
    expect(output).toContain('Compare base: abc1234 feat: add interactive log')
    expect(output).toContain('Reflog:')
    expect(output).toContain('HEAD@{0} abc1234 commit: feat: add interactive log')
  })

  it('renders selected file hunks and hunk staging controls', () => {
    const output = renderInteractiveLog(
      createLogTuiState(rows),
      detail,
      branches,
      pullRequest,
      tags,
      undefined,
      worktree,
      {
        focus: 'status',
        statusIndex: 1,
        statusHunks,
        statusHunkIndex: 0,
      },
      {
        height: 70,
        width: 120,
      }
    )

    expect(output).toContain('Focus: status')
    expect(output).toContain('Hunks: unstaged.ts')
    expect(output).toContain('> [U] @@ -1,1 +1,1 @@ -old +new')
    expect(output).toContain('enter hunk')
    expect(output).toContain('[/] hunk select')
  })

  it('renders selected hunk revert confirmation without extra chrome', () => {
    const output = renderInteractiveLog(
      createLogTuiState(rows),
      detail,
      branches,
      pullRequest,
      tags,
      undefined,
      worktree,
      {
        focus: 'status',
        statusIndex: 1,
        statusHunks,
        statusHunkIndex: 0,
        pendingRevertHunk: 'unstaged.ts::unstaged-hunk-1',
      },
      {
        height: 70,
        width: 120,
      }
    )

    expect(output).toContain('Pending hunk revert: press Z to revert selected hunk')
    expect(output).toContain('> [U] @@ -1,1 +1,1 @@ -old +new')
  })

  it('renders stash and worktree workspace controls', () => {
    const output = renderInteractiveLog(
      createLogTuiState(rows),
      detail,
      branches,
      pullRequest,
      tags,
      undefined,
      worktree,
      {
        focus: 'workspace',
        workspaceSection: 'stashes',
        stashIndex: 0,
      },
      {
        height: 80,
        width: 140,
      },
      {
        stashes: stashOverview,
        worktreeList,
        stashDiffSummary: [' src/a.ts | 2 +-', ' 1 file changed'],
      }
    )

    expect(output).toContain('Focus: workspace')
    expect(output).toContain('Workspace: stashes')
    expect(output).toContain('> stash@{0} main: save local edits 2 file(s)')
    expect(output).toContain('  feature/log dirty /repo-feature')
    expect(output).toContain('src/a.ts | 2 +-')
    expect(output).toContain('s stash')
    expect(output).toContain('B branch+worktree')
  })

  it('renders workspace destructive confirmations', () => {
    const output = renderInteractiveLog(
      createLogTuiState(rows),
      detail,
      branches,
      pullRequest,
      tags,
      undefined,
      worktree,
      {
        focus: 'workspace',
        workspaceSection: 'worktrees',
        worktreeIndex: 1,
        pendingRemoveWorktree: '/repo-feature',
      },
      {
        height: 80,
        width: 140,
      },
      {
        stashes: stashOverview,
        worktreeList,
      }
    )

    expect(output).toContain('Workspace: worktrees')
    expect(output).toContain('>  feature/log dirty /repo-feature')
    expect(output).toContain('Pending worktree remove: press X to remove /repo-feature')
  })

  it('renders branch focus, status, and pending delete prompts', () => {
    const output = renderInteractiveLog(
      createLogTuiState(rows),
      detail,
      branches,
      pullRequest,
      tags,
      undefined,
      worktree,
      {
        focus: 'branches',
        branchIndex: 0,
        statusMessage: 'Press D to confirm deleting main',
        pendingDeleteBranch: 'main',
      },
      {
        height: 70,
        width: 100,
      }
    )

    expect(output).toContain('Focus: branches')
    expect(output).toContain('Status: Press D to confirm deleting main')
    expect(output).toContain('Pending delete: press D to delete main')
    expect(output).toContain('>* main +1/-2 vs origin/main')
  })

  it('renders concise action feedback details below the status line', () => {
    const output = renderInteractiveLog(
      createLogTuiState(rows),
      detail,
      branches,
      pullRequest,
      tags,
      undefined,
      worktree,
      {
        focus: 'status',
        statusMessage: 'Commit blocked by hook: eslint failed',
        statusDetails: [
          'src/file.ts:1:1 error no-unused-vars',
          'Run npm run lint before committing',
        ],
      },
      {
        height: 70,
        width: 120,
      }
    )

    expect(output).toContain('Status: Commit blocked by hook: eslint failed')
    expect(output).toContain('  src/file.ts:1:1 error no-unused-vars')
    expect(output).toContain('  Run npm run lint before committing')
  })

  it('renders branch input prompts for create and rename actions', () => {
    const output = renderInteractiveLog(
      createLogTuiState(rows),
      detail,
      branches,
      {
        available: true,
        authenticated: true,
        currentBranch: 'feature/log-prs',
        message: 'No pull request found for feature/log-prs.',
      },
      tags,
      undefined,
      worktree,
      {
        focus: 'branches',
        branchIndex: 0,
        inputPrompt: {
          kind: 'rename-branch',
          label: 'Rename main to',
          value: 'feature/main',
          sourceRef: 'main',
          branchName: 'main',
        },
      },
      {
        height: 70,
        width: 100,
      }
    )

    expect(output).toContain('Rename main to: feature/main_')
    expect(output).toContain('n branch')
    expect(output).toContain('enter checkout')
    expect(output).toContain('Pull request: no PR for feature/log-prs')
  })

  it('renders reword prompts as a focused commit action', () => {
    const output = renderInteractiveLog(
      createLogTuiState(rows),
      detail,
      branches,
      pullRequest,
      tags,
      undefined,
      worktree,
      {
        focus: 'commits',
        inputPrompt: {
          kind: 'reword-commit',
          label: 'Reword HEAD',
          value: 'feat: updated title',
          sourceRef: 'abc1234',
          commitHash: 'abc1234',
        },
      },
      {
        height: 70,
        width: 120,
      }
    )

    expect(output).toContain('Reword HEAD: feat: updated title_')
    expect(output).toContain('Commit actions: e amend HEAD | w reword HEAD')
  })

  it('renders PR create prompts and draft mode', () => {
    const output = renderInteractiveLog(
      createLogTuiState(rows),
      detail,
      branches,
      pullRequest,
      tags,
      undefined,
      worktree,
      {
        inputPrompt: {
          kind: 'create-pr-title',
          label: 'Create draft PR into main',
          value: 'Add PR workflow',
          sourceRef: 'feature/log-prs',
          baseRef: 'main',
        },
        pullRequestDraft: true,
      },
      {
        height: 70,
        width: 100,
      }
    )

    expect(output).toContain('Create draft PR into main: Add PR workflow_')
    expect(output).toContain('C PR')
    expect(output).toContain('v draft')
  })

  it('renders tag focus, delete prompts, and release range summaries', () => {
    const output = renderInteractiveLog(
      createLogTuiState(rows),
      detail,
      branches,
      pullRequest,
      tags,
      tagRangeSummary,
      worktree,
      {
        focus: 'tags',
        tagIndex: 0,
        pendingDeleteTag: '0.33.0',
      },
      {
        height: 60,
        width: 100,
      }
    )

    expect(output).toContain('Focus: tags')
    expect(output).toContain('> 0.33.0 2026-04-27 abc1234 release v0.33.0')
    expect(output).toContain('Pending tag delete: press X to delete 0.33.0')
    expect(output).toContain('Range 0.33.0..HEAD: 4 commits, 1 authors, 1 files')
  })

  it('renders status focus and revert confirmation', () => {
    const output = renderInteractiveLog(
      createLogTuiState(rows),
      detail,
      branches,
      pullRequest,
      tags,
      undefined,
      worktree,
      {
        focus: 'status',
        statusIndex: 1,
        pendingRevertFile: 'unstaged.ts',
      },
      {
        height: 70,
        width: 100,
      }
    )

    expect(output).toContain('Focus: status')
    expect(output).toContain('>  M unstaged.ts')
    expect(output).toContain('Pending revert: press Z to revert unstaged.ts')
  })
})
