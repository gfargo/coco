import { SimpleGit } from 'simple-git'

export type StashEntry = {
  ref: string
  hash: string
  date: string
  branch: string
  message: string
  files: string[]
}

export type StashOverview = {
  stashes: StashEntry[]
}

function parseStashSubject(subject: string): { branch: string; message: string } {
  const match = subject.match(/^(?:WIP on|On) ([^:]+):\s*(.*)$/)

  if (!match) {
    return {
      branch: '<unknown>',
      message: subject,
    }
  }

  return {
    branch: match[1],
    message: match[2] || subject,
  }
}

export function parseStashList(output: string): Omit<StashEntry, 'files'>[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [ref, hash, date, subject] = line.split('\x1f')
      const parsedSubject = parseStashSubject(subject || '')

      return {
        ref,
        hash,
        date,
        branch: parsedSubject.branch,
        message: parsedSubject.message,
      }
    })
}

export function parseStashFiles(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

export async function getStashOverview(git: SimpleGit): Promise<StashOverview> {
  const stashes = parseStashList(
    await git.raw(['stash', 'list', '--date=iso', '--format=%gd%x1f%H%x1f%ci%x1f%gs'])
  )

  return {
    stashes: await Promise.all(stashes.map(async (stash) => ({
      ...stash,
      files: parseStashFiles(await git.raw(['stash', 'show', '--name-only', stash.ref])),
    }))),
  }
}

export async function getStashDiffSummary(git: SimpleGit, stashRef: string): Promise<string[]> {
  return (await git.raw(['stash', 'show', '--stat', stashRef]))
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
}

/**
 * Full unified-patch diff for a stash. Used by the diff surface when
 * `state.diffSource === 'stash'` to render the stash's changes inline.
 *
 * Empty stashes (e.g. created by `git stash --keep-index` against an
 * already-clean tree) return [] rather than throwing — surfaces fall
 * back to a "no diff to display" message.
 */
export async function getStashDiff(git: SimpleGit, stashRef: string): Promise<string[]> {
  return (await git.raw(['stash', 'show', '-p', stashRef]))
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
}

export type StashDiffFile = {
  /** Repo-relative path of the file as parsed from the `b/` side of the
   *  diff header. Used for the cherry-pick action's `--` argument. */
  path: string
  /** Line offset of the `diff --git` header inside the patch text. The
   *  diff surface jumps to this offset when the user navigates to the
   *  next/previous file. */
  startLine: number
}

/**
 * Slice a unified-patch into per-file sections. Each entry records the
 * file path and the offset of its `diff --git` header within `lines`.
 * Used by the stash explorer to build a per-file cursor + cherry-pick
 * the file at the cursor.
 *
 * Renames / moves return the destination path (the `b/` side); the
 * action surface treats that as the path to materialize from the stash.
 *
 * Path quoting: git wraps paths containing spaces or special characters
 * in double-quotes (`diff --git "a/path with spaces" "b/path with spaces"`).
 * The parser handles both the unquoted and quoted forms; without that,
 * stash-file navigation and cherry-pick silently broke for any file
 * whose path contained a space.
 */
export function parseStashDiffFiles(lines: string[]): StashDiffFile[] {
  const files: StashDiffFile[] = []
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const parsed = parseDiffGitHeader(line)
    if (parsed) {
      files.push({ path: parsed.bPath || parsed.aPath, startLine: i })
    }
  }
  return files
}

const DIFF_GIT_HEADER = /^diff --git (?:"a\/((?:\\.|[^"\\])+)"|a\/(\S+)) (?:"b\/((?:\\.|[^"\\])+)"|b\/(\S+))$/

function parseDiffGitHeader(line: string): { aPath: string; bPath: string } | undefined {
  const match = line.match(DIFF_GIT_HEADER)
  if (!match) return undefined
  const aPath = unescapeGitQuoted(match[1]) || match[2]
  const bPath = unescapeGitQuoted(match[3]) || match[4]
  if (!aPath || !bPath) return undefined
  return { aPath, bPath }
}

function unescapeGitQuoted(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  // Git's diff header quoting escapes `"`, `\`, and the usual
  // C-style sequences. Reverse the most common ones so callers get the
  // raw on-disk path.
  return value
    .replace(/\\\\/g, '\\')
    .replace(/\\"/g, '"')
    .replace(/\\t/g, '\t')
    .replace(/\\n/g, '\n')
}

export const stashDataTestInternals = {
  parseStashSubject,
}
