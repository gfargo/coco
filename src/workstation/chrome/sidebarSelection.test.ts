import {
  DEFAULT_SIDEBAR_VISIBLE,
  getSidebarVisibleWindow,
  sidebarTabHasSelectableItems,
} from './sidebarSelection'

describe('getSidebarVisibleWindow', () => {
  it('keeps the window anchored at the top when the list fits entirely', () => {
    expect(getSidebarVisibleWindow(5, 0)).toEqual({
      start: 0,
      size: 5,
      truncatedAbove: 0,
      truncatedBelow: 0,
    })
    expect(getSidebarVisibleWindow(5, 4)).toEqual({
      start: 0,
      size: 5,
      truncatedAbove: 0,
      truncatedBelow: 0,
    })
  })

  it('caps the window size at the configured visible count', () => {
    // 20 items, default 8 visible — window should be 8 wide regardless
    // of where the cursor is.
    const window = getSidebarVisibleWindow(20, 0)
    expect(window.size).toBe(DEFAULT_SIDEBAR_VISIBLE)
  })

  it('slides the window so the cursor stays in view while scrolling down', () => {
    // Cursor at index 12 in a 20-item list with visible=8 — window
    // should center the cursor (start=12-4=8) so 4 above + 4 including
    // cursor + below.
    const window = getSidebarVisibleWindow(20, 12, 8)
    expect(window.start).toBe(8)
    expect(window.size).toBe(8)
    expect(window.truncatedAbove).toBe(8)
    expect(window.truncatedBelow).toBe(4)
  })

  it('clamps the window against the bottom so it never overruns the list', () => {
    // Cursor near the end — window can't slide past total-size.
    const window = getSidebarVisibleWindow(20, 19, 8)
    expect(window.start).toBe(12)
    expect(window.size).toBe(8)
    expect(window.truncatedAbove).toBe(12)
    expect(window.truncatedBelow).toBe(0)
  })

  it('handles single-item lists without dividing-by-zero or empty windows', () => {
    expect(getSidebarVisibleWindow(1, 0)).toEqual({
      start: 0,
      size: 1,
      truncatedAbove: 0,
      truncatedBelow: 0,
    })
  })

  it('returns a usable window when the list is empty', () => {
    // Defensive: callers shouldn't ask for a window when total=0, but
    // if they do, return `start=0, size=1` so renderers don't blow up.
    const window = getSidebarVisibleWindow(0, 0)
    expect(window.start).toBe(0)
    expect(window.size).toBeGreaterThan(0)
  })
})

describe('sidebarTabHasSelectableItems', () => {
  it('returns true for content tabs with at least one item', () => {
    expect(sidebarTabHasSelectableItems('branches', 5)).toBe(true)
    expect(sidebarTabHasSelectableItems('tags', 1)).toBe(true)
    expect(sidebarTabHasSelectableItems('stashes', 12)).toBe(true)
    expect(sidebarTabHasSelectableItems('worktrees', 3)).toBe(true)
  })

  it('returns false for status tab regardless of count', () => {
    // Status tab's preview is worktree files, which don't have a
    // sidebar-level selection model — the dedicated status view owns
    // that interaction.
    expect(sidebarTabHasSelectableItems('status', 0)).toBe(false)
    expect(sidebarTabHasSelectableItems('status', 50)).toBe(false)
  })

  it('returns false for content tabs with zero or undefined items', () => {
    // Empty list → fall back to the generic "Enter drills in" behavior
    // so the user sees the dedicated view's empty state instead of a
    // no-op keystroke.
    expect(sidebarTabHasSelectableItems('branches', 0)).toBe(false)
    expect(sidebarTabHasSelectableItems('stashes', undefined)).toBe(false)
  })

  it('returns false for unknown tab names (defensive)', () => {
    expect(sidebarTabHasSelectableItems('mystery', 5)).toBe(false)
  })
})
