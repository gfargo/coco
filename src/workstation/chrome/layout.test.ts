import {
  LAYOUT_RAIL_PANEL_WIDTH,
  LOG_INK_MIN_COLUMNS,
  LOG_INK_MIN_ROWS,
  getLogInkLayout,
} from './layout'

describe('log Ink layout', () => {
  it('accepts the minimum supported terminal size', () => {
    const layout = getLogInkLayout({
      columns: LOG_INK_MIN_COLUMNS,
      rows: LOG_INK_MIN_ROWS,
    })

    expect(layout.tooSmall).toBe(false)
    expect(layout.bodyRows).toBe(19)
    // 80 columns falls into the rail tier (< 100), so both side
    // panels collapse to the fixed rail width and the history panel
    // takes everything they gave up.
    expect(layout.density).toBe('rail')
    expect(layout.sidebarWidth).toBe(LAYOUT_RAIL_PANEL_WIDTH)
    expect(layout.detailWidth).toBe(LAYOUT_RAIL_PANEL_WIDTH)
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

  it('clamps the inspector at rest to its 20-32 cell range above the rail tier', () => {
    // 100 columns is the lower bound of the tight tier — rail
    // collapse no longer applies, so the at-rest clamp wins.
    // 100 * 0.22 = 22 → in the 20-32 range, no clamp needed.
    const tight = getLogInkLayout({ columns: 100, rows: 24 })
    const huge = getLogInkLayout({ columns: 400, rows: 80 })

    expect(tight.density).toBe('tight')
    expect(tight.detailWidth).toBe(22)
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

  // Responsive density tiers — drive history-row column dropping,
  // relative-date formatting, row stacking, and side-panel rail
  // collapse. Breakpoints live in `LAYOUT_*_BELOW` constants so the
  // layout function + tests + downstream renderers share the same
  // numbers.
  describe('density tiers', () => {
    it('classifies wide / normal / tight / rail by column count', () => {
      expect(getLogInkLayout({ columns: 200, rows: 40 }).density).toBe('wide')
      expect(getLogInkLayout({ columns: 160, rows: 40 }).density).toBe('wide')
      expect(getLogInkLayout({ columns: 159, rows: 40 }).density).toBe('normal')
      expect(getLogInkLayout({ columns: 120, rows: 40 }).density).toBe('normal')
      expect(getLogInkLayout({ columns: 119, rows: 40 }).density).toBe('tight')
      expect(getLogInkLayout({ columns: 100, rows: 40 }).density).toBe('tight')
      expect(getLogInkLayout({ columns: 99, rows: 40 }).density).toBe('rail')
      expect(getLogInkLayout({ columns: 80, rows: 24 }).density).toBe('rail')
    })

    it('stacks history rows only at the rail tier', () => {
      expect(getLogInkLayout({ columns: 200, rows: 40 }).historyRowMode).toBe('single')
      expect(getLogInkLayout({ columns: 120, rows: 40 }).historyRowMode).toBe('single')
      expect(getLogInkLayout({ columns: 100, rows: 40 }).historyRowMode).toBe('single')
      expect(getLogInkLayout({ columns: 90, rows: 40 }).historyRowMode).toBe('stacked')
    })

    it('rails the sidebar and inspector at rail tier when unfocused', () => {
      const layout = getLogInkLayout({ columns: 90, rows: 40 })

      expect(layout.sidebarRailed).toBe(true)
      expect(layout.inspectorRailed).toBe(true)
      expect(layout.sidebarWidth).toBe(LAYOUT_RAIL_PANEL_WIDTH)
      expect(layout.detailWidth).toBe(LAYOUT_RAIL_PANEL_WIDTH)
      // History gets everything the side panels gave up.
      expect(layout.mainPanelWidth).toBe(90 - LAYOUT_RAIL_PANEL_WIDTH * 2)
    })

    it('un-rails a panel when it takes focus, even on a narrow terminal', () => {
      const sidebarFocused = getLogInkLayout({ columns: 90, rows: 40, sidebarFocused: true })
      expect(sidebarFocused.sidebarRailed).toBe(false)
      // 90 * 0.36 = 32.4 → floor 32; clamps stay 32-50 so this lands at 32.
      expect(sidebarFocused.sidebarWidth).toBe(32)
      // Inspector stays railed since the user isn't reading it.
      expect(sidebarFocused.inspectorRailed).toBe(true)
      expect(sidebarFocused.detailWidth).toBe(LAYOUT_RAIL_PANEL_WIDTH)

      const inspectorFocused = getLogInkLayout({ columns: 90, rows: 40, inspectorFocused: true })
      expect(inspectorFocused.inspectorRailed).toBe(false)
      // 90 * 0.40 = 36 → clamps to 36-60 lower bound.
      expect(inspectorFocused.detailWidth).toBe(36)
      expect(inspectorFocused.sidebarRailed).toBe(true)
    })

    it('keeps panels at normal widths above the rail breakpoint', () => {
      const tight = getLogInkLayout({ columns: 110, rows: 40 })
      expect(tight.sidebarRailed).toBe(false)
      expect(tight.inspectorRailed).toBe(false)
      // 110 * 0.24 = 26.4 → floor 26 (in the 22-34 unfocused range)
      expect(tight.sidebarWidth).toBe(26)
    })

    it('lets the help overlay override inspector rail', () => {
      const railedHelp = getLogInkLayout({
        columns: 90,
        rows: 40,
        helpOverlayActive: true,
      })
      // Help wants room for hotkey descriptions; rail collapse would
      // defeat that purpose. 60-cell minimum kicks in here.
      expect(railedHelp.detailWidth).toBe(60)
      expect(railedHelp.inspectorRailed).toBe(false)
    })
  })
})
