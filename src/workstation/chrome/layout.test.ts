import {
  LAYOUT_SINGLE_PANE_BELOW,
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
    // 80 columns falls below the single-pane breakpoint (< 100), so
    // exactly one full-width pane renders. With no focus flags set the
    // main pane is visible and takes the whole terminal; the side panes
    // are hidden (width 0), not railed.
    expect(layout.density).toBe('rail')
    expect(layout.singlePane).toBe(true)
    expect(layout.visiblePane).toBe('main')
    expect(layout.mainPanelWidth).toBe(80)
    expect(layout.sidebarWidth).toBe(0)
    expect(layout.detailWidth).toBe(0)
  })

  it('uses a balanced layout at the default terminal size', () => {
    const layout = getLogInkLayout({ columns: 120, rows: 40 })

    expect(layout.tooSmall).toBe(false)
    expect(layout.bodyRows).toBe(35)
    // 120 cols sits in the `normal` tier, where the sidebar uses
    // 22% × cols clamped to 22-30: 0.22 × 120 = 26.4 → floor 26.
    expect(layout.sidebarWidth).toBe(26)
    // 120 * 0.22 = 26.4 → floor 26
    expect(layout.detailWidth).toBe(26)
  })

  it('caps side panel widths on wide terminals so the main panel absorbs extra width', () => {
    const layout = getLogInkLayout({ columns: 200, rows: 60 })

    expect(layout.tooSmall).toBe(false)
    expect(layout.bodyRows).toBe(55)
    // 200 cols is `wide`. Sidebar clamps to 28-32: 0.20 × 200 = 40
    // → capped at 32. The sidebar stops growing past the wide-tier
    // ceiling so all the additional terminal width flows to the
    // history graph (the dominant view by user intent).
    expect(layout.sidebarWidth).toBe(32)
    // Inspector mirrors the same shape: 200 * 0.22 = 44 → clamped
    // at the 32-cell maximum.
    expect(layout.detailWidth).toBe(32)
    // Main panel gets everything else — at 200 cols that's
    // 200 - 32 - 32 = 136 cells for the commit graph. On wider
    // terminals (250, 300+ cols) the side panels stay at 32 and the
    // graph keeps growing.
    expect(layout.mainPanelWidth).toBe(136)
  })

  it('keeps the sidebar pinned at 32 across very wide terminals', () => {
    // Pin the "sidebar doesn't grow past 32" invariant explicitly so
    // a future tweak to the wide-tier fraction can't silently
    // re-introduce the old "sidebar bloats on big screens" behaviour.
    const huge = getLogInkLayout({ columns: 300, rows: 60 })
    const insane = getLogInkLayout({ columns: 500, rows: 60 })

    expect(huge.sidebarWidth).toBe(32)
    expect(insane.sidebarWidth).toBe(32)
    // Main panel keeps growing linearly: 300 - 32 - 32 = 236;
    // 500 - 32 - 32 = 436. The graph view gets all the extra real
    // estate.
    expect(huge.mainPanelWidth).toBe(236)
    expect(insane.mainPanelWidth).toBe(436)
  })

  it('holds the wide-tier floor at 28 so the sidebar doesn\'t shrink at the 159→160 boundary', () => {
    // Sanity that resizing UP across the normal→wide boundary doesn't
    // produce a jarring visual shrink. At 159 cols (normal tier),
    // 159 * 0.22 = 34 → clamped to 30. At 160 (wide), 160 * 0.20 = 32.
    // The floor of 28 means even smaller fractions land at 28+.
    const normalEdge = getLogInkLayout({ columns: 159, rows: 60 })
    const wideEdge = getLogInkLayout({ columns: 160, rows: 60 })

    expect(normalEdge.density).toBe('normal')
    expect(wideEdge.density).toBe('wide')
    expect(normalEdge.sidebarWidth).toBe(30)
    expect(wideEdge.sidebarWidth).toBe(32)
    // Wide-tier sidebar is the same or larger than the normal-tier
    // sidebar — never smaller. Avoids the "I expanded my terminal
    // and the sidebar got smaller" surprise.
    expect(wideEdge.sidebarWidth).toBeGreaterThanOrEqual(normalEdge.sidebarWidth)
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

  it('clamps the focused inspector to its 36-60 cell range in three-pane tiers', () => {
    // The 36-cell floor is only reachable below the single-pane
    // breakpoint, where the inspector instead takes the full width, so
    // the lowest three-pane focused width is floor(100 × 0.40) = 40.
    const narrow = getLogInkLayout({ columns: 100, rows: 24, inspectorFocused: true })
    const wide = getLogInkLayout({ columns: 200, rows: 60, inspectorFocused: true })

    expect(narrow.detailWidth).toBe(40)
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

  it('clamps the focused sidebar to its 32–50 cell range in three-pane tiers', () => {
    // The 32-cell floor is only reachable below the single-pane
    // breakpoint, where the sidebar instead takes the full width, so
    // the lowest three-pane focused width is floor(100 × 0.36) = 36.
    const narrow = getLogInkLayout({ columns: 100, rows: 24, sidebarFocused: true })
    const wide = getLogInkLayout({ columns: 200, rows: 60, sidebarFocused: true })

    expect(narrow.sidebarWidth).toBe(36)
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
      // 100 cols is the narrowest three-pane terminal; below it the
      // single-pane override gives the inspector the full width instead.
      const narrow = getLogInkLayout({ columns: 100, rows: 24, helpOverlayActive: true })
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

    it('drops to single-pane mode below the rail breakpoint', () => {
      const layout = getLogInkLayout({ columns: 90, rows: 40 })

      expect(layout.singlePane).toBe(true)
      // With no focus flags the main pane is visible, full-width; the
      // side panes are hidden (width 0), not railed.
      expect(layout.visiblePane).toBe('main')
      expect(layout.mainPanelWidth).toBe(90)
      expect(layout.sidebarWidth).toBe(0)
      expect(layout.detailWidth).toBe(0)
    })

    it('shows the focused pane full-width in single-pane mode', () => {
      const sidebarFocused = getLogInkLayout({ columns: 90, rows: 40, sidebarFocused: true })
      expect(sidebarFocused.visiblePane).toBe('sidebar')
      expect(sidebarFocused.sidebarWidth).toBe(90)
      expect(sidebarFocused.mainPanelWidth).toBe(0)
      expect(sidebarFocused.detailWidth).toBe(0)

      const inspectorFocused = getLogInkLayout({ columns: 90, rows: 40, inspectorFocused: true })
      expect(inspectorFocused.visiblePane).toBe('inspector')
      expect(inspectorFocused.detailWidth).toBe(90)
      expect(inspectorFocused.sidebarWidth).toBe(0)
      expect(inspectorFocused.mainPanelWidth).toBe(0)
    })

    it('keeps the three-pane layout above the rail breakpoint', () => {
      const tight = getLogInkLayout({ columns: 110, rows: 40 })
      expect(tight.singlePane).toBe(false)
      // 110 * 0.24 = 26.4 → floor 26 (in the 22-28 unfocused range)
      expect(tight.sidebarWidth).toBe(26)
      // All three panes tile flush.
      expect(tight.sidebarWidth + tight.mainPanelWidth + tight.detailWidth).toBe(110)
    })
  })

  // The at-rest sidebar width is tier-aware: tight stays compact,
  // normal shrinks slightly (was clamping at 34 across the whole
  // ~24% formula), and wide grows naturally up to 48 instead of
  // pinning at 34. Locks in the exact widths each tier produces at
  // its representative breakpoints so a future tweak to the
  // SIDEBAR_AT_REST_BY_TIER table doesn't quietly regress the spread.
  describe('tier-aware sidebar at-rest width', () => {
    // [columns, expectedSidebar, expectedDensity]. Formula reference,
    // kept here as a comment rather than per-row to satisfy lint:
    //
    //   tight  → `clamp(22, 28, 0.24 × cols)`
    //     100 → 24       (0.24 × 100 = 24)
    //     110 → 26       (0.24 × 110 = 26.4 → 26)
    //     119 → 28       (0.24 × 119 = 28.56 → 28 cap)
    //
    //   normal → `clamp(22, 30, 0.22 × cols)`
    //     120 → 26       (0.22 × 120 = 26.4 → 26)
    //     130 → 28       (0.22 × 130 = 28.6 → 28)
    //     140 → 30       (0.22 × 140 = 30.8 → 30 cap)
    //     150 → 30       (0.22 × 150 = 33 → 30 cap)
    //     159 → 30       (0.22 × 159 = 34.98 → 30 cap)
    //
    //   wide   → `clamp(28, 48, 0.24 × cols)`
    //     160 → 38       (0.24 × 160 = 38.4 → 38)
    //     180 → 43       (0.24 × 180 = 43.2 → 43)
    //     200 → 48       (0.24 × 200 = 48 — exactly the cap)
    //     250 → 48       (0.24 × 250 = 60 → 48 cap)
    //     400 → 48       (0.24 × 400 = 96 → 48 cap)
    it.each([
      [100, 24, 'tight'],
      [110, 26, 'tight'],
      [119, 28, 'tight'],
    ] as const)(
      'tight tier %i cols → sidebar %i',
      (columns, expected, density) => {
        const layout = getLogInkLayout({ columns, rows: 40 })
        expect(layout.density).toBe(density)
        expect(layout.sidebarWidth).toBe(expected)
      }
    )

    it.each([
      [120, 26, 'normal'],
      [130, 28, 'normal'],
      [140, 30, 'normal'],
      [150, 30, 'normal'],
      [159, 30, 'normal'],
    ] as const)(
      'normal tier %i cols → sidebar %i',
      (columns, expected, density) => {
        const layout = getLogInkLayout({ columns, rows: 40 })
        expect(layout.density).toBe(density)
        expect(layout.sidebarWidth).toBe(expected)
      }
    )

    it.each([
      // Wide tier now caps at 32 so the main panel absorbs extra
      // terminal width. 160 cols: floor (28) wins over 160 × 0.20 = 32
      // ... actually both equal 32 at 160 cols, but the cap takes
      // over from 165 onward.
      [160, 32, 'wide'],
      [180, 32, 'wide'],
      [200, 32, 'wide'],
      [250, 32, 'wide'],
      [400, 32, 'wide'],
    ] as const)(
      'wide tier %i cols → sidebar capped at 32',
      (columns, expected, density) => {
        const layout = getLogInkLayout({ columns, rows: 40 })
        expect(layout.density).toBe(density)
        expect(layout.sidebarWidth).toBe(expected)
      }
    )

    it('crosses the 159 → 160 boundary without the sidebar visibly shrinking', () => {
      // The wide tier raises the floor to 28 (vs normal's 22) and
      // caps at 32 — so a user dragging a window from 159 → 160 cols
      // sees the sidebar nudge up from 30 to 32 rather than lurching
      // down. The boundary feels like a small growth, not a
      // discontinuity, and from there the sidebar holds steady while
      // the main panel absorbs all the extra width.
      const normalEdge = getLogInkLayout({ columns: 159, rows: 40 })
      const wideEdge = getLogInkLayout({ columns: 160, rows: 40 })
      expect(normalEdge.sidebarWidth).toBe(30)
      expect(wideEdge.sidebarWidth).toBe(32)
      expect(wideEdge.sidebarWidth).toBeGreaterThan(normalEdge.sidebarWidth)
    })

    it('focused-sidebar width is unaffected by tier — keeps its 32-50 clamp', () => {
      // Regression guard for the design choice: focus = "user wants
      // to read the sidebar," which deserves consistent width across
      // tiers. Don't have the tier-aware at-rest formula bleed into
      // the focused path.
      const normalFocused = getLogInkLayout({ columns: 140, rows: 40, sidebarFocused: true })
      const wideFocused = getLogInkLayout({ columns: 200, rows: 40, sidebarFocused: true })

      // 140 × 0.36 = 50.4 → clamped to 50 (the focused cap)
      expect(normalFocused.sidebarWidth).toBe(50)
      // 200 × 0.36 = 72 → clamped to 50
      expect(wideFocused.sidebarWidth).toBe(50)
    })

    it('main panel still tiles flush across all tiers', () => {
      // Belt-and-suspenders: changing sidebar widths must NOT break
      // the `columns = sidebar + main + detail` invariant. Easy to
      // get wrong when widening one side; locking it here means a
      // future bump to the wide-tier cap can't silently push the
      // main panel below 0.
      for (const cols of [100, 119, 120, 159, 160, 200, 250]) {
        const layout = getLogInkLayout({ columns: cols, rows: 40 })
        expect(layout.sidebarWidth + layout.mainPanelWidth + layout.detailWidth).toBe(cols)
        expect(layout.mainPanelWidth).toBeGreaterThan(0)
      }
    })
  })

  // Single-pane fallback (#1135) — below LAYOUT_SINGLE_PANE_BELOW the
  // three-panel layout retires in favour of one full-width pane, the
  // focused one, Tab-cycled. Replaces the old 8-cell icon rails.
  describe('single-pane mode', () => {
    it('flips singlePane exactly at the breakpoint', () => {
      expect(getLogInkLayout({ columns: LAYOUT_SINGLE_PANE_BELOW, rows: 40 }).singlePane).toBe(false)
      expect(getLogInkLayout({ columns: LAYOUT_SINGLE_PANE_BELOW - 1, rows: 40 }).singlePane).toBe(true)
      expect(getLogInkLayout({ columns: 80, rows: 24 }).singlePane).toBe(true)
    })

    it('derives visiblePane from focus', () => {
      const base = { columns: 80, rows: 24 }
      expect(getLogInkLayout(base).visiblePane).toBe('main')
      expect(getLogInkLayout({ ...base, sidebarFocused: true }).visiblePane).toBe('sidebar')
      expect(getLogInkLayout({ ...base, inspectorFocused: true }).visiblePane).toBe('inspector')
    })

    it('only ever shows one pane — the visible one is full-width, the rest are zero', () => {
      for (const focus of [{}, { sidebarFocused: true }, { inspectorFocused: true }] as const) {
        const layout = getLogInkLayout({ columns: 80, rows: 24, ...focus })
        const widths = [layout.sidebarWidth, layout.mainPanelWidth, layout.detailWidth]
        // Exactly one pane is full-width (80); the other two are hidden.
        expect(widths.filter((w) => w === 80)).toHaveLength(1)
        expect(widths.filter((w) => w === 0)).toHaveLength(2)
      }
    })

    it('lets an overlay forcedPane override the focus-derived pane', () => {
      // The split-plan overlay lives in the main panel; while focus is
      // on the sidebar the runtime forces 'main' so the overlay shows.
      const splitPlan = getLogInkLayout({
        columns: 80,
        rows: 24,
        sidebarFocused: true,
        forcedPane: 'main',
      })
      expect(splitPlan.visiblePane).toBe('main')
      expect(splitPlan.mainPanelWidth).toBe(80)

      // Help / palette / confirmation overlays force the inspector.
      const help = getLogInkLayout({
        columns: 80,
        rows: 24,
        helpOverlayActive: true,
        forcedPane: 'inspector',
      })
      expect(help.visiblePane).toBe('inspector')
      expect(help.detailWidth).toBe(80)
    })

    it('ignores forcedPane above the breakpoint (all panes render)', () => {
      const layout = getLogInkLayout({ columns: 140, rows: 40, forcedPane: 'inspector' })
      expect(layout.singlePane).toBe(false)
      // forcedPane only applies in single-pane mode; visiblePane falls
      // back to the focus-derived default (main) and all three tile.
      expect(layout.visiblePane).toBe('main')
      expect(layout.sidebarWidth + layout.mainPanelWidth + layout.detailWidth).toBe(140)
    })
  })
})
