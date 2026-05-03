import {
  LOG_INK_MIN_COLUMNS,
  LOG_INK_MIN_ROWS,
  getLogInkLayout,
} from './inkLayout'

describe('log Ink layout', () => {
  it('accepts the minimum supported terminal size', () => {
    const layout = getLogInkLayout({
      columns: LOG_INK_MIN_COLUMNS,
      rows: LOG_INK_MIN_ROWS,
    })

    expect(layout.tooSmall).toBe(false)
    expect(layout.bodyRows).toBe(19)
    expect(layout.sidebarWidth).toBe(22)
    // 80 * 0.28 = 22.4 → floor 22 → clamped up to the 26-cell minimum
    expect(layout.detailWidth).toBe(26)
  })

  it('uses a balanced layout at the default terminal size', () => {
    const layout = getLogInkLayout({ columns: 120, rows: 40 })

    expect(layout.tooSmall).toBe(false)
    expect(layout.bodyRows).toBe(35)
    expect(layout.sidebarWidth).toBe(28)
    // 120 * 0.28 = 33.6 → floor 33
    expect(layout.detailWidth).toBe(33)
  })

  it('caps side panel widths on wide terminals', () => {
    const layout = getLogInkLayout({ columns: 200, rows: 60 })

    expect(layout.tooSmall).toBe(false)
    expect(layout.bodyRows).toBe(55)
    expect(layout.sidebarWidth).toBe(34)
    // 200 * 0.28 = 56 → clamped down to the 44-cell maximum
    expect(layout.detailWidth).toBe(44)
  })

  it('clamps the inspector to its 26-44 cell range', () => {
    const tiny = getLogInkLayout({ columns: 80, rows: 24 })
    const huge = getLogInkLayout({ columns: 400, rows: 80 })

    expect(tiny.detailWidth).toBe(26)
    expect(huge.detailWidth).toBe(44)
  })

  it('reports terminals below the minimum as too small', () => {
    expect(getLogInkLayout({ columns: 79, rows: 24 }).tooSmall).toBe(true)
    expect(getLogInkLayout({ columns: 80, rows: 23 }).tooSmall).toBe(true)
  })

  it('grows the sidebar when sidebarFocused is set', () => {
    const collapsed = getLogInkLayout({ columns: 120, rows: 40 })
    const expanded = getLogInkLayout({ columns: 120, rows: 40, sidebarFocused: true })

    expect(expanded.sidebarWidth).toBeGreaterThan(collapsed.sidebarWidth)
    expect(expanded.sidebarWidth).toBe(43)
    expect(expanded.detailWidth).toBe(collapsed.detailWidth)
    // Main panel shrinks to absorb the sidebar growth so the three
    // panels still tile flush across the terminal.
    expect(expanded.mainPanelWidth).toBe(120 - expanded.sidebarWidth - expanded.detailWidth)
  })

  it('clamps the focused sidebar to its 32–50 cell range', () => {
    const narrow = getLogInkLayout({ columns: 80, rows: 24, sidebarFocused: true })
    const wide = getLogInkLayout({ columns: 200, rows: 60, sidebarFocused: true })

    expect(narrow.sidebarWidth).toBe(32)
    expect(wide.sidebarWidth).toBe(50)
  })
})
