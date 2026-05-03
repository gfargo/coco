import {
  WorktreeFile,
  applyStatusFilterMask,
  findGroupForIndex,
  flattenWorktreeGroups,
  groupWorktreeFiles,
  parsePorcelainStatus,
} from './statusData'

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

  // #791 follow-up — sectioned view of the file list. Drives the
  // status surface's three-tier cursor model: groups have their own
  // header rows that the cursor can land on.
  describe('groupWorktreeFiles', () => {
    const files: WorktreeFile[] = [
      { path: 'a.ts', indexStatus: 'M', worktreeStatus: ' ', state: 'staged' },
      { path: 'b.ts', indexStatus: ' ', worktreeStatus: 'M', state: 'unstaged' },
      { path: 'c.ts', indexStatus: '?', worktreeStatus: '?', state: 'untracked' },
      { path: 'd.ts', indexStatus: 'A', worktreeStatus: ' ', state: 'staged' },
    ]

    it('emits groups in canonical order regardless of input ordering', () => {
      const groups = groupWorktreeFiles(files)
      expect(groups.map((g) => g.state)).toEqual(['staged', 'unstaged', 'untracked'])
      expect(groups[0].files.map((f) => f.path)).toEqual(['a.ts', 'd.ts'])
      expect(groups[1].files.map((f) => f.path)).toEqual(['b.ts'])
      expect(groups[2].files.map((f) => f.path)).toEqual(['c.ts'])
    })

    it('omits empty categories', () => {
      const onlyUnstaged: WorktreeFile[] = [files[1]]
      expect(groupWorktreeFiles(onlyUnstaged).map((g) => g.state)).toEqual(['unstaged'])
    })

    it('returns an empty array for an empty file list', () => {
      expect(groupWorktreeFiles([])).toEqual([])
    })

    it('startIndex tracks the flat position of each group\'s first file', () => {
      const groups = groupWorktreeFiles(files)
      expect(groups[0].startIndex).toBe(0)
      expect(groups[1].startIndex).toBe(2)
      expect(groups[2].startIndex).toBe(3)
    })
  })

  describe('flattenWorktreeGroups', () => {
    it('round-trips through groupWorktreeFiles in canonical order', () => {
      const files: WorktreeFile[] = [
        { path: 'a.ts', indexStatus: 'M', worktreeStatus: ' ', state: 'staged' },
        { path: 'b.ts', indexStatus: ' ', worktreeStatus: 'M', state: 'unstaged' },
        { path: 'c.ts', indexStatus: '?', worktreeStatus: '?', state: 'untracked' },
        { path: 'd.ts', indexStatus: 'A', worktreeStatus: ' ', state: 'staged' },
      ]
      // Note: round-trip preserves group ordering but reorders within
      // categories (a, d, b, c) — the canonical order is what the
      // renderer + cursor model agree on.
      expect(flattenWorktreeGroups(groupWorktreeFiles(files)).map((f) => f.path)).toEqual([
        'a.ts',
        'd.ts',
        'b.ts',
        'c.ts',
      ])
    })
  })

  describe('findGroupForIndex', () => {
    const files: WorktreeFile[] = [
      { path: 'a.ts', indexStatus: 'M', worktreeStatus: ' ', state: 'staged' },
      { path: 'd.ts', indexStatus: 'A', worktreeStatus: ' ', state: 'staged' },
      { path: 'b.ts', indexStatus: ' ', worktreeStatus: 'M', state: 'unstaged' },
      { path: 'c.ts', indexStatus: '?', worktreeStatus: '?', state: 'untracked' },
    ]
    const groups = groupWorktreeFiles(files)

    it('resolves a flat index to the owning group', () => {
      expect(findGroupForIndex(groups, 0)?.state).toBe('staged')
      expect(findGroupForIndex(groups, 1)?.state).toBe('staged')
      expect(findGroupForIndex(groups, 2)?.state).toBe('unstaged')
      expect(findGroupForIndex(groups, 3)?.state).toBe('untracked')
    })

    it('returns undefined for an out-of-range index', () => {
      expect(findGroupForIndex(groups, 99)).toBeUndefined()
      expect(findGroupForIndex(groups, -1)).toBeUndefined()
    })
  })
})
