import { GitCommitDetail, GitLogRow } from './data'
import { createLogTuiState } from './interactiveState'
import { renderInteractiveLog } from './interactive'
import { BranchOverview } from './branchData'
import { PullRequestOverview } from './pullRequestData'
import { TagOverview, TagRangeSummary } from './tagData'
import { WorktreeOverview } from './statusData'

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

describe('log interactive renderer', () => {
  it('renders commit navigation, selected details, changed files, and help', () => {
    const output = renderInteractiveLog(createLogTuiState(rows), detail, branches, pullRequest, tags, undefined, worktree, {}, {
      height: 70,
      width: 100,
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
    expect(output).toContain('Keys:')
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
    expect(output).toContain('space stage')
  })
})
