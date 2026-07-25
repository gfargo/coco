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
