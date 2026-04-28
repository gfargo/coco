import { GitCommitDetail, GitLogRow } from './data'
import { createLogTuiState } from './interactiveState'
import { renderInteractiveLog } from './interactive'
import { BranchOverview } from './branchData'
import { PullRequestOverview } from './pullRequestData'

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

describe('log interactive renderer', () => {
  it('renders commit navigation, selected details, changed files, and help', () => {
    const output = renderInteractiveLog(createLogTuiState(rows), detail, branches, pullRequest, {}, {
      height: 52,
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
    expect(output).toContain('Keys:')
  })

  it('renders branch focus, status, and pending delete prompts', () => {
    const output = renderInteractiveLog(
      createLogTuiState(rows),
      detail,
      branches,
      pullRequest,
      {
        focus: 'branches',
        branchIndex: 0,
        statusMessage: 'Press D to confirm deleting main',
        pendingDeleteBranch: 'main',
      },
      {
        height: 52,
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
        height: 52,
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
        height: 52,
        width: 100,
      }
    )

    expect(output).toContain('Create draft PR into main: Add PR workflow_')
    expect(output).toContain('C PR')
    expect(output).toContain('v draft')
  })
})
