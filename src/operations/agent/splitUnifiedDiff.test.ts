/**
 * Tests for splitUnifiedDiff.
 *
 * Key coverage:
 * - Multi-file diff is split into one FileDiff per file
 * - Renames are handled correctly (destination path used)
 * - Binary file changes are included
 * - Non-code diffs containing SQL/Lua `--` comment lines do NOT produce
 *   phantom files (#1699 regression)
 * - Empty input returns []
 * - tokenCount is populated
 */

import { splitUnifiedDiff } from './splitUnifiedDiff'

const SIMPLE_TOKENIZER = (text: string) => Math.ceil(text.length / 4)

// ─── fixtures ─────────────────────────────────────────────────────────────────

const TWO_FILE_DIFF = `\
diff --git a/src/foo.ts b/src/foo.ts
index abc1234..def5678 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,4 @@
 export function foo() {
+  return 42
 }
diff --git a/src/bar.ts b/src/bar.ts
index 000..111 100644
--- a/src/bar.ts
+++ b/src/bar.ts
@@ -1,2 +1,2 @@
-export const x = 1
+export const x = 2`

const RENAME_DIFF = `\
diff --git a/old/path.ts b/new/path.ts
similarity index 100%
rename from old/path.ts
rename to new/path.ts`

const BINARY_DIFF = `\
diff --git a/assets/logo.png b/assets/logo.png
index 1234567..abcdefg 100644
Binary files a/assets/logo.png and b/assets/logo.png differ`

const NEW_FILE_DIFF = `\
diff --git a/newfile.ts b/newfile.ts
new file mode 100644
index 0000000..1234567
--- /dev/null
+++ b/newfile.ts
@@ -0,0 +1,3 @@
+export function hello() {
+  return 'world'
+}`

const DELETED_FILE_DIFF = `\
diff --git a/gone.ts b/gone.ts
deleted file mode 100644
index 1234567..0000000
--- a/gone.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-export function bye() {
-  return 'gone'
-}`

/**
 * SQL diff with `-- comment` lines that begin deleted-content lines.
 * These look like `--- ` headers at a glance but must NOT be treated as
 * file-segment boundaries (regression guard for #1699).
 */
const SQL_WITH_COMMENT_DIFF = `\
diff --git a/db/schema.sql b/db/schema.sql
index aaaaaaa..bbbbbbb 100644
--- a/db/schema.sql
+++ b/db/schema.sql
@@ -1,5 +1,5 @@
--- This is a top-level SQL comment
+-- Updated SQL comment
 CREATE TABLE users (
-  id SERIAL PRIMARY KEY,
+  id UUID PRIMARY KEY,
   name TEXT NOT NULL
 );`

/**
 * Lua diff with `-- comment` lines that appear as deleted lines (`---`).
 * Same category as the SQL case; both are guarded by #1699.
 */
const LUA_WITH_COMMENT_DIFF = `\
diff --git a/game/main.lua b/game/main.lua
index 1111111..2222222 100644
--- a/game/main.lua
+++ b/game/main.lua
@@ -1,4 +1,4 @@
--- old module header
+-- new module header
 function init()
-  print("start")
+  print("ready")
 end`

/**
 * A plain unified diff (e.g. from `diff -u`) with NO `diff --git` headers —
 * only `--- a/`/`+++ b/` pairs. Two files back to back; a splitter that only
 * boundaries on `diff --git` collapses this into one segment (see PR #1961
 * review).
 */
const HEADERLESS_TWO_FILE_DIFF = `\
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,4 @@
 export function foo() {
+  return 42
 }
--- a/src/bar.ts
+++ b/src/bar.ts
@@ -1,2 +1,2 @@
-export const x = 1
+export const x = 2`

/**
 * Headerless plain diff touching a SQL file whose comment lines render as
 * deleted/added content beginning with `--`/`+--`. Must not falsely trigger
 * the headerless-boundary pairing (#1699-adjacent).
 */
