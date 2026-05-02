import { applyStatusFilterMask, parsePorcelainStatus, WorktreeFile } from './statusData'

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

  describe('applyStatusFilterMask (#776)', () => {
    const files: WorktreeFile[] = [
      { path: 'a.ts', indexStatus: 'M', worktreeStatus: ' ', state: 'staged' },
      { path: 'b.ts', indexStatus: ' ', worktreeStatus: 'M', state: 'unstaged' },
      { path: 'c.ts', indexStatus: '?', worktreeStatus: '?', state: 'untracked' },
      { path: 'd.ts', indexStatus: 'A', worktreeStatus: ' ', state: 'staged' },
    ]

    it('returns the input array unchanged when the mask is all-on (identity)', () => {
      expect(applyStatusFilterMask(files, { staged: true, unstaged: true, untracked: true }))
        .toBe(files)
    })

    it('keeps only files whose state has a matching bit set', () => {
      expect(
        applyStatusFilterMask(files, { staged: true, unstaged: false, untracked: false })
          .map((f) => f.path)
      ).toEqual(['a.ts', 'd.ts'])

      expect(
        applyStatusFilterMask(files, { staged: false, unstaged: true, untracked: true })
          .map((f) => f.path)
      ).toEqual(['b.ts', 'c.ts'])
    })

    it('returns an empty array when every bit is off (caller decides snap-back behavior)', () => {
      expect(applyStatusFilterMask(files, { staged: false, unstaged: false, untracked: false }))
        .toEqual([])
    })
  })
})
