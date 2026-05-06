/**
 * Diff-shape wrappers for the realistic fixture generators (#845).
 * Real `git diff` output has different headers + line prefixes
 * depending on whether the change is a pure addition, pure
 * deletion, modification, or rename. The condensing pipeline's
 * tokenizer counts those characters, and an upcoming "skip-trivial"
 * optimization (PR 2) detects shape from the prefixes — so the
 * fixture contents need to match real git output closely enough that
 * those detection passes behave the same.
 */

export type DiffShape = 'addition' | 'deletion' | 'modification' | 'rename' | 'binary'

function gitHeader(file: string, shape: DiffShape, oldFile?: string): string {
  switch (shape) {
    case 'addition':
      return [
        `diff --git a/${file} b/${file}`,
        'new file mode 100644',
        'index 0000000..1234567',
        '--- /dev/null',
        `+++ b/${file}`,
      ].join('\n')
    case 'deletion':
      return [
        `diff --git a/${file} b/${file}`,
        'deleted file mode 100644',
        'index 1234567..0000000',
        `--- a/${file}`,
        '+++ /dev/null',
      ].join('\n')
    case 'rename':
      return [
        `diff --git a/${oldFile || file} b/${file}`,
        'similarity index 100%',
        `rename from ${oldFile || file}`,
        `rename to ${file}`,
      ].join('\n')
    case 'binary':
      return [
        `diff --git a/${file} b/${file}`,
        `Binary files a/${file} and b/${file} differ`,
      ].join('\n')
    case 'modification':
    default:
      return [
        `diff --git a/${file} b/${file}`,
        'index 1234567..89abcde 100644',
        `--- a/${file}`,
        `+++ b/${file}`,
      ].join('\n')
  }
}

/**
 * Pure-addition diff: every content line gets a `+` prefix. Mirrors
 * git's output for a brand-new file.
 */
export function asAdditionDiff(file: string, content: string): string {
  const lines = content.split('\n')
  const body = `@@ -0,0 +1,${lines.length} @@`
  const plus = lines.map((line) => `+${line}`).join('\n')
  return `${gitHeader(file, 'addition')}\n${body}\n${plus}\n`
}

/** Pure-deletion diff: every line gets a `-` prefix. */
export function asDeletionDiff(file: string, content: string): string {
  const lines = content.split('\n')
  const body = `@@ -1,${lines.length} +0,0 @@`
  const minus = lines.map((line) => `-${line}`).join('\n')
  return `${gitHeader(file, 'deletion')}\n${body}\n${minus}\n`
}

/**
 * Modification diff: realistic mix of context lines, removals, and
 * additions. The "modify ratio" picks roughly what fraction of lines
 * are touched (default 30%) — the rest render as context (` ` prefix).
 */
export function asModificationDiff(
  file: string,
  oldContent: string,
  newContent: string
): string {
  const oldLines = oldContent.split('\n')
  const newLines = newContent.split('\n')
  // Naive "diff": for the bench we don't need a real LCS — just a
  // plausible interleaving of context, removals, and additions.
  // Take the first half of old as context, second half as removals,
  // then add the new lines.
  const half = Math.floor(oldLines.length / 2)
  const contextLines = oldLines.slice(0, half).map((line) => ` ${line}`)
  const removedLines = oldLines.slice(half).map((line) => `-${line}`)
  const addedLines = newLines.slice(0, Math.max(removedLines.length, 4)).map((line) => `+${line}`)
  const hunkHeader = `@@ -1,${oldLines.length} +1,${contextLines.length + addedLines.length} @@`
  const body = [...contextLines, ...removedLines, ...addedLines].join('\n')
  return `${gitHeader(file, 'modification')}\n${hunkHeader}\n${body}\n`
}

/** Rename diff with no content change (shape #2 from PR 2 plan). */
export function asRenameDiff(oldFile: string, newFile: string): string {
  return `${gitHeader(newFile, 'rename', oldFile)}\n`
}

/** Binary file change (shape #3 from PR 2 plan). */
export function asBinaryDiff(file: string): string {
  return `${gitHeader(file, 'binary')}\n`
}