const HEADERLESS_SQL_WITH_COMMENT_DIFF = `\
--- a/db/schema.sql
+++ b/db/schema.sql
@@ -1,5 +1,5 @@
--- This is a top-level SQL comment
+-- Updated SQL comment
 CREATE TABLE users (
-  id SERIAL PRIMARY KEY,
+  id UUID PRIMARY KEY,
   name TEXT NOT NULL
 );`

/**
 * A `diff --git`-bounded file whose hunk body happens to contain a second
 * `--- a/<path>` / `+++ b/<path>` pair as literal content: a single line
 * changes from `-- a/foo` to `++ b/foo`, which the unified-diff format
 * renders as a removed line "--- a/foo" (the `-` prefix plus content
 * starting with `-- `) immediately followed by an added line "+++ b/foo"
 * (the `+` prefix plus content starting with `++ `) — textually
 * indistinguishable from a real headerless boundary pair. The segment is
 * already unambiguously bounded by the enclosing `diff --git` header, so
 * this coincidental pair must be absorbed as body content, not mistaken for
 * a second boundary that would orphan (and silently drop) the remaining
 * lines (PR #1961 re-review).
 */
const GIT_HEADER_WITH_EMBEDDED_PAIR_DIFF = `\
diff --git a/docs/example.diff b/docs/example.diff
index aaaaaaa..bbbbbbb 100644
--- a/docs/example.diff
+++ b/docs/example.diff
@@ -1,3 +1,3 @@
 Example unified diff syntax:
--- a/foo
+++ b/foo
 See the spec for details.`

// ─── tests ────────────────────────────────────────────────────────────────────

