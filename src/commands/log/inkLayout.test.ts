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
    // 80 * 0.22 = 17.6 → floor 17 → clamped up to the 20-cell minimum
    expect(layout.detailWidth).toBe(20)
  })

  it('uses a balanced layout at the default terminal size', () => {
    const layout = getLogInkLayout({ columns: 120, rows: 40 })

    expect(layout.tooSmall).toBe(false)
    expect(layout.bodyRows).toBe(35)
    expect(layout.sidebarWidth).toBe(28)
    // 120 * 0.22 = 26.4 → floor 26
    expect(layout.detailWidth).toBe(26)
  })

  it('caps side panel widths on wide terminals', () => {
    const layout = getLogInkLayout({ columns: 200, rows: 60 })

    expect(layout.tooSmall).toBe(false)
    expect(layout.bodyRows).toBe(55)
    expect(layout.sidebarWidth).toBe(34)
    // 200 * 0.22 = 44 → clamped down to the 32-cell maximum
    expect(layout.detailWidth).toBe(32)
  })

  it('clamps the inspector at rest to its 20-32 cell range', () => {
    const tiny = getLogInkLayout({ columns: 80, rows: 24 })
    const huge = getLogInkLayout({ columns: 400, rows: 80 })

    expect(tiny.detailWidth).toBe(20)
    expect(huge.detailWidth).toBe(32)
  })

  it('grows the inspector when inspectorFocused is set', () => {
    const collapsed = getLogInkLayout({ columns: 120, rows: 40 })
    const expanded = getLogInkLayout({ columns: 120, rows: 40, inspectorFocused: true })

    expect(expanded.detailWidth).toBeGreaterThan(collapsed.detailWidth)
    // 120 * 0.40 = 48 → clamped down to the 60-cell maximum (no clamp needed at 120)
    expect(expanded.detailWidth).toBe(48)
    expect(expanded.sidebarWidth).toBe(collapsed.sidebarWidth)
    // Main panel shrinks to absorb the inspector growth.
    expect(expanded.mainPanelWidth).toBe(120 - expanded.sidebarWidth - expanded.detailWidth)
  })

  it('clamps the focused inspector to its 36-60 cell range', () => {
    const narrow = getLogInkLayout({ columns: 80, rows: 24, inspectorFocused: true })
    const wide = getLogInkLayout({ columns: 200, rows: 60, inspectorFocused: true })

    expect(narrow.detailWidth).toBe(36)
    expect(wide.detailWidth).toBe(60)
  })

  it('reports terminals below the minimum as too small', () => {
    expect(getLogInkLayout({ columns: 79, rows: 24 }).tooSmall).toBe(true)
    expect(getLogInkLayout({ columns: 80, rows: 23 }).tooSmall).toBe(true)
  })

  // #806 follow-up — the inspector switches to a tabbed layout on
  // short terminals so the commit-detail and actions sections each
  // get their own view rather than clipping. Threshold lives in
  // INSPECTOR_TABBED_BELOW_ROWS so the runtime + tests share one
  // value.
  it('flags inspectorTabbed when the terminal is shorter than the threshold', () => {
    expect(getLogInkLayout({ columns: 120, rows: 24 }).inspectorTabbed).toBe(true)
    expect(getLogInkLayout({ columns: 120, rows: 27 }).inspectorTabbed).toBe(true)
    expect(getLogInkLayout({ columns: 120, rows: 28 }).inspectorTabbed).toBe(false)
    expect(getLogInkLayout({ columns: 120, rows: 40 }).inspectorTabbed).toBe(false)
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

  // Help overlay (#832) — wrests width from the history panel so the
  // hotkey descriptions stop truncating. Wins over both the at-rest
  // and the inspector-focused states.
  describe('helpOverlayActive', () => {
    it('expands the detail panel beyond both at-rest and inspector-focused widths', () => {
      const collapsed = getLogInkLayout({ columns: 160, rows: 40 })
      const focused = getLogInkLayout({ columns: 160, rows: 40, inspectorFocused: true })
      const help = getLogInkLayout({ columns: 160, rows: 40, helpOverlayActive: true })

      expect(help.detailWidth).toBeGreaterThan(focused.detailWidth)
      expect(help.detailWidth).toBeGreaterThan(collapsed.detailWidth)
      // Main panel absorbs the loss so the three columns still tile
      // across the terminal width.
      expect(help.mainPanelWidth).toBe(160 - help.sidebarWidth - help.detailWidth)
    })

    it('clamps the help-overlay detail width to its 60-100 cell range', () => {
      const narrow = getLogInkLayout({ columns: 80, rows: 24, helpOverlayActive: true })
      const wide = getLogInkLayout({ columns: 240, rows: 60, helpOverlayActive: true })
      expect(narrow.detailWidth).toBe(60)
      expect(wide.detailWidth).toBe(100)
    })

    it('overrides inspectorFocused when both are set (help wins)', () => {
      const both = getLogInkLayout({
        columns: 160,
        rows: 40,
        inspectorFocused: true,
        helpOverlayActive: true,
      })
      const helpOnly = getLogInkLayout({ columns: 160, rows: 40, helpOverlayActive: true })
      expect(both.detailWidth).toBe(helpOnly.detailWidth)
    })
  })
})
