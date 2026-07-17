import { FileDiff } from '../../../types'
import {
  detectTrivialDiffShape,
  summarizeTrivialDiff,
} from './trivialDiff'

const additionDiff = `diff --git a/foo.ts b/foo.ts
new file mode 100644
index 0000000..1234567
--- /dev/null
+++ b/foo.ts
@@ -0,0 +1,3 @@
+export const foo = 1
+export const bar = 2
+export const baz = 3
`

const deletionDiff = `diff --git a/legacy.ts b/legacy.ts
deleted file mode 100644
index 1234567..0000000
--- a/legacy.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-export const legacy = 1
-export const old = 2
-export const stale = 3
`

const renameDiff = `diff --git a/old/path.ts b/new/path.ts
similarity index 100%
rename from old/path.ts
rename to new/path.ts
`

const binaryDiff = `diff --git a/assets/logo.png b/assets/logo.png
Binary files a/assets/logo.png and b/assets/logo.png differ
`

const modificationDiff = `diff --git a/src/foo.ts b/src/foo.ts
index 1234567..89abcde 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,5 +1,7 @@
 const foo = 1
-const bar = 2
+const bar = 22
+const baz = 3
 const quux = 4
`

const renameWithEditDiff = `diff --git a/old/path.ts b/new/path.ts
similarity index 87%
rename from old/path.ts
rename to new/path.ts
@@ -1,3 +1,4 @@
 const foo = 1
-const bar = 2
+const bar = 22
+const baz = 3
`

const sqlCommentModificationDiff = `diff --git a/queries.sql b/queries.sql
index 1234567..89abcde 100644
--- a/queries.sql
+++ b/queries.sql
@@ -1,3 +1,4 @@
 SELECT 1;
--- old note
+SELECT 2;
+SELECT 3;
`

const sqlCommentDeletionDiff = `diff --git a/queries.sql b/queries.sql
index 1234567..0000000 100644
--- a/queries.sql
+++ /dev/null
@@ -1,3 +0,0 @@
--- first note
--- second note
--- third note
`

const luaCommentAdditionDiff = `diff --git a/script.lua b/script.lua
new file mode 100644
index 0000000..89abcde
--- /dev/null
+++ b/script.lua
@@ -0,0 +1,3 @@
+++ first note
+++ second note
+++ third note
`

describe('detectTrivialDiffShape', () => {
  it('detects pure additions', () => {
    expect(detectTrivialDiffShape(additionDiff)).toBe('addition')
  })

  it('detects pure deletions', () => {
    expect(detectTrivialDiffShape(deletionDiff)).toBe('deletion')
  })

  it('detects pure renames (no body)', () => {
    expect(detectTrivialDiffShape(renameDiff)).toBe('rename')
  })

  it('detects binary file changes', () => {
    expect(detectTrivialDiffShape(binaryDiff)).toBe('binary')
  })

  it('returns undefined for modifications (mixed +/-)', () => {
    expect(detectTrivialDiffShape(modificationDiff)).toBeUndefined()
  })

  it('returns undefined for renames that also include edits (rename + body)', () => {
    expect(detectTrivialDiffShape(renameWithEditDiff)).toBeUndefined()
  })

  it('returns undefined for empty input', () => {
    expect(detectTrivialDiffShape('')).toBeUndefined()
  })

  it('ignores +++ / --- header markers when classifying', () => {
    // The `+++ b/file` and `--- a/file` headers shouldn't fool the
    // counter — they're metadata, not content.
    expect(detectTrivialDiffShape(additionDiff)).toBe('addition')
    expect(detectTrivialDiffShape(deletionDiff)).toBe('deletion')
  })

  it('treats a removed "-- comment" content line (renders as "--- ...") as content, not a header', () => {
    expect(detectTrivialDiffShape(sqlCommentModificationDiff)).toBeUndefined()
  })

  it('counts pure deletions of "-- comment" lines correctly', () => {
    expect(detectTrivialDiffShape(sqlCommentDeletionDiff)).toBe('deletion')
  })

  it('treats an added "++ comment" content line (renders as "+++ ...") as content, not a header', () => {
    expect(detectTrivialDiffShape(luaCommentAdditionDiff)).toBe('addition')
  })
})

describe('summarizeTrivialDiff', () => {
  function makeDiff(file: string, diff: string): FileDiff {
    return { file, diff, summary: '', tokenCount: 100 }
  }

  it('templated summary for pure addition includes line count', () => {
    expect(summarizeTrivialDiff(makeDiff('foo.ts', additionDiff)))
      .toBe('Added `foo.ts` (3 lines).')
  })

  it('templated summary for pure deletion includes line count', () => {
    expect(summarizeTrivialDiff(makeDiff('legacy.ts', deletionDiff)))
      .toBe('Removed `legacy.ts` (3 lines).')
  })

  it('singular line wording when count is 1', () => {
    const oneLine = `diff --git a/foo b/foo
new file mode 100644
--- /dev/null
+++ b/foo
@@ -0,0 +1,1 @@
+only one line
`
    expect(summarizeTrivialDiff(makeDiff('foo', oneLine)))
      .toBe('Added `foo` (1 line).')
  })

  it('rename summary names both old and new path', () => {
    expect(summarizeTrivialDiff(makeDiff('new/path.ts', renameDiff)))
      .toBe('Renamed `old/path.ts` → `new/path.ts`.')
  })

  it('binary summary is shape-only (no line count)', () => {
    expect(summarizeTrivialDiff(makeDiff('assets/logo.png', binaryDiff)))
      .toBe('Updated binary file `assets/logo.png`.')
  })

  it('returns undefined for modifications so the LLM path stays in charge', () => {
    expect(summarizeTrivialDiff(makeDiff('src/foo.ts', modificationDiff)))
      .toBeUndefined()
  })

  it('returns undefined for renames-with-edit', () => {
    expect(summarizeTrivialDiff(makeDiff('new/path.ts', renameWithEditDiff)))
      .toBeUndefined()
  })

  it('returns undefined for a modification whose only deletions are "-- comment" lines', () => {
    expect(summarizeTrivialDiff(makeDiff('queries.sql', sqlCommentModificationDiff)))
      .toBeUndefined()
  })

  it('reports the correct line count for a pure deletion of "-- comment" lines', () => {
    expect(summarizeTrivialDiff(makeDiff('queries.sql', sqlCommentDeletionDiff)))
      .toBe('Removed `queries.sql` (3 lines).')
  })

  it('reports the correct line count for a pure addition of "++ comment" lines', () => {
    expect(summarizeTrivialDiff(makeDiff('script.lua', luaCommentAdditionDiff)))
      .toBe('Added `script.lua` (3 lines).')
  })
})