describe('splitUnifiedDiff', () => {
  it('returns [] for empty input', () => {
    expect(splitUnifiedDiff('', SIMPLE_TOKENIZER)).toEqual([])
    expect(splitUnifiedDiff('   \n  ', SIMPLE_TOKENIZER)).toEqual([])
  })

  it('splits a two-file diff into two FileDiff records', () => {
    const result = splitUnifiedDiff(TWO_FILE_DIFF, SIMPLE_TOKENIZER)
    expect(result).toHaveLength(2)
    expect(result[0].file).toBe('src/foo.ts')
    expect(result[1].file).toBe('src/bar.ts')
  })

  it('populates tokenCount using the supplied tokenizer', () => {
    const result = splitUnifiedDiff(TWO_FILE_DIFF, SIMPLE_TOKENIZER)
    for (const fd of result) {
      expect(fd.tokenCount).toBeGreaterThan(0)
      expect(fd.tokenCount).toBe(SIMPLE_TOKENIZER(fd.diff))
    }
  })

  it('uses the destination path for a rename (b/ side)', () => {
    const result = splitUnifiedDiff(RENAME_DIFF, SIMPLE_TOKENIZER)
    expect(result).toHaveLength(1)
    expect(result[0].file).toBe('new/path.ts')
  })

  it('resolves a path containing a literal " b/" substring (non-rename)', () => {
    // "diff --git a/has b/bar.ts b/has b/bar.ts" — a purely greedy regex
    // backtracks to the LAST ' b/' occurrence and mis-splits the path.
    const diff = `\
diff --git a/has b/bar.ts b/has b/bar.ts
index abc..def 100644
--- a/has b/bar.ts
+++ b/has b/bar.ts
@@ -1 +1 @@
-old
+new`
    const result = splitUnifiedDiff(diff, SIMPLE_TOKENIZER)
    expect(result).toHaveLength(1)
    expect(result[0].file).toBe('has b/bar.ts')
  })

  it('handles a binary file change', () => {
    const result = splitUnifiedDiff(BINARY_DIFF, SIMPLE_TOKENIZER)
    expect(result).toHaveLength(1)
    expect(result[0].file).toBe('assets/logo.png')
    expect(result[0].diff).toContain('Binary files')
  })

  it('handles a new-file diff (/dev/null on the a/ side)', () => {
    const result = splitUnifiedDiff(NEW_FILE_DIFF, SIMPLE_TOKENIZER)
    expect(result).toHaveLength(1)
    expect(result[0].file).toBe('newfile.ts')
  })

  it('uses the a/ side when b/ is /dev/null (deleted file)', () => {
    const result = splitUnifiedDiff(DELETED_FILE_DIFF, SIMPLE_TOKENIZER)
    expect(result).toHaveLength(1)
    expect(result[0].file).toBe('gone.ts')
  })

  // ── #1699 regression guards ──────────────────────────────────────────────

  it('does NOT split on SQL `-- comment` lines rendered as deleted content (#1699)', () => {
    const result = splitUnifiedDiff(SQL_WITH_COMMENT_DIFF, SIMPLE_TOKENIZER)
    // Must be exactly one file — the SQL comment line must not produce
    // an extra phantom split.
    expect(result).toHaveLength(1)
    expect(result[0].file).toBe('db/schema.sql')
    expect(result[0].diff).toContain('-- This is a top-level SQL comment')
    expect(result[0].diff).toContain('-- Updated SQL comment')
  })

  it('does NOT split on Lua `-- comment` lines rendered as deleted content (#1699)', () => {
    const result = splitUnifiedDiff(LUA_WITH_COMMENT_DIFF, SIMPLE_TOKENIZER)
    expect(result).toHaveLength(1)
    expect(result[0].file).toBe('game/main.lua')
    expect(result[0].diff).toContain('-- old module header')
    expect(result[0].diff).toContain('-- new module header')
  })

  it('produces an empty summary field (to be filled by condensation pass)', () => {
    const result = splitUnifiedDiff(TWO_FILE_DIFF, SIMPLE_TOKENIZER)
    for (const fd of result) {
      expect(fd.summary).toBe('')
    }
  })

  // ── headerless plain-diff coverage (PR #1961 review) ─────────────────────

  it('splits a headerless plain unified diff (no `diff --git`) into per-file records', () => {
    const result = splitUnifiedDiff(HEADERLESS_TWO_FILE_DIFF, SIMPLE_TOKENIZER)
    expect(result).toHaveLength(2)
    expect(result[0].file).toBe('src/foo.ts')
    expect(result[0].diff).toContain('+  return 42')
    expect(result[1].file).toBe('src/bar.ts')
    expect(result[1].diff).toContain('+export const x = 2')
  })

  it('does NOT split a headerless diff on SQL `-- comment` lines (#1699)', () => {
    const result = splitUnifiedDiff(HEADERLESS_SQL_WITH_COMMENT_DIFF, SIMPLE_TOKENIZER)
    expect(result).toHaveLength(1)
    expect(result[0].file).toBe('db/schema.sql')
    expect(result[0].diff).toContain('-- This is a top-level SQL comment')
    expect(result[0].diff).toContain('-- Updated SQL comment')
  })

  it('does NOT split on a coincidental `--- `/`+++ ` pair inside a `diff --git` segment body (PR #1961 re-review)', () => {
    const result = splitUnifiedDiff(GIT_HEADER_WITH_EMBEDDED_PAIR_DIFF, SIMPLE_TOKENIZER)
    // Must be exactly one file — the embedded pair must not produce a
    // phantom split that orphans (and drops) the trailing content.
    expect(result).toHaveLength(1)
    expect(result[0].file).toBe('docs/example.diff')
    expect(result[0].diff).toContain('--- a/foo')
    expect(result[0].diff).toContain('+++ b/foo')
    expect(result[0].diff).toContain('See the spec for details.')
  })

  it('handles a multi-file diff with mixed file types without phantom splits', () => {
    const mixed = [TWO_FILE_DIFF, SQL_WITH_COMMENT_DIFF, LUA_WITH_COMMENT_DIFF].join('\n')
    const result = splitUnifiedDiff(mixed, SIMPLE_TOKENIZER)
    expect(result).toHaveLength(4)
    expect(result.map((r) => r.file)).toEqual([
      'src/foo.ts',
      'src/bar.ts',
      'db/schema.sql',
      'game/main.lua',
    ])
  })
})
