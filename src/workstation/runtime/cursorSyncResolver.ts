import { hashLoaded } from '../../git/hashes'

/**
 * Pure decision logic for the history-view cursor sync effect.
 *
 * The effect itself lives in `app.ts` and does the React state
 * plumbing (read context, dispatch actions, manage refs). This module
 * holds the actual "what should happen?" decision so it can be unit
 * tested without spinning up the full app.
 *
 * Three real outcomes:
 *
 *   1. **Jump** — the target's commit hash is already in the loaded
 *      history window. Move the cursor.
 *
 *   2. **Load context** — the target isn't loaded yet, but we haven't
 *      tried anchoring a log fetch on it. The caller runs `git log`
 *      with the target as an explicit graph root (guaranteed to
 *      include it) and merges the result into the loaded window.
 *      The effect then re-fires and resolves to `jump`.
 *
 *   3. **Unreachable** — we already tried anchoring on the target
 *      and it still didn't materialise. The target hash is bogus or
 *      its ref has been GC'd. Surface the status and stop trying.
 *
 * Plus two no-op cases that exist so callers can keep their dispatch
 * paths uniform: `no-target` (no ref under the cursor) and
 * `duplicate-of-last` (the user re-cursored the same ref, we already
 * synced to its hash, skip the status churn).
 */

export type CursorSyncTarget = {
  hash: string
  label: string
}

export type CursorSyncDecision =
  | { type: 'noop'; reason: 'no-target' | 'duplicate-of-last' }
  | { type: 'jump'; hash: string; label: string }
  | { type: 'load-context'; target: CursorSyncTarget }
  | { type: 'unreachable'; target: CursorSyncTarget }

export type CursorSyncInput = {
  /**
   * The hash + label the user cursored, or undefined when there's no
   * selectable row (empty branch list, etc.). Undefined → `noop`.
   */
  target: CursorSyncTarget | undefined
  /**
   * Fast lookup over `state.filteredCommits`. The caller builds this
   * once per effect run rather than passing the full row array so the
   * resolver stays O(1) on the membership check.
   */
  loadedHashes: Set<string>
  /**
   * The last hash we successfully synced to. Returned by previous
   * calls and held in a ref. When the new target equals this value
   * the resolver short-circuits — re-cursoring the same ref or
   * cursoring a different ref pointing at the same commit shouldn't
   * fire a redundant status update.
   */
  lastSyncedHash: string | undefined
  /**
   * Set of hashes the caller has already attempted to anchor a log
   * fetch on. Lets the resolver distinguish "haven't tried yet, do a
   * load-context" from "tried, it didn't help, give up." The caller
   * adds the target hash to this set when it kicks off the fetch and
   * keeps the entry there even after the fetch resolves (the
   * resolver's job is to STOP suggesting load-context, not to track
   * fetch lifecycle).
   */
  attemptedContextHashes: ReadonlySet<string>
}

export function resolveCursorSyncDecision(
  input: CursorSyncInput
): CursorSyncDecision {
  if (!input.target) {
    return { type: 'noop', reason: 'no-target' }
  }
  if (input.target.hash === input.lastSyncedHash) {
    return { type: 'noop', reason: 'duplicate-of-last' }
  }
  if (isHashLoaded(input.target.hash, input.loadedHashes)) {
    return {
      type: 'jump',
      hash: input.target.hash,
      label: input.target.label,
    }
  }
  if (input.attemptedContextHashes.has(input.target.hash)) {
    return { type: 'unreachable', target: input.target }
  }
  return { type: 'load-context', target: input.target }
}

/**
 * Re-export of the shared `hashLoaded` helper under the resolver's
 * historical name. Kept exported so existing tests (and any external
 * importers) keep working unchanged — see `src/git/hashes.ts` for the
 * canonical implementation and the rationale behind bidirectional
 * prefix matching.
 */
export function isHashLoaded(hash: string, loadedHashes: ReadonlySet<string>): boolean {
  return hashLoaded(hash, loadedHashes)
}

/**
 * Build the membership set the resolver expects. Includes BOTH the
 * full hash and the short hash for every commit so the caller can
 * match either form (refs sometimes carry only the short hash and
 * `state.filteredCommits` items always have both).
 *
 * Exported so the cursor-sync effect can build the set once per
 * re-render and pass it down without leaking the implementation
 * detail. Tests use it to construct realistic inputs without
 * hand-rolling the dual-hash logic.
 */
export function buildLoadedHashSet(
  commits: ReadonlyArray<{ hash: string; shortHash?: string }>
): Set<string> {
  const set = new Set<string>()
  for (const commit of commits) {
    if (commit.hash) set.add(commit.hash)
    if (commit.shortHash) set.add(commit.shortHash)
  }
  return set
}
