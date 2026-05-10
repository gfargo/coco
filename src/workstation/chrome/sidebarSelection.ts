/**
 * In-sidebar selection helpers (#791 follow-up — sidebar entity ops).
 *
 * The workstation sidebar's branches / tags / stashes / worktrees tabs
 * used to be read-only previews — to act on an entity the user had to
 * drill into the dedicated promoted view. With the per-entity ops
 * gated to also fire on `state.focus === 'sidebar'` plus a matching
 * `sidebarTab`, j/k navigates the visible list inside the sidebar
 * itself, Enter performs the primary action (checkout / open diff),
 * and the existing per-view secondary keys (a/p/X/D/R/u/+P) are now
 * reachable without leaving the workstation view.
 *
 * The sidebar accordion is short — the visible window for an active
 * tab is capped (defaults below) so a long branch list doesn't
 * collapse the rest of the chrome. When the cursor scrolls past the
 * visible window, this module produces a sliding window that keeps it
 * in view; the dedicated view stays the right home for "show me all
 * 80 branches at once."
 */

export type SidebarVisibleWindow = {
  /** Index in the source list of the first row inside the window. */
  start: number
  /** Number of rows the window can hold. */
  size: number
  /**
   * Number of source rows hidden ABOVE the window. Lets the renderer
   * paint a `… N more above` hint without recomputing.
   */
  truncatedAbove: number
  /**
   * Number of source rows hidden BELOW the window. Lets the renderer
   * paint a `… N more below` hint without recomputing.
   */
  truncatedBelow: number
}

export const DEFAULT_SIDEBAR_VISIBLE = 8

/**
 * Compute the sliding window so that `selected` stays inside it while
 * the window remains anchored at the top whenever possible (so short
 * lists don't scroll for no reason). When the cursor moves past the
 * window, the window slides just enough to keep the cursor in view —
 * matching the commit history's `clampWindowStart` behaviour for
 * familiarity.
 */
export function getSidebarVisibleWindow(
  total: number,
  selected: number,
  visible: number = DEFAULT_SIDEBAR_VISIBLE
): SidebarVisibleWindow {
  const size = Math.max(1, Math.min(visible, total))
  if (total <= visible) {
    return { start: 0, size, truncatedAbove: 0, truncatedBelow: 0 }
  }

  const half = Math.floor(size / 2)
  const idealStart = selected - half
  const maxStart = total - size
  const start = Math.max(0, Math.min(idealStart, maxStart))

  return {
    start,
    size,
    truncatedAbove: start,
    truncatedBelow: total - (start + size),
  }
}

/**
 * True when an in-sidebar action (j/k move, Enter checkout, etc.)
 * should fire instead of the generic drill-in / tab-cycle behaviour.
 *
 * Status tab is excluded because its preview shows worktree files —
 * those have their own selection model in the dedicated status view
 * and the sidebar doesn't surface them as selectable rows.
 */
export function sidebarTabHasSelectableItems(
  sidebarTab: string,
  itemCount: number | undefined
): boolean {
  if (!itemCount || itemCount <= 0) return false
  return sidebarTab === 'branches' ||
    sidebarTab === 'tags' ||
    sidebarTab === 'stashes' ||
    sidebarTab === 'worktrees'
}
