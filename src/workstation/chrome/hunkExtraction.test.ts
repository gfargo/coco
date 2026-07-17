import { extractDiffHunk, inkHunkExtractionTestInternals } from './hunkExtraction'

describe('extractDiffHunk', () => {
  const multiHunkPatch = [
    'diff --git a/src/foo.ts b/src/foo.ts',
    'index 1234567..89abcde 100644',
    '--- a/src/foo.ts',
    '+++ b/src/foo.ts',
    '@@ -1,3 +1,4 @@',
    ' const a = 1',
    '+const b = 2',
    ' const c = 3',
    ' const d = 4',
    '@@ -10,2 +11,3 @@',
    ' const e = 5',
    '+const f = 6',
    ' const g = 7',
  ]

  it('extracts the first hunk when the cursor is inside it', () => {
    const result = extractDiffHunk({
      lines: multiHunkPatch,
      cursorOffset: 6, // inside the first hunk body
      path: 'src/foo.ts',
    })

    expect(result).not.toBeNull()
    expect(result!.patchText).toBe([
      'diff --git a/src/foo.ts b/src/foo.ts',
      '--- a/src/foo.ts',
      '+++ b/src/foo.ts',
      '@@ -1,3 +1,4 @@',
      ' const a = 1',
      '+const b = 2',
      ' const c = 3',
      ' const d = 4',
      '',
    ].join('\n'))
  })

  it('extracts the second hunk when the cursor is on its @@ header', () => {
    const result = extractDiffHunk({
      lines: multiHunkPatch,
      cursorOffset: 9, // the second `@@` line
      path: 'src/foo.ts',
    })

    expect(result).not.toBeNull()
    expect(result!.patchText).toContain('@@ -10,2 +11,3 @@')
    expect(result!.patchText).toContain('+const f = 6')
    expect(result!.patchText).not.toContain('+const b = 2')
  })

  it('extracts the last hunk when the cursor is on its final body line', () => {
    const result = extractDiffHunk({
      lines: multiHunkPatch,
      cursorOffset: multiHunkPatch.length - 1,
      path: 'src/foo.ts',
    })

    expect(result).not.toBeNull()
    expect(result!.patchText).toContain('@@ -10,2 +11,3 @@')
    expect(result!.patchText).not.toContain('+const b = 2')
  })

  it('returns null when the cursor is before the first @@', () => {
    expect(
      extractDiffHunk({
        lines: multiHunkPatch,
        cursorOffset: 2, // on the `--- a/src/foo.ts` line
        path: 'src/foo.ts',
      })
    ).toBeNull()
  })

  // Regression: in a multi-file patch, a cursor on file B's preamble
  // (its `diff --git`/index/---/+++ lines) used to walk backwards PAST
  // the file boundary into file A's last `@@`, pairing file A's hunk
  // body with file B's path — a mismatched patch handed to `git apply`.
  it('returns null when the cursor is on a later file preamble (never crosses diff --git)', () => {
    const twoFilePatch = [
      'diff --git a/src/aaa.ts b/src/aaa.ts',
      '--- a/src/aaa.ts',
      '+++ b/src/aaa.ts',
      '@@ -1,2 +1,3 @@',
      ' const a = 1',
      '+const added = 2',
      'diff --git a/src/bbb.ts b/src/bbb.ts',
      '--- a/src/bbb.ts',
      '+++ b/src/bbb.ts',
      '@@ -5,2 +5,3 @@',
      ' const z = 9',
      '+const y = 8',
    ]
    // Cursor on file B's `diff --git` line and on its `+++` line: both
    // sit before file B's first hunk, so there is no hunk "at" cursor.
    for (const cursorOffset of [6, 8]) {
      expect(
        extractDiffHunk({ lines: twoFilePatch, cursorOffset, path: 'src/bbb.ts' })
      ).toBeNull()
    }
    // Sanity: inside file B's hunk still extracts file B's hunk.
    const inside = extractDiffHunk({ lines: twoFilePatch, cursorOffset: 10, path: 'src/bbb.ts' })
    expect(inside?.patchText).toContain('b/src/bbb.ts')
    expect(inside?.patchText).toContain('+const y = 8')
    expect(inside?.patchText).not.toContain('aaa')
  })

  it('returns null on an empty patch', () => {
    expect(
      extractDiffHunk({ lines: [], cursorOffset: 0, path: 'src/foo.ts' })
    ).toBeNull()
  })

  it('returns null when the path is empty', () => {
    expect(
      extractDiffHunk({
        lines: multiHunkPatch,
        cursorOffset: 6,
        path: '',
      })
    ).toBeNull()
  })

  it('uses the caller-provided path even on rename patches', () => {
    // Renames have `diff --git a/old b/new` headers; the caller resolves
    // the post-rename path and passes it in (parseStashDiffFiles already
    // returns the b/ side). The synthesized patch should always reflect
    // what the caller asked for.
    const renamePatch = [
      'diff --git a/old/path.ts b/new/path.ts',
      'similarity index 95%',
      'rename from old/path.ts',
      'rename to new/path.ts',
      '--- a/old/path.ts',
      '+++ b/new/path.ts',
      '@@ -1,2 +1,3 @@',
      ' const a = 1',
      '+const b = 2',
      ' const c = 3',
    ]

    const result = extractDiffHunk({
      lines: renamePatch,
      cursorOffset: renamePatch.length - 1,
      path: 'new/path.ts',
    })

    expect(result).not.toBeNull()
    expect(result!.patchText).toContain('diff --git a/new/path.ts b/new/path.ts')
    expect(result!.patchText).toContain('--- a/new/path.ts')
    expect(result!.patchText).toContain('+++ b/new/path.ts')
    expect(result!.patchText).not.toContain('a/old/path.ts')
  })

  it('returns null when the @@ header has no body before the next file', () => {
    // Pathological case: a hunk header with no body lines before the
    // next `diff --git`. extractDiffHunk should bail rather than
    // produce a malformed patch.
    const malformed = [
      'diff --git a/a.ts b/a.ts',
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -1,1 +1,1 @@',
      'diff --git a/b.ts b/b.ts',
    ]
    expect(
      extractDiffHunk({ lines: malformed, cursorOffset: 3, path: 'a.ts' })
    ).toBeNull()
  })

  it('handles a hunks-only commit-diff (no diff --git / --- / +++ headers)', () => {
    // commit-diff hands `filePreview.hunks` directly — these are
    // hunks-only with no file headers. extractDiffHunk has to
    // synthesize the headers itself using the caller-provided path.
    const hunksOnly = [
      '@@ -1,3 +1,4 @@',
      ' const a = 1',
      '+const b = 2',
      ' const c = 3',
      ' const d = 4',
    ]

    const result = extractDiffHunk({
      lines: hunksOnly,
      cursorOffset: 1,
      path: 'src/example.ts',
    })

    expect(result).not.toBeNull()
    expect(result!.patchText).toBe([
      'diff --git a/src/example.ts b/src/example.ts',
      '--- a/src/example.ts',
      '+++ b/src/example.ts',
      '@@ -1,3 +1,4 @@',
      ' const a = 1',
      '+const b = 2',
      ' const c = 3',
      ' const d = 4',
      '',
    ].join('\n'))
  })

  it('emits `--- /dev/null` for a new-file hunk (stash-style, headers present)', () => {
    // A stash containing a staged new file: the original patch's `---`
    // side is `/dev/null`. Synthesizing `--- a/new.txt` would make
    // `git apply` fail with "No such file or directory".
    const newFilePatch = [
      'diff --git a/new.txt b/new.txt',
      'new file mode 100644',
      'index 0000000..1234567',
      '--- /dev/null',
      '+++ b/new.txt',
      '@@ -0,0 +1,3 @@',
      '+line one',
      '+line two',
      '+line three',
    ]

    const result = extractDiffHunk({
      lines: newFilePatch,
      cursorOffset: newFilePatch.length - 1,
      path: 'new.txt',
    })

    expect(result).not.toBeNull()
    expect(result!.patchText).toContain('new file mode 100644')
    expect(result!.patchText).toContain('--- /dev/null')
    expect(result!.patchText).toContain('+++ b/new.txt')
    expect(result!.patchText).not.toContain('--- a/new.txt')
  })

  it('emits `+++ /dev/null` for a whole-file-deletion hunk', () => {
    // The original patch's `+++` side is `/dev/null`. Synthesizing
    // `+++ b/del.txt` instead makes `git apply` "succeed" while
    // leaving a 0-byte tracked file behind instead of deleting it.
    const deletionPatch = [
      'diff --git a/del.txt b/del.txt',
      'deleted file mode 100644',
      'index 1234567..0000000',
      '--- a/del.txt',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-line one',
      '-line two',
    ]

    const result = extractDiffHunk({
      lines: deletionPatch,
      cursorOffset: deletionPatch.length - 1,
      path: 'del.txt',
    })

    expect(result).not.toBeNull()
    expect(result!.patchText).toContain('deleted file mode 100644')
    expect(result!.patchText).toContain('--- a/del.txt')
    expect(result!.patchText).toContain('+++ /dev/null')
    expect(result!.patchText).not.toContain('+++ b/del.txt')
  })

  it('emits `--- /dev/null` for a new-file hunk from hunks-only commit-diff input', () => {
    const hunksOnlyNewFile = [
      '@@ -0,0 +1,2 @@',
      '+line one',
      '+line two',
    ]

    const result = extractDiffHunk({
      lines: hunksOnlyNewFile,
      cursorOffset: 1,
      path: 'src/added.ts',
    })

    expect(result).not.toBeNull()
    expect(result!.patchText).toBe([
      'diff --git a/src/added.ts b/src/added.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/src/added.ts',
      '@@ -0,0 +1,2 @@',
      '+line one',
      '+line two',
      '',
    ].join('\n'))
  })

  it('classifies count-omission header forms correctly', () => {
    // `@@ -0,0 +1 @@` (omitted new count means 1) is still a new-file hunk.
    const newFileOmittedCount = ['@@ -0,0 +1 @@', '+only line']
    const newFileResult = extractDiffHunk({
      lines: newFileOmittedCount,
      cursorOffset: 1,
      path: 'src/single.ts',
    })
    expect(newFileResult!.patchText).toContain('--- /dev/null')

    // `@@ -1 +0,0 @@` (omitted old count means 1) is still a deletion hunk.
    const deletionOmittedCount = ['@@ -1 +0,0 @@', '-only line']
    const deletionResult = extractDiffHunk({
      lines: deletionOmittedCount,
      cursorOffset: 1,
      path: 'src/single.ts',
    })
    expect(deletionResult!.patchText).toContain('+++ /dev/null')
  })

  describe('internals', () => {
    it('findHunkHeaderAtOrBefore walks backwards', () => {
      const lines = ['@@ a @@', 'x', 'y', '@@ b @@', 'z']
      expect(inkHunkExtractionTestInternals.findHunkHeaderAtOrBefore(lines, 4)).toBe(3)
      expect(inkHunkExtractionTestInternals.findHunkHeaderAtOrBefore(lines, 2)).toBe(0)
      expect(inkHunkExtractionTestInternals.findHunkHeaderAtOrBefore(['no headers'], 0)).toBe(-1)
    })

    it('findHunkBodyEnd stops at the next @@ or diff --git', () => {
      const lines = ['@@ a @@', 'x', 'y', '@@ b @@', 'z']
      expect(inkHunkExtractionTestInternals.findHunkBodyEnd(lines, 0)).toBe(3)
      expect(inkHunkExtractionTestInternals.findHunkBodyEnd(lines, 3)).toBe(5)
    })

    it('parseHunkHeader parses counts, defaulting omitted counts to 1', () => {
      expect(inkHunkExtractionTestInternals.parseHunkHeader('@@ -1,3 +1,4 @@')).toEqual({
        oldStart: 1,
        oldCount: 3,
        newStart: 1,
        newCount: 4,
      })
      expect(inkHunkExtractionTestInternals.parseHunkHeader('@@ -0,0 +1 @@')).toEqual({
        oldStart: 0,
        oldCount: 0,
        newStart: 1,
        newCount: 1,
      })
      expect(inkHunkExtractionTestInternals.parseHunkHeader('@@ -1 +0,0 @@')).toEqual({
        oldStart: 1,
        oldCount: 1,
        newStart: 0,
        newCount: 0,
      })
      expect(inkHunkExtractionTestInternals.parseHunkHeader('not a header')).toBeNull()
      expect(inkHunkExtractionTestInternals.parseHunkHeader(undefined)).toBeNull()
    })
  })
})
