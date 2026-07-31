import { SimpleGit } from 'simple-git'

/**
 * File-history loader (#COCO-14 — file-history drill-down).
 *
 * Backs the on-demand file-history view: given a repo-relative path,
 * runs `git log --follow` and parses the output into one
 * `FileHistoryCommit` per commit so the surface can render a scrollable
 * log filtered to this file, tracking renames across its lifetime.
 *
 * Architecturally mirrors `blameData.ts`: per-file, expensive, never
 * loaded at boot, hydrated on-demand into a `fileHistoryByPath` cache.
 *
 * Best-effort: any failure resolves to `{ ok: false, message }` rather
 * than throwing, so the surface can show a tailored placeholder.
 */

/** Field separator (ASCII Unit Separator, 0x1f) — won't appear in commit subjects. */
const SEP = '\x1f'
/** Record separator (ASCII Record Separator, 0x1e) — terminates each commit entry. */
const REC = '\x1e'

/**
 * Default maximum number of commits returned by `getFileHistory`.
 * Mirrors `LOG_DEFAULT_LIMIT` in `logData.ts` (30) — keeps memory and
 * wall-time bounded for long-lived files with hundreds of commits.
 *
 * When `git log --max-count=<limit>` returns exactly `limit` results
 * there may be more commits beyond the cap (the `truncated` flag in
 * `FileHistoryResult` signals this). Pass a larger `limit` argument to
 * `getFileHistory` for a future "load more" path.
 */
export const FILE_HISTORY_DEFAULT_LIMIT = 30

export type FileHistoryCommit = {
  /** Full 40-char commit sha. */
  hash: string
  /** Abbreviated sha (first 7-8 chars depending on repo size). */
  shortHash: string
  /** Commit author name. */
  author: string
  /** Author timestamp as Unix epoch (seconds). */
  authorTime: number
  /** Commit subject line. */
  subject: string
}

export type FileHistoryResult =
  | { ok: true; path: string; commits: FileHistoryCommit[]; truncated: boolean }
  | { ok: false; path: string; message: string }

/**
 * Parse the output of `git log --follow --format=…` with `SEP`-separated
 * fields and `REC`-terminated records into `FileHistoryCommit[]`.
 *
 * The format string used is:
 *   `%H\x1f%h\x1f%an\x1f%at\x1f%s\x1e`
 *
 * Each commit occupies one record (terminated by `\x1e`); fields within
 * the record are delimited by `\x1f`. The subject `%s` is the first line
 * of the commit message (no newlines) — control characters are safe
 * delimiters here.
 */
export function parseFileHistoryOutput(output: string): FileHistoryCommit[] {
  const commits: FileHistoryCommit[] = []
  for (const record of output.split(REC)) {
    const trimmed = record.trim()
    if (!trimmed) continue
    const parts = trimmed.split(SEP)
    if (parts.length < 4) continue
    const [hash, shortHash, author, authorTimeStr, ...rest] = parts
    // Subject may be empty (e.g. a merge commit with only a body); join
    // remaining parts in case a subject ever contains the SEP byte.
    const subject = rest.join(SEP).trim()
    const authorTime = Number.parseInt(authorTimeStr, 10)
    if (!hash || !shortHash) continue
    commits.push({
      hash,
      shortHash,
      author: author || 'Unknown',
      authorTime: Number.isFinite(authorTime) ? authorTime : 0,
      subject,
    })
  }
  return commits
}

/**
 * Load the commit history for a single repo-relative path via
 * `git log --follow -- <path>`. `--follow` renames tracking so the log
 * shows the file's full history even across renames.
 *
 * Results are capped at `limit` commits (default: `FILE_HISTORY_DEFAULT_LIMIT`).
 * When the result length equals the limit there may be additional commits
 * beyond the cap — the `truncated` field in the ok-variant signals this.
 * Pass a larger `limit` for a future "load more" path.
 *
 * Best-effort: failures (path outside repo, not a git repo, binary) resolve
 * to `{ ok: false }` so the surface can show a placeholder.
 */
export async function getFileHistory(
  git: SimpleGit,
  path: string,
  limit = FILE_HISTORY_DEFAULT_LIMIT,
): Promise<FileHistoryResult> {
  let output = ''
  try {
    output = await git.raw([
      'log',
      `--max-count=${limit}`,
      '--follow',
      `--format=%H${SEP}%h${SEP}%an${SEP}%at${SEP}%s${REC}`,
      '--',
      path,
    ])
  } catch (error) {
    const message = error instanceof Error ? error.message : 'git log failed'
    return { ok: false, path, message }
  }
  const commits = parseFileHistoryOutput(output)
  // Best-effort truncation signal: if git returned exactly `limit` rows,
  // there may be more commits beyond the cap. Can false-positive when
  // the file has exactly `limit` commits, but is the same heuristic
  // paginated logs use.
  const truncated = commits.length >= limit
  return { ok: true, path, commits, truncated }
}
