import { SimpleGit } from 'simple-git'

export type StashEntry = {
  ref: string
  hash: string
  /**
   * First-parent commit hash — the BASE commit the stash was created
   * on (i.e. HEAD at `git stash push` time). For stash merge commits
   * `stash@{N}^1` is always the base; `^2` is the index snapshot,
   * `^3` is the untracked-files snapshot when `-u` was used.
   *
   * Captured here so the cursor-syncs-history effect can jump to
   * the stash's branch origin point rather than the stash commit
   * itself. Older stashes' commits often fall outside the loaded
   * `git log --max-count=300` window even when passed as graph
   * roots; their parents almost never do because they're on
   * regular branches with much more frequent commit activity.
   *
   * Empty string when git's output omitted the parent field (very
   * old git versions or corrupted stash refs). Callers should treat
   * empty as "no base available" rather than a valid commit.
   */
  baseHash: string
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
      const [ref, hash, parents, date, subject] = line.split('\x1f')
      const parsedSubject = parseStashSubject(subject || '')
      // `%P` returns space-separated parent hashes. Stash commits are
      // merges with 2-3 parents; the FIRST is the base (HEAD at stash
      // time). Empty parents string (legacy / corrupted entries) maps
      // to an empty baseHash; the cursor-sync caller treats that as
      // "no base available, fall back to stash hash."
      const baseHash = parents ? (parents.split(' ')[0] || '') : ''

      return {
        ref,
        hash,
        baseHash,
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

/**
 * Resolve the commit hashes for every stash, in `stash@{N}` order.
 *
 * Used by the workstation's history loader to include older stashes
 * as graph roots — `git log --all` only walks `refs/stash` (the
 * latest stash) by default, so stash@{1+} commits live off-graph
 * unless explicitly referenced. Passing this list as positional refs
 * to `git log` makes every stash appear as a graph node, which lets
 * the cursor-syncs-history effect actually land on them when the
 * user navigates the stashes sidebar.
 *
 * Cheap: one `git stash list` call, no per-stash fan-out. Returns
 * an empty array when there are no stashes — callers can pass the
 * result through unconditionally.
 */
export async function getStashCommitHashes(git: SimpleGit): Promise<string[]> {
  const raw = await git.raw(['stash', 'list', '--format=%H']).catch(() => '')
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

export async function getStashOverview(git: SimpleGit): Promise<StashOverview> {
  // Format fields (separated by 0x1f / unit separator):
  //   %gd  — stash reflog selector (stash@{N})
  //   %H   — stash commit hash
  //   %P   — space-separated parent hashes (first = base, see StashEntry.baseHash)
  //   %cI  — committer date, strict ISO 8601
  //   %gs  — reflog subject ("WIP on main: <subject>")
  //
  // NOTE: we deliberately do NOT pass `--date=iso`. That flag rewrites the
  // `%gd` selector from the index form (`stash@{0}`) into a timestamp
  // (`stash@{2026-06-03 17:29:23 -0400}`), which is noisy in the list, eats
  // row width, and — critically — breaks `renameStash`, which parses the
  // `stash@{N}` index out of the ref. `%cI` gives a strict-ISO date that's
  // independent of `--date`, so we get both a clean index ref and a
  // parseable date.
  const stashes = parseStashList(
    await git.raw(['stash', 'list', '--format=%gd%x1f%H%x1f%P%x1f%cI%x1f%gs'])
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
 * Path quoting: git only C-quotes a path (`diff --git "a/..." "b/..."`)
 * when it contains non-ASCII bytes, control characters, or a literal
 * quote/backslash. A plain space is NOT quoted, so the `diff --git`
 * line alone (`a/X b/X`) is ambiguous for unquoted paths with spaces.
 * For those, resolution falls through to the unambiguous `---`/`+++`
 * and `rename to`/`copy to` lines that follow the header, with a
 * length-halving fallback for the header line itself when none of
 * those are present (e.g. a pure rename with no content change still
 * has `rename to`, but a merge/binary diff might not).
 */
export function parseStashDiffFiles(lines: string[]): StashDiffFile[] {
  const files: StashDiffFile[] = []
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (!DIFF_GIT_HEADER_LINE.test(line)) continue

    const path = resolveDiffGitHeaderPath(lines, i)
    if (path) {
      files.push({ path, startLine: i })
    }
  }
  return files
}

/**
 * Resolve which stash file *contains* a given line offset — the user's
 * cursor scrolls through a concatenated multi-file patch, and this is
 * what powers the "File N/M: <path>" panel header, the inline header
 * highlighting (#791 follow-up), and the cherry-pick / open-in-editor
 * dispatchers' "what file is the cursor on" lookup.
 *
 * Returns `undefined` when the file list is empty *or* the offset
 * lands before the very first file's `diff --git` header (e.g. when
 * `--stat` summary lines lead the patch). Callers fall through to a
 * "no file selected" state in that case.
 */
export function findStashFileForOffset(
  files: StashDiffFile[],
  offset: number
): StashDiffFile | undefined {
  if (files.length === 0) return undefined
  let current: StashDiffFile | undefined
  for (const file of files) {
    if (file.startLine <= offset) {
      current = file
    } else {
      break
    }
  }
  // First file is the canonical fallback — even if the offset lands
  // before its header (rare), we want the cursor to be "in" something
  // so the user's actions have a target.
  return current ?? files[0]
}

const DIFF_GIT_HEADER_LINE = /^diff --git /
const DIFF_GIT_HEADER_QUOTED = /^diff --git "a\/((?:\\.|[^"\\])+)" "b\/((?:\\.|[^"\\])+)"$/
const RENAME_OR_COPY_TO_LINE = /^(?:rename|copy) to (.+)$/
const PLUS_PLUS_LINE = /^\+\+\+ (?:b\/(.+)|\/dev\/null)$/
const MINUS_LINE = /^--- (?:a\/(.+)|\/dev\/null)$/

/**
 * Resolve the path for the `diff --git` header at `lines[headerIndex]`.
 * Quoted headers are unambiguous and handled directly; unquoted headers
 * with a space in the path can't be split reliably (a rename can put a
 * literal ` b/` inside a name), so resolution instead scans the section
 * for the unambiguous follow-on lines, bounded by the next `diff --git`
 * so a malformed section can't consume the next file's headers.
 */
function resolveDiffGitHeaderPath(lines: string[], headerIndex: number): string | undefined {
  const quotedMatch = lines[headerIndex].match(DIFF_GIT_HEADER_QUOTED)
  if (quotedMatch) {
    const aPath = unescapeGitQuoted(quotedMatch[1])
    const bPath = unescapeGitQuoted(quotedMatch[2])
    return bPath || aPath
  }

  let bFromPlusPlus: string | undefined
  let renameOrCopyTo: string | undefined
  let aFromMinus: string | undefined

  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (DIFF_GIT_HEADER_LINE.test(line)) break

    if (bFromPlusPlus === undefined) {
      const plusMatch = line.match(PLUS_PLUS_LINE)
      if (plusMatch) {
        if (plusMatch[1]) bFromPlusPlus = stripTrailingTab(plusMatch[1])
        continue
      }
    }

    if (renameOrCopyTo === undefined) {
      const renameMatch = line.match(RENAME_OR_COPY_TO_LINE)
      if (renameMatch) {
        renameOrCopyTo = renameMatch[1]
        continue
      }
    }

    if (aFromMinus === undefined) {
      const minusMatch = line.match(MINUS_LINE)
      if (minusMatch && minusMatch[1]) {
        aFromMinus = stripTrailingTab(minusMatch[1])
      }
    }
  }

  return bFromPlusPlus ?? renameOrCopyTo ?? aFromMinus ?? halveUnquotedHeaderPath(lines[headerIndex])
}

function stripTrailingTab(path: string): string {
  return path.endsWith('\t') ? path.slice(0, -1) : path
}

/**
 * Last-resort fallback for an unquoted `diff --git a/X b/X` header with
 * no `---`/`+++`/`rename to` lines to disambiguate it (e.g. a mode-only
 * change). Splits by length rather than searching for `" b/"`, since a
 * filename can itself contain that substring.
 */
function halveUnquotedHeaderPath(headerLine: string): string | undefined {
  const prefix = 'diff --git a/'
  if (!headerLine.startsWith(prefix)) return undefined

  const remainder = headerLine.slice(prefix.length)
  const n = (remainder.length - 3) / 2
  if (!Number.isInteger(n) || n <= 0) return undefined
  if (remainder.slice(n, n + 3) !== ' b/') return undefined

  const aPath = remainder.slice(0, n)
  const bPath = remainder.slice(n + 3)
  return aPath === bPath ? bPath : undefined
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
