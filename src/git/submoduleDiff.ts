/**
 * Submodule diff summarization (#884).
 *
 * Submodule changes render in `git diff` as a two-line gist:
 *
 *     -Subproject commit abcdef1234567890…
 *     +Subproject commit 1234567890abcdef…
 *
 * That's accurate but uninformative — the user can't tell what
 * the submodule actually points at, just that the SHA changed.
 * This module detects those patches and produces a one-line
 * replacement summary the surface can swap in.
 *
 * Detection is purely textual — no `git submodule` subprocess
 * required for the patch-level rewrite. The richer side-panel
 * inspector (submodule name · branch · HEAD message) needs
 * `git submodule status` and `.gitmodules` parsing; that's a
 * follow-up.
 */

const SUBPROJECT_PREFIX = 'Subproject commit '

export type SubmoduleChange =
  | { kind: 'added'; after: string }
  | { kind: 'removed'; before: string }
  | { kind: 'modified'; before: string; after: string }

/**
 * Scan a `git diff`'s addition / deletion lines for the
 * `Subproject commit <sha>` markers that signify a submodule
 * change. Returns the before / after pinned shas when detected,
 * undefined for normal patches.
 *
 * A submodule patch typically contains exactly one or two of
 * these markers (one for the old pinned commit, one for the new).
 * Both forms exist:
 *   - **added**    : `+Subproject commit …`  (submodule newly registered)
 *   - **removed**  : `-Subproject commit …`  (submodule unregistered)
 *   - **modified** : one of each              (most common case)
 */
export function extractSubmoduleChange(lines: string[]): SubmoduleChange | undefined {
  let after: string | undefined
  let before: string | undefined

  for (const line of lines) {
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+') && line.slice(1).startsWith(SUBPROJECT_PREFIX)) {
      after = line.slice(1 + SUBPROJECT_PREFIX.length).trim()
    } else if (line.startsWith('-') && line.slice(1).startsWith(SUBPROJECT_PREFIX)) {
      before = line.slice(1 + SUBPROJECT_PREFIX.length).trim()
    }
  }

  if (before && after) return { kind: 'modified', before, after }
  if (after) return { kind: 'added', after }
  if (before) return { kind: 'removed', before }
  return undefined
}

/**
 * Format a `SubmoduleChange` as a one-line human-readable summary.
 * Examples:
 *   `submodule added: 1234567a…`
 *   `submodule modified: 1234567a… → abcdef12…`
 *   `submodule removed: 1234567a…`
 */
export function renderSubmoduleSummary(change: SubmoduleChange): string {
  if (change.kind === 'added') {
    return `submodule added: ${shortenSha(change.after)}`
  }
  if (change.kind === 'removed') {
    return `submodule removed: ${shortenSha(change.before)}`
  }
  return `submodule modified: ${shortenSha(change.before)} → ${shortenSha(change.after)}`
}

function shortenSha(sha: string): string {
  // `Subproject commit` lines carry full 40-char shas. Trim to 8
  // (the same short-hash convention the rest of the TUI uses) and
  // add an ellipsis so the user knows it's truncated.
  return sha.length > 8 ? `${sha.slice(0, 8)}…` : sha
}
