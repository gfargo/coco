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
  })
})
