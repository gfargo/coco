import { SimpleGit } from 'simple-git'

const FIELD_SEPARATOR = '\x1f'

/**
 * Per-row data for the promoted reflog view (#781). Mirrors the
 * `historyActions.ReflogEntry` shape used by the recovery banner but
 * adds the relative date so the view can render "2 hours ago" without
 * a second git call. Kept here (not in `historyActions.ts`) because
 * the reflog browser is the only consumer of the relative date and
 * the recovery banner reads only selector/hash/subject.
 */
export type ReflogViewEntry = {
  /** `HEAD@{N}` — the index selector. */
  selector: string
  /** Short hash (`%h`). */
  hash: string
  /** Committer-date relative (`%cr`), e.g. "2 hours ago". */
  relativeDate: string
  /** Reflog subject (`%gs`), e.g. "commit: my message" or "checkout: ...". */
  subject: string
}

export type ReflogOverview = {
  entries: ReflogViewEntry[]
}

/**
 * Default fetch limit. 200 entries is enough to span weeks of normal
 * activity for an active repo while keeping the load fast — `git reflog`
 * is local-only so even 1000+ entries is sub-second, but 200 keeps the
 * rendered list bounded for terminals.
 */
const DEFAULT_REFLOG_LIMIT = 200

export function parseReflogOverview(output: string): ReflogViewEntry[] {
  return output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const [selector, hash, relativeDate, subject] = line.split(FIELD_SEPARATOR)

      return {
        selector: selector || '',
        hash: hash || '',
        relativeDate: relativeDate || '',
        subject: subject || '',
      }
    })
}

export async function getReflogOverview(
  git: SimpleGit,
  limit = DEFAULT_REFLOG_LIMIT
): Promise<ReflogOverview> {
  const output = await git.raw([
    'reflog',
    `--max-count=${limit}`,
    `--pretty=format:%gd${FIELD_SEPARATOR}%h${FIELD_SEPARATOR}%cr${FIELD_SEPARATOR}%gs`,
  ])

  return {
    entries: parseReflogOverview(output),
  }
}

/**
 * Pull the action prefix off a reflog subject. Reflog subjects follow
 * a `<verb>[ qualifier]: <message>` pattern emitted by git itself —
 * "commit: ...", "commit (amend): ...", "checkout: moving from main
 * to feature", "merge feature: ...", "reset: moving to HEAD~1", etc.
 *
 * For display we want the verb (and any parenthetical qualifier) on
 * its own so the view can render a fixed-width `action` column and
 * keep the rest of the message left-aligned.
 *
 * Defensive: if the subject has no colon, the whole string is treated
 * as the action and the message is empty. This keeps the renderer
 * from crashing on a malformed entry.
 */
export function splitReflogSubject(subject: string): { action: string; message: string } {
  const colonIndex = subject.indexOf(':')
  if (colonIndex === -1) {
    return { action: subject.trim(), message: '' }
  }
  return {
    action: subject.slice(0, colonIndex).trim(),
    message: subject.slice(colonIndex + 1).trim(),
  }
}
