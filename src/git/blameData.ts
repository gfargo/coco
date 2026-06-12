import { SimpleGit } from 'simple-git'

/**
 * Blame loader (#0.71 — expanded git ops).
 *
 * Backs the on-demand blame drill-down: given a repo-relative path,
 * runs `git blame --porcelain` and parses it into one `BlameLine` per
 * source line so the blame surface can render a dimmed
 * `<shorthash> <author>` gutter alongside the line content.
 *
 * Architecturally distinct from the boot-loaded overview slices
 * (`remoteData`, `submoduleData`, …): blame is per-file and expensive,
 * so it's never loaded at boot. The runtime hydrates it lazily into a
 * `blameByPath` cache (keyed by path) when the blame view opens,
 * mirroring the per-item inspector hydration the PR / issue triage
 * views use.
 *
 * Best-effort: any failure (binary file, path outside the repo, not a
 * git repo) resolves to `{ ok: false, message }` rather than throwing,
 * so the surface can show a tailored placeholder instead of crashing
 * the runtime.
 */

export type BlameLine = {
  /** Full 40-char commit sha the line is attributed to. */
  hash: string
  /** Abbreviated sha (first 8 chars) for the gutter. */
  shortHash: string
  /** Commit author name. */
  author: string
  /** Author time as a Unix epoch (seconds). 0 when git omits it. */
  authorTime: number
  /** 1-based final line number in the blamed file. */
  lineNumber: number
  /** The source line's text content (without the trailing newline). */
  content: string
}

export type BlameResult =
  | { ok: true; path: string; lines: BlameLine[] }
  | { ok: false; path: string; message: string }

/**
 * Uncommitted / not-yet-committed lines blame as the all-zero sha.
 * Git emits the literal author "Not Committed Yet" for them; we keep
 * that author but render a friendlier short hash so the gutter doesn't
 * show a wall of zeros.
 */
const UNCOMMITTED_SHA = '0000000000000000000000000000000000000000'

/**
 * Parse the output of `git blame --porcelain`.
 *
 * The porcelain format emits, per blamed line:
 *
 *   `<40-hex-sha> <orig-line> <final-line> [<lines-in-group>]`
 *   (commit metadata lines — `author …`, `author-time …`, etc., but
 *    ONLY the first time a given commit is seen)
 *   `\t<line content>`
 *
 * Git caches commit metadata: the second and later lines attributed to
 * the same commit carry only the sha header + the TAB content line, so
 * we keep a per-commit metadata map and reuse it for repeat shas.
 */
export function parseBlamePorcelain(output: string): BlameLine[] {
  const lines: BlameLine[] = []
  // Commit-level metadata cache: git only emits author / author-time on
  // the first line of each commit, so later lines look it up by sha.
  const metaByCommit = new Map<string, { author: string; authorTime: number }>()

  const rawLines = output.split('\n')
  let index = 0

  while (index < rawLines.length) {
    const header = rawLines[index]
    // Header is `<sha> <origLine> <finalLine> [<groupLines>]`. Anything
    // else at this position (trailing blank line) ends the parse.
    const headerMatch = header.match(/^([0-9a-f]{40})\s+\d+\s+(\d+)(?:\s+\d+)?$/)
    if (!headerMatch) {
      index += 1
      continue
    }
    const [, hash, finalLineStr] = headerMatch
    const lineNumber = Number.parseInt(finalLineStr, 10)
    index += 1

    let author = metaByCommit.get(hash)?.author
    let authorTime = metaByCommit.get(hash)?.authorTime

    // Consume metadata lines until the TAB-prefixed content line. On a
    // repeat commit there are none, so the first iteration already sees
    // the content line and the loop body's break fires immediately.
    while (index < rawLines.length) {
      const metaLine = rawLines[index]
      if (metaLine.startsWith('\t')) {
        // The content line. Strip the single leading TAB the porcelain
        // format prepends; preserve everything after it verbatim.
        const content = metaLine.slice(1)
        const resolvedAuthor = author ?? 'Unknown'
        const resolvedTime = authorTime ?? 0
        metaByCommit.set(hash, { author: resolvedAuthor, authorTime: resolvedTime })
        lines.push({
          hash,
          shortHash: hash === UNCOMMITTED_SHA ? 'staged  ' : hash.slice(0, 8),
          author: resolvedAuthor,
          authorTime: resolvedTime,
          lineNumber,
          content,
        })
        index += 1
        break
      }
      if (metaLine.startsWith('author ') && !metaLine.startsWith('author-')) {
        author = metaLine.slice('author '.length)
      } else if (metaLine.startsWith('author-time ')) {
        const parsed = Number.parseInt(metaLine.slice('author-time '.length), 10)
        authorTime = Number.isFinite(parsed) ? parsed : 0
      }
      index += 1
    }
  }

  // Keep blame lines in file order so windowed rendering around the
  // cursor maps directly to source lines.
  lines.sort((a, b) => a.lineNumber - b.lineNumber)
  return lines
}

/**
 * Load blame for a single repo-relative path via
 * `git blame --porcelain -- <path>`. Best-effort: failures resolve to a
 * `{ ok: false }` result the surface renders as a placeholder.
 */
export async function getBlame(git: SimpleGit, path: string): Promise<BlameResult> {
  let output = ''
  try {
    output = await git.raw(['blame', '--porcelain', '--', path])
  } catch (error) {
    const message = error instanceof Error ? error.message : 'git blame failed'
    return { ok: false, path, message }
  }
  const lines = parseBlamePorcelain(output)
  return { ok: true, path, lines }
}
