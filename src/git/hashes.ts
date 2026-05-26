/**
 * Shared hash-matching helpers for cross-command lookups.
 *
 * Git surfaces the same commit with different short-hash lengths
 * depending on which command produced the row:
 *
 *   - `for-each-ref --format=%(objectname:short)` (branches, tags,
 *     stashes) honors `core.abbrev`, typically 7 chars.
 *   - `git log --pretty=format:%h` (history rows) honors the same
 *     setting BUT git auto-extends abbreviations to keep them unique
 *     within the walked set — so the same commit can come back as 7
 *     chars from one command and 8 (or more) from another.
 *
 * Consequence: any exact-equality lookup that compares a hash from
 * `for-each-ref` against a hash from `git log` will miss the match
 * even when both refer to the same commit. This bit the workstation's
 * cursor-sync effect twice during 0.54.2 — once in the resolver, once
 * in the `selectCommitByHash` reducer — and shows up wherever a ref
 * hash is checked against the loaded log window.
 *
 * The fix is bidirectional prefix matching: a hash matches another if
 * one is a prefix of the other. Below a 4-char floor we refuse to
 * match — three chars would collide with too many real commits.
 *
 * This module is the canonical place for that logic. Import it
 * anywhere you compare a "hash from one git formatter" against a
 * "hash from a different git formatter."
 *
 * Lives in `src/git/` because both `workstation/` and `commands/log/`
 * depend on it — `commands/log/` must not depend on `workstation/`,
 * so this can't live in `workstation/runtime/cursorSyncResolver.ts`.
 */

/**
 * Minimum length below which we refuse to prefix-match. Three chars
 * is too small to be a meaningful unique prefix for any real-world
 * git history.
 */
const MIN_PREFIX_LENGTH = 4

/**
 * True when `a` and `b` refer to the same commit, tolerating
 * short-hash length differences from different git formatters.
 *
 * Symmetric: `hashesMatch(a, b) === hashesMatch(b, a)`. An exact
 * string equality wins immediately (the common path); otherwise we
 * test bidirectional `startsWith` and bail when either input is too
 * short to be a meaningful prefix.
 */
export function hashesMatch(
  a: string | undefined,
  b: string | undefined
): boolean {
  if (!a || !b) return false
  if (a === b) return true
  if (a.length < MIN_PREFIX_LENGTH || b.length < MIN_PREFIX_LENGTH) return false
  return a.startsWith(b) || b.startsWith(a)
}

/**
 * True when `hash` matches any entry in `candidates`. Convenience
 * wrapper for the common "is this ref's hash in any of the row's
 * hash variants?" check.
 */
export function hashesMatchAny(
  hash: string | undefined,
  candidates: ReadonlyArray<string | undefined>
): boolean {
  if (!hash) return false
  return candidates.some((candidate) => hashesMatch(hash, candidate))
}

/**
 * True when `hash` is present in the loaded set — exact match first
 * (the O(1) fast path), then bidirectional `startsWith` over the set
 * to cover the formatter mismatch.
 *
 * The set is small in practice (1k–5k entries) so O(N) iteration on
 * miss is fine.
 */
export function hashLoaded(hash: string, loaded: ReadonlySet<string>): boolean {
  if (loaded.has(hash)) return true
  if (hash.length < MIN_PREFIX_LENGTH) return false
  for (const entry of loaded) {
    if (entry.startsWith(hash) || hash.startsWith(entry)) return true
  }
  return false
}
