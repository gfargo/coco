import { GitCommitDetail, GitLogRow } from '../../git/logData'
import { createLogTuiState } from './interactiveState'
import { renderInteractiveLog } from './interactive'
import { cellWidth } from '../chrome/text'
import { BranchOverview } from '../../git/branchData'
import { PullRequestOverview } from '../../git/pullRequestData'
import { TagOverview } from '../../git/tagData'
import { WorktreeOverview } from '../../git/statusData'
import { StashOverview } from '../../git/stashData'
import { WorktreeOverview as WorktreeListOverview } from '../../git/worktreeData'
import { GitOperationOverview } from '../../git/operationData'
import { ProviderOverview } from '../../git/providerData'

const rows: GitLogRow[] = [
  {
    type: 'commit',
    graph: '*',
    shortHash: 'abc1234',
    hash: 'abc1234',
    parents: [],
    date: '2026-04-27',
    author: 'Coco Test',
    refs: ['HEAD -> main'],
    message: 'feat: add interactive log',
  },
]

const detail: GitCommitDetail = {
  shortHash: 'abc1234',
  hash: 'abc1234',
  parents: [],
  date: '2026-04-27',
  author: 'Coco Test',
  refs: ['HEAD -> main'],
  message: 'feat: add interactive log',
  body: 'Adds the first terminal UI.',
  files: [
    {
      additions: 12,
      binary: false,
      deletions: 1,
      status: 'A',
      path: 'src/commands/log/interactive.ts',
    },
  ],
  stats: {
    deletions: 1,
    filesChanged: 1,
    insertions: 12,
  },
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

const stashOverview: StashOverview = {
  stashes: [
    {
      ref: 'stash@{0}',
      hash: 'abc123',
      baseHash: 'base111',
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
    const output = renderInteractiveLog(createLogTuiState(rows), detail, branches, pullRequest, tags, worktree, {
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

  it('renders pull request states without a current PR', () => {
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
      worktree,
      {
        height: 70,
        width: 100,
      }
    )

    expect(output).toContain('Pull request: no PR for feature/log-prs')
    expect(output).toContain('Create mode: ready')
    expect(output).toContain('PR actions: C create | v draft toggle | o open current PR')
  })

  it('renders provider context, checks, and repository info', () => {
    const output = renderInteractiveLog(
      createLogTuiState(rows),
      detail,
      branches,
      pullRequest,
      tags,
      worktree,
      {
        height: 90,
        width: 140,
      },
      {},
      undefined,
      providerOverview
    )

    expect(output).toContain('Provider: github gfargo/coco | default main | authenticated')
    expect(output).toContain('Repository: https://github.com/gfargo/coco')
    expect(output).toContain('Provider PR: #123 OPEN review APPROVED')
    expect(output).toContain('Checks: test:SUCCESS')
    expect(output).toContain('Provider actions: R repo | L branch | O commit | U compare | o PR')
  })

  it('renders in-progress operation, conflicts, and hooks', () => {
    const output = renderInteractiveLog(
      createLogTuiState(rows),
      detail,
      branches,
      pullRequest,
      tags,
      worktree,
      {
        height: 90,
        width: 140,
      },
      {},
      operationOverview
    )

    expect(output).toContain('Operation: merge in progress | no-verify off')
    expect(output).toContain('Operation actions: g continue | A abort | K skip | N no-verify')
    expect(output).toContain('Conflicts: 1')
    expect(output).toContain('UU src/conflict.ts')
    expect(output).toContain('src/conflict.ts:12 <<<<<<< HEAD')
    expect(output).toContain('Hooks: pre-commit, commit-msg')
    expect(output).toContain('AI conflict help: opt-in action planned')
  })

  it('renders stash and worktree workspace overview', () => {
    const output = renderInteractiveLog(
      createLogTuiState(rows),
      detail,
      branches,
      pullRequest,
      tags,
      worktree,
      {
        height: 80,
        width: 140,
      },
      {
        stashes: stashOverview,
        worktreeList,
      }
    )

    expect(output).toContain('Workspace: stashes')
    expect(output).toContain('stash@{0} main: save local edits 2 file(s)')
    expect(output).toContain('feature/log dirty /repo-feature')
    expect(output).toContain('s stash')
    expect(output).toContain('B branch+worktree')
  })

  it('pads the author column by cell width so wide-glyph (CJK) names stay aligned (#1624)', () => {
    const wideRows: GitLogRow[] = [
      {
        type: 'commit',
        graph: '*',
        shortHash: 'aaa1111',
        hash: 'aaa1111',
        parents: [],
        date: '2026-05-01',
        author: 'Ada Lovelace',
        refs: [],
        message: 'alpha-message',
      },
      {
        type: 'commit',
        graph: '*',
        shortHash: 'bbb2222',
        hash: 'bbb2222',
        parents: [],
        date: '2026-05-02',
        author: '李雷',
        refs: [],
        message: 'beta-message',
      },
    ]

    const output = renderInteractiveLog(createLogTuiState(wideRows), undefined, undefined, undefined, undefined, undefined, {
      height: 70,
      width: 140,
    })

    const lines = output.split('\n')
    const asciiLine = lines.find((line) => line.includes('alpha-message'))
    const cjkLine = lines.find((line) => line.includes('beta-message'))

    if (!asciiLine || !cjkLine) {
      throw new Error('expected both rendered commit rows to be present')
    }

    const prefixWidth = (line: string, marker: string) =>
      cellWidth(line.slice(0, line.indexOf(marker)))

    expect(prefixWidth(cjkLine, 'beta-message')).toBe(prefixWidth(asciiLine, 'alpha-message'))
  })
})
