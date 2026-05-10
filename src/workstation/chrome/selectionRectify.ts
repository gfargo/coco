/**
 * Promoted-view selection rectification on filter changes (P4.5).
 *
 * Without this, the reducer used to snap selectedBranchIndex/Tag/Stash to 0
 * on every filter keystroke — which kept the cursor in range but lost the
 * user's place even when the previously-selected item was still in the
 * filtered result.
 *
 * The proper behavior (called out in #756 P4.5):
 *   - If the previously-selected item is still in the filtered list, the
 *     cursor follows it (its new index in the filtered list).
 *   - If it dropped out of the filtered list, snap to result[0].
 *   - If no filter change happened, leave the cursor alone.
 *
 * Implementation: the runtime computes a `PromotedSelectionsSnapshot` from
 * existing context items + the predicted next filter, attaches it to the
 * filter-mutating action, and the reducer applies the precomputed indexes.
 *
 * The rectification is a pure function over (lookup, filteredKeys); see
 * inkSelectionRectify.test.ts for the cases it covers.
 */

export type PromotedSelectionsSnapshot = {
  branchIndex?: number
  tagIndex?: number
  stashIndex?: number
}

/**
 * Map (filtered keys, previously-selected key) → new selected index.
 * Falls back to 0 when the key dropped out or no key was provided —
 * matching the spec's "snap to result[0]" requirement.
 *
 * The runtime is responsible for producing `filteredKeys` using the same
 * match function the renderer uses (multi-field haystacks per item).
 */
export function rectifyPromotedSelectionIndex(
  filteredKeys: string[],
  selectedKey: string | undefined
): number {
  if (filteredKeys.length === 0) {
    return 0
  }
  if (!selectedKey) {
    return 0
  }
  const next = filteredKeys.indexOf(selectedKey)
  return next < 0 ? 0 : next
}
