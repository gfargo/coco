import { existsSync } from 'fs'
import { SimpleGit } from 'simple-git'

/**
 * Bisect state surfacing for the TUI (#784).
 *
 * Bisect is the one git workflow where a TUI can dramatically beat
 * the CLI — every step needs a commit hash that the user has to copy
 * out of `git log` today. To support that we need a small loader that
 * (a) detects whether bisect is active, (b) parses the user-visible
 * decision log, and (c) reports the current candidate commit so the
 * surface can render it without an extra round-trip.
 *
 * Detection is via `.git/BISECT_LOG` (created by `git bisect start`,
 * removed by `git bisect reset`). Parsing reads `git bisect log` so
 * we get the same authoritative output git itself uses for resume.
 */

export type BisectLogEntryKind = 'start' | 'good' | 'bad' | 'skip' | 'unknown'

export type BisectLogEntry = {
  kind: BisectLogEntryKind
  /** Short or full hash referenced by the entry, when present. */
  sha?: string
  /** Subject line (commit message) — only present for start/good/bad entries that include it. */
  subject?: string
  /** Original log line, preserved for verbose renderers and as a fallback display. */
  raw: string
}

export type BisectStatus = {
  /** True when `.git/BISECT_LOG` exists. */
  active: boolean
  /** HEAD sha at the moment the status was loaded. The bisect candidate
   *  the user is being asked to test. Empty string when not active or
   *  the read failed. */
  currentSha: string
  /** Parsed `git bisect log` entries, oldest-first. */
  log: BisectLogEntry[]
}

const EMPTY_STATUS: BisectStatus = {
  active: false,
  currentSha: '',
  log: [],
}

async function bisectIsActive(git: SimpleGit): Promise<boolean> {
  try {
    const path = (await git.revparse(['--git-path', 'BISECT_LOG'])).trim()
    return path.length > 0 && existsSync(path)
  } catch {
    return false
  }
}

/**
 * Parse the output of `git bisect log` into structured entries. Each
 * entry corresponds to one user decision (start / good / bad / skip)
 * or the "# bad: [<sha>] <subject>" comment lines git emits for
 * traceability. Comment lines without a recognized prefix are dropped
 * — they're informational headers ("# status: ..."), not actions
 * the user took.
 */
export function parseBisectLog(output: string): BisectLogEntry[] {
  const entries: BisectLogEntry[] = []

  for (const rawLine of output.split('\n')) {
    const line = rawLine.trimEnd()
    if (!line) continue

    // Comment rows: "# good: [sha] subject" / "# bad: [sha] subject" /
    // "# first bad commit: ..." / "# status: ...". The first two carry
    // the most user-relevant info (which commits were marked) so we
    // promote them to typed entries; the rest fall through as raw
    // lines tagged 'unknown' so the renderer can dim them or hide
    // entirely.
    if (line.startsWith('#')) {
      const commentMatch = line.match(/^#\s+(good|bad|skip):\s+\[([^\]]+)\]\s*(.*)$/)
      if (commentMatch) {
        entries.push({
          kind: commentMatch[1] as BisectLogEntryKind,
          sha: commentMatch[2],
          subject: commentMatch[3] || undefined,
          raw: line,
        })
        continue
      }
      entries.push({ kind: 'unknown', raw: line })
      continue
    }

    // Command rows: "git bisect start", "git bisect good <sha>",
    // "git bisect bad <sha>", "git bisect skip <sha>".
    const commandMatch = line.match(/^git\s+bisect\s+(start|good|bad|skip)\s*(.*)$/)
    if (commandMatch) {
      const sha = commandMatch[2]?.trim().split(/\s+/)[0] || undefined
      entries.push({
        kind: commandMatch[1] as BisectLogEntryKind,
        sha: sha || undefined,
        raw: line,
      })
      continue
    }

    entries.push({ kind: 'unknown', raw: line })
  }

  return entries
}

/**
 * Load the live bisect status. Best-effort — when bisect isn't
 * active the empty-status sentinel returns immediately so callers
 * don't pay for a `git bisect log` round-trip on every refresh.
 */
export async function getBisectStatus(git: SimpleGit): Promise<BisectStatus> {
  if (!(await bisectIsActive(git))) {
    return EMPTY_STATUS
  }

  let log: BisectLogEntry[] = []
  try {
    const output = await git.raw(['bisect', 'log'])
    log = parseBisectLog(output)
  } catch {
    // bisect log can fail on a freshly-started bisect with no decisions.
    // Treat the absence of a parseable log as "active but empty" rather
    // than non-active, so the surface still routes to the bisect view
    // and the user can see the badge.
    log = []
  }

  let currentSha = ''
  try {
    currentSha = (await git.revparse(['HEAD'])).trim()
  } catch {
    currentSha = ''
  }

  return { active: true, currentSha, log }
}
