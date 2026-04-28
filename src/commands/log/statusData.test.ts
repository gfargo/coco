import { parsePorcelainStatus } from './statusData'

describe('log status data', () => {
  it('parses staged, unstaged, untracked, and rename status rows', () => {
    expect(parsePorcelainStatus([
      'M  staged.ts',
      ' M unstaged.ts',
      '?? new.ts',
      'R  old.ts -> renamed.ts',
    ].join('\n'))).toEqual([
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
      {
        path: 'renamed.ts',
        indexStatus: 'R',
        worktreeStatus: ' ',
        state: 'staged',
      },
    ])
  })
})
