import {
  WorktreeFile,
  applyStatusFilterMask,
  findGroupForIndex,
  flattenWorktreeGroups,
  groupWorktreeFiles,
  optimisticToggleWorktreeOverview,
  parsePorcelainStatus,
} from './statusData'

describe('log status data', () => {
  it('parses staged, unstaged, untracked, and rename status rows (-z, NUL-separated)', () => {
    // `-z` reports a rename/copy entry as the destination path token
    // followed by a separate origin-path token (#1597) — no ` -> `
    // in-line separator.
    expect(parsePorcelainStatus([
      'M  staged.ts',
      ' M unstaged.ts',
      '?? new.ts',
      'R  renamed.ts',
      'old.ts',
    ].join('\0') + '\0')).toEqual([
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

  it('parses non-ASCII, quote-containing, and tab-containing filenames without corruption (#1597)', () => {
    // -z never C-quotes paths — porcelain v1's default text format would
    // have wrapped these in literal quotes with octal escapes
    // (`"\303\244.txt"`), which then failed to match as a git pathspec.
    expect(parsePorcelainStatus([
      '?? ä.txt',
      '?? 日本語.txt',
      '?? file with "quotes".txt',
      '?? file\twith\ttabs.txt',
    ].join('\0') + '\0')).toEqual([
      { path: 'ä.txt', indexStatus: '?', worktreeStatus: '?', state: 'untracked' },
      { path: '日本語.txt', indexStatus: '?', worktreeStatus: '?', state: 'untracked' },
      { path: 'file with "quotes".txt', indexStatus: '?', worktreeStatus: '?', state: 'untracked' },
      { path: 'file\twith\ttabs.txt', indexStatus: '?', worktreeStatus: '?', state: 'untracked' },
    ])
  })

  it('does not misparse a renamed path containing a literal " -> "', () => {
    // The v1 text-format parser split on ' -> ' in-line, so a filename
    // that happens to contain that exact substring would misparse. -z's
    // separate-token rename encoding has no such ambiguity.
    expect(parsePorcelainStatus([
      'R  a -> b.ts',
      'old name.ts',
    ].join('\0') + '\0')).toEqual([
      { path: 'a -> b.ts', indexStatus: 'R', worktreeStatus: ' ', state: 'staged' },
    ])
  })

  it('parses a copy entry the same way as a rename (origin token consumed, not surfaced)', () => {
    expect(parsePorcelainStatus([
      'C  copied.ts',
      'source.ts',
      '?? trailing.ts',
    ].join('\0') + '\0')).toEqual([
      { path: 'copied.ts', indexStatus: 'C', worktreeStatus: ' ', state: 'staged' },
      { path: 'trailing.ts', indexStatus: '?', worktreeStatus: '?', state: 'untracked' },
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

describe('optimisticToggleWorktreeOverview (#1353)', () => {
  const overview = {
    files: [
      { path: 'a.ts', indexStatus: 'M', worktreeStatus: ' ', state: 'staged' },
      { path: 'b.ts', indexStatus: ' ', worktreeStatus: 'M', state: 'unstaged' },
      { path: 'c.ts', indexStatus: '?', worktreeStatus: '?', state: 'untracked' },
    ] as WorktreeFile[],
    stagedCount: 1,
    unstagedCount: 1,
    untrackedCount: 1,
  }

  it('flips an unstaged file into the staged group and recounts', () => {
    const next = optimisticToggleWorktreeOverview(overview, 'b.ts')
    expect(next.files.find((f) => f.path === 'b.ts')).toMatchObject({
      state: 'staged',
      indexStatus: 'M',
      worktreeStatus: ' ',
    })
    expect(next).toMatchObject({ stagedCount: 2, unstagedCount: 0, untrackedCount: 1 })
  })

  it('flips an untracked file to staged-added', () => {
    const next = optimisticToggleWorktreeOverview(overview, 'c.ts')
    expect(next.files.find((f) => f.path === 'c.ts')).toMatchObject({
      state: 'staged',
      indexStatus: 'A',
    })
    expect(next.untrackedCount).toBe(0)
  })

  it('flips a staged file back to unstaged', () => {
    const next = optimisticToggleWorktreeOverview(overview, 'a.ts')
    expect(next.files.find((f) => f.path === 'a.ts')).toMatchObject({
      state: 'unstaged',
      indexStatus: ' ',
      worktreeStatus: 'M',
    })
    expect(next).toMatchObject({ stagedCount: 0, unstagedCount: 2 })
  })

  it('leaves other files and the original overview untouched', () => {
    const next = optimisticToggleWorktreeOverview(overview, 'b.ts')
    expect(next.files.find((f) => f.path === 'a.ts')?.state).toBe('staged')
    expect(overview.files.find((f) => f.path === 'b.ts')?.state).toBe('unstaged')
    expect(overview.stagedCount).toBe(1)
  })

  it('is a no-op for an unknown path', () => {
    const next = optimisticToggleWorktreeOverview(overview, 'zzz.ts')
    expect(next.files).toEqual(overview.files)
    expect(next.stagedCount).toBe(1)
  })
})
