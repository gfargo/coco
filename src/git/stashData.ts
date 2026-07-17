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

const DIFF_GIT_HEADER = /^diff --git (?:"a\/((?:\\.|[^"\\])+)"|a\/(\S+)) (?:"b\/((?:\\.|[^"\\])+)"|b\/(\S+))$/

function parseDiffGitHeader(line: string): { aPath: string; bPath: string } | undefined {
  const match = line.match(DIFF_GIT_HEADER)
  if (!match) return undefined
  const aPath = unescapeGitQuoted(match[1]) || match[2]
  const bPath = unescapeGitQuoted(match[3]) || match[4]
  if (!aPath || !bPath) return undefined
  return { aPath, bPath }
}

const SIMPLE_ESCAPES: Record<string, string> = {
  '\\': '\\',
  '"': '"',
  t: '\t',
  n: '\n',
  r: '\r',
  a: '\x07',
  b: '\b',
  f: '\f',
  v: '\v',
}

function unescapeGitQuoted(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  if (!value.includes('\\')) return value

  // Git's diff header quoting escapes `"`, `\`, the usual C-style
  // sequences, and non-ASCII bytes as `\NNN` octal escapes. Reverse them
  // in a single left-to-right pass — collapsing `\\` before scanning for
  // other escapes would let a decoded backslash form a *new* escape
  // sequence (e.g. `a\\tb` must become `a\tb`, not a real tab).
  let result = ''
  let octalBytes: number[] = []
  const flushOctal = () => {
    if (octalBytes.length === 0) return
    result += new TextDecoder('utf-8', { fatal: false }).decode(Uint8Array.from(octalBytes))
    octalBytes = []
  }

  for (let i = 0; i < value.length; ) {
    const char = value[i]
    if (char !== '\\') {
      flushOctal()
      result += char
      i += 1
      continue
    }

    const next = value[i + 1]
    if (next !== undefined && next >= '0' && next <= '7') {
      let digits = next
      let j = i + 2
      while (digits.length < 3 && value[j] !== undefined && value[j] >= '0' && value[j] <= '7') {
        digits += value[j]
        j += 1
      }
      octalBytes.push(parseInt(digits, 8) & 0xff)
      i = j
      continue
    }

    flushOctal()
    if (next !== undefined && next in SIMPLE_ESCAPES) {
      result += SIMPLE_ESCAPES[next]
      i += 2
    } else {
      result += char
      i += 1
    }
  }
  flushOctal()
  return result
}

export const stashDataTestInternals = {
  parseStashSubject,
}
