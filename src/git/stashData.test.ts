import {
  findStashFileForOffset,
  getStashDiffSummary,
  getStashOverview,
  parseStashDiffFiles,
  parseStashFiles,
  parseStashList,
  stashDataTestInternals,
} from './stashData'

describe('log stash data', () => {
  it('parses stash list lines with branch context, parent hashes, and messages', () => {
    // Format now includes %P (parent hashes, space-separated). First
    // parent is the stash's BASE commit — the HEAD that was active
    // when `git stash push` ran. Subsequent parents are the index
    // snapshot and (with `-u`) the untracked-files snapshot.
    const output = [
      'stash@{0}\x1fabc123\x1fbase111 idx111\x1f2026-04-28 09:00:00 -0400\x1fOn main: save docs',
      'stash@{1}\x1fdef456\x1fbase222 idx222 untracked222\x1f2026-04-27 18:00:00 -0400\x1fWIP on feature/log: 1234567 add tui',
    ].join('\n')

    expect(parseStashList(output)).toEqual([
      {
        ref: 'stash@{0}',
        hash: 'abc123',
        baseHash: 'base111',
        date: '2026-04-28 09:00:00 -0400',
        branch: 'main',
        message: 'save docs',
      },
      {
        ref: 'stash@{1}',
        hash: 'def456',
        baseHash: 'base222',
        date: '2026-04-27 18:00:00 -0400',
        branch: 'feature/log',
        message: '1234567 add tui',
      },
    ])
  })

  it('falls back to empty baseHash when the parents field is missing', () => {
    // Defensive: very old git versions or corrupted stash refs may
    // omit %P expansion. parseStashList shouldn't throw; baseHash
    // becomes an empty string and the cursor-sync caller treats
    // that as "fall back to stash.hash."
    const output = 'stash@{0}\x1fabc123\x1f\x1f2026-04-28 09:00:00 -0400\x1fOn main: save docs'
    expect(parseStashList(output)).toEqual([
      {
        ref: 'stash@{0}',
        hash: 'abc123',
        baseHash: '',
        date: '2026-04-28 09:00:00 -0400',
        branch: 'main',
        message: 'save docs',
      },
    ])
  })

  it('keeps unknown stash subjects readable', () => {
    expect(stashDataTestInternals.parseStashSubject('custom stash subject')).toEqual({
      branch: '<unknown>',
      message: 'custom stash subject',
    })
  })

  it('parses stash files and loads overview details', async () => {
    const git = {
      raw: jest.fn()
        .mockResolvedValueOnce('stash@{0}\x1fabc123\x1fbase111 idx111\x1f2026-04-28 09:00:00 -0400\x1fOn main: save docs')
        .mockResolvedValueOnce('src/a.ts\nsrc/b.ts\n'),
    }

    await expect(getStashOverview(git as never)).resolves.toEqual({
      stashes: [
        {
          ref: 'stash@{0}',
          hash: 'abc123',
          baseHash: 'base111',
          date: '2026-04-28 09:00:00 -0400',
          branch: 'main',
          message: 'save docs',
          files: ['src/a.ts', 'src/b.ts'],
        },
      ],
    })
    expect(parseStashFiles('\n src/a.ts \n\n')).toEqual(['src/a.ts'])
  })

  it('loads stash diff summary lines', async () => {
    const git = {
      raw: jest.fn().mockResolvedValue(' src/a.ts | 2 +-\n 1 file changed\n'),
    }

    await expect(getStashDiffSummary(git as never, 'stash@{0}')).resolves.toEqual([
      ' src/a.ts | 2 +-',
      ' 1 file changed',
    ])
    expect(git.raw).toHaveBeenCalledWith(['stash', 'show', '--stat', 'stash@{0}'])
  })

  describe('parseStashDiffFiles', () => {
    it('extracts each file path + diff-header line offset', () => {
      const lines = [
        'diff --git a/src/a.ts b/src/a.ts',
        'index aaa..bbb 100644',
        '--- a/src/a.ts',
        '+++ b/src/a.ts',
        '@@ -1 +1 @@',
        '-old',
        '+new',
        'diff --git a/src/b.ts b/src/b.ts',
        'index ccc..ddd 100644',
        '--- a/src/b.ts',
        '+++ b/src/b.ts',
        '@@ -1 +1 @@',
        '-x',
        '+y',
      ]
      expect(parseStashDiffFiles(lines)).toEqual([
        { path: 'src/a.ts', startLine: 0 },
        { path: 'src/b.ts', startLine: 7 },
      ])
    })

    it('returns the destination path when a file was renamed', () => {
      const lines = [
        'diff --git a/old/path.ts b/new/path.ts',
        'similarity index 95%',
        'rename from old/path.ts',
        'rename to new/path.ts',
      ]
      expect(parseStashDiffFiles(lines)).toEqual([
        { path: 'new/path.ts', startLine: 0 },
      ])
    })

    it('returns an empty array for an empty patch', () => {
      expect(parseStashDiffFiles([])).toEqual([])
    })

    it('handles git\'s real unquoted output for filenames with spaces', () => {
      // Git only C-quotes paths with non-ASCII/control/quote characters —
      // a plain space is NOT quoted, so the `diff --git` line reads
      // `a/src/file with spaces.ts b/src/file with spaces.ts` and the
      // `---`/`+++` lines get a trailing tab to disambiguate the name.
      const lines = [
        'diff --git a/src/file with spaces.ts b/src/file with spaces.ts',
        'index aaa..bbb 100644',
        '--- a/src/file with spaces.ts\t',
        '+++ b/src/file with spaces.ts\t',
        '@@ -1 +1 @@',
        '-old',
        '+new',
      ]
      expect(parseStashDiffFiles(lines)).toEqual([
        { path: 'src/file with spaces.ts', startLine: 0 },
      ])
    })

    it('segments a multi-file patch when one file has a space, without dropping it', () => {
      const lines = [
        'diff --git a/src/a.ts b/src/a.ts',
        'index aaa..bbb 100644',
        '--- a/src/a.ts',
        '+++ b/src/a.ts',
        '@@ -1 +1 @@',
        '-old',
        '+new',
        'diff --git a/my file.ts b/my file.ts',
        'index ccc..ddd 100644',
        '--- a/my file.ts\t',
        '+++ b/my file.ts\t',
        '@@ -1 +1 @@',
        '-x',
        '+y',
      ]
      const files = parseStashDiffFiles(lines)
      expect(files).toEqual([
        { path: 'src/a.ts', startLine: 0 },
        { path: 'my file.ts', startLine: 7 },
      ])
      expect(findStashFileForOffset(files, 10)?.path).toBe('my file.ts')
    })

    it('returns the destination path for an unquoted rename with spaces', () => {
      const lines = [
        'diff --git a/old name.ts b/new name.ts',
        'similarity index 95%',
        'rename from old name.ts',
        'rename to new name.ts',
      ]
      expect(parseStashDiffFiles(lines)).toEqual([
        { path: 'new name.ts', startLine: 0 },
      ])
    })

    it('resolves a deleted file with a space to its real path, not /dev/null', () => {
      const lines = [
        'diff --git a/gone file.ts b/gone file.ts',
        'deleted file mode 100644',
        'index aaa..0000000',
        '--- a/gone file.ts\t',
        '+++ /dev/null',
        '@@ -1 +0,0 @@',
        '-old',
      ]
      expect(parseStashDiffFiles(lines)).toEqual([
        { path: 'gone file.ts', startLine: 0 },
      ])
    })

    it('decodes git\'s C-style escapes inside quoted paths', () => {
      const lines = [
        'diff --git "a/src/quote\\".ts" "b/src/quote\\".ts"',
        'index aaa..bbb 100644',
      ]
      expect(parseStashDiffFiles(lines)).toEqual([
        { path: 'src/quote".ts', startLine: 0 },
      ])
    })

    it('decodes a rename with a quoted destination and unquoted header (mixed quoting)', () => {
      // Git quotes each path independently: renaming a plain-ASCII name
      // to one containing a literal `"` leaves the `diff --git` header's
      // `a/` side unquoted while `rename to` (and `+++`) is quoted for
      // the `b/` side, e.g. `diff --git a/ascii.ts "b/weird\".ts"`.
      const lines = [
        'diff --git a/ascii.ts "b/weird\\".ts"',
        'similarity index 100%',
        'rename from ascii.ts',
        'rename to "weird\\".ts"',
      ]
      expect(parseStashDiffFiles(lines)).toEqual([
        { path: 'weird".ts', startLine: 0 },
      ])
    })

    it('decodes octal-escaped UTF-8 bytes for accented filenames', () => {
      const lines = [
        'diff --git "a/caf\\303\\251.txt" "b/caf\\303\\251.txt"',
        'index aaa..bbb 100644',
      ]
      expect(parseStashDiffFiles(lines)).toEqual([
        { path: 'café.txt', startLine: 0 },
      ])
    })

    it('decodes multi-byte octal sequences for CJK and emoji filenames', () => {
      const lines = [
        'diff --git "a/\\344\\270\\255.txt" "b/\\344\\270\\255.txt"',
        'index aaa..bbb 100644',
      ]
      expect(parseStashDiffFiles(lines)).toEqual([
        { path: '中.txt', startLine: 0 },
      ])
    })

    it('does not corrupt a literal backslash-t into a tab character', () => {
      const lines = [
        'diff --git "a/a\\\\tb.txt" "b/a\\\\tb.txt"',
        'index aaa..bbb 100644',
      ]
      const files = parseStashDiffFiles(lines)
      expect(files).toEqual([{ path: 'a\\tb.txt', startLine: 0 }])
      expect(files[0].path).not.toContain('\t')
    })

    it('decodes an octal escape adjacent to a quote escape in the same path', () => {
      const lines = [
        'diff --git "a/caf\\303\\251\\".txt" "b/caf\\303\\251\\".txt"',
        'index aaa..bbb 100644',
      ]
      expect(parseStashDiffFiles(lines)).toEqual([
        { path: 'café".txt', startLine: 0 },
      ])
    })
  })

  // #791 follow-up — the diff surface uses this to decide which file
  // header to highlight as "active" while the user scrolls a multi-file
  // stash patch.
  describe('findStashFileForOffset', () => {
    const files = [
      { path: 'a.ts', startLine: 0 },
      { path: 'b.ts', startLine: 12 },
      { path: 'c.ts', startLine: 30 },
    ]

    it('returns the file the offset sits inside', () => {
      expect(findStashFileForOffset(files, 0)?.path).toBe('a.ts')
      expect(findStashFileForOffset(files, 5)?.path).toBe('a.ts')
      expect(findStashFileForOffset(files, 12)?.path).toBe('b.ts')
      expect(findStashFileForOffset(files, 25)?.path).toBe('b.ts')
      expect(findStashFileForOffset(files, 30)?.path).toBe('c.ts')
      expect(findStashFileForOffset(files, 100)?.path).toBe('c.ts')
    })

    it('falls back to the first file when offset lands before its header', () => {
      // Defensive — git stash patches always lead with `diff --git` so
      // this path is rare, but the helper should never return undefined
      // when the file list is non-empty.
      expect(findStashFileForOffset(
        [{ path: 'a.ts', startLine: 5 }],
        0
      )?.path).toBe('a.ts')
    })

    it('returns undefined for an empty file list', () => {
      expect(findStashFileForOffset([], 0)).toBeUndefined()
    })
  })
})
