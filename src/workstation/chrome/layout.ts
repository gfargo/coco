export type LogInkLayoutInput = {
  columns: number
  rows: number
  /**
   * When true the sidebar grows so long branch / file names stop
   * truncating. Set this when the sidebar pane has focus — at rest the
   * sidebar stays compact so the diff / history panels get most of the
   * width.
   */
  sidebarFocused?: boolean
  /**
   * When true the inspector grows so the user can read long commit
   * bodies / file lists / action labels. Mirrors the sidebar pattern:
   * compact at rest so the commit graph dominates, wide on focus so
   * the inspection surface gets the room it needs.
   */
  inspectorFocused?: boolean
  /**
   * When true the right-hand panel takes a much larger share of the
   * width so the help / hotkey overlay can render its descriptions
   * without truncating to "Move focus...". The overlay is read-mostly
   * so taking visual real estate from the history panel while it's
   * open is fine — the user is paused on the help, not navigating.
   */
  helpOverlayActive?: boolean
  /**
   * Single-pane only. When an overlay needs a specific pane visible the
   * runtime passes it here so single-pane mode surfaces the overlay
   * instead of hiding it behind whatever pane focus points at:
   * split-plan renders in the main panel; help / palette / confirmation
   * / input-prompt / chord overlays all render in the inspector. Ignored
   * at or above `LAYOUT_SINGLE_PANE_BELOW` (every pane is visible there).
   */
  forcedPane?: LogInkVisiblePane
}

/**
 * Which of the three panes renders below `LAYOUT_SINGLE_PANE_BELOW`,
 * where only one shows at a time. Derived from focus (`sidebar` →
 * sidebar, `commits` → main, `detail` → inspector) so the existing Tab
 * focus cycle drives the pane switch with no new binding.
 */
export type LogInkVisiblePane = 'sidebar' | 'main' | 'inspector'

/**
 * Responsive tier for the whole UI, derived from terminal width. Higher
 * tiers progressively drop and reformat row segments to keep narrow
 * terminals readable:
 *
 *   - wide   (>= 160 cols) — absolute `YYYY-MM-DD` dates, full chrome
 *   - normal (120–159)     — compact relative dates (`2d`, `3w`)
 *   - tight  (100–119)     — date column dropped entirely
 *   - rail   (< 100)       — history rows stack on two lines; the UI
 *     drops to single-pane mode (one full-width pane, Tab-cycled)
 */
export type LogInkLayoutDensity = 'rail' | 'tight' | 'normal' | 'wide'

export type LogInkLayout = {
  bodyRows: number
  columns: number
  detailWidth: number
  /**
   * Width allocated to the main panel (history / status / diff / compose /
   * branches / tags / stash). Computed as `columns - sidebarWidth -
   * detailWidth` so the three panels always tile flush. Surfaces lock to
   * this width to prevent the box from resizing per file in diff view.
   */
  mainPanelWidth: number
  rows: number
  sidebarWidth: number
  tooSmall: boolean
  /**
   * True when the terminal is short enough that the inspector should
   * collapse its commit-detail and actions sections into a tabbed
   * layout (only the active tab renders). Mirrors the sidebar
   * accordion: same data, less scroll. The threshold lives below in
   * `INSPECTOR_TABBED_BELOW_ROWS` so the runtime and tests share a
   * single value.
   */
  inspectorTabbed: boolean
  /**
   * Width-derived tier that gates date formatting and row stacking in
   * the history surface. Below the `rail` breakpoint the UI also drops
   * to single-pane mode (see `singlePane`).
   */
  density: LogInkLayoutDensity
  /**
   * True when the terminal is too narrow to tile three panes, so the UI
   * shows exactly one full-width pane (`visiblePane`) and Tab cycles
   * which one. Replaces the retired 8-cell icon rails — an 8-cell stub
   * was worse than no panel. Gated on `columns < LAYOUT_SINGLE_PANE_BELOW`.
   */
  singlePane: boolean
  /**
   * In single-pane mode, which pane renders. Derived from focus (and an
   * active overlay's `forcedPane`); meaningless when `singlePane` is
   * false (all three panes render).
   */
  visiblePane: LogInkVisiblePane
  /**
   * `single` — each commit takes one row (current behavior).
   * `stacked` — each commit takes two rows: graph + hash + message on
   * line 1, date + refs dim on line 2. Used at `density === 'rail'`
   * where even tight-tier truncation would eat the subject.
   */
  historyRowMode: 'single' | 'stacked'
}

export const LOG_INK_MIN_COLUMNS = 80
export const LOG_INK_MIN_ROWS = 24
export const LOG_INK_DEFAULT_COLUMNS = 120
export const LOG_INK_DEFAULT_ROWS = 40

/**
 * Terminal-row threshold below which the inspector switches to a
 * tabbed layout (commit-detail vs actions). Picked empirically: at
 * 28 rows the inspector's full stack (~30 rows when fully populated)
 * starts clipping the actions section; below that, the tabbed mode
 * gives both views their own air.
 */
export const INSPECTOR_TABBED_BELOW_ROWS = 28

/**
 * Density-tier breakpoints in columns. Picked so the three legacy
 * panels (sidebar ~24-32 + inspector ~20-32 + main) still leave the
 * history panel with at least ~40 usable cells before we start
 * collapsing chrome:
 *
 *   wide   >= 160 — plenty of room; keep absolute dates
 *   normal >= 120 — relative dates save 8-ish cells without hiding info
 *   tight  >= 100 — drop date entirely; subject + refs are the priority
 *   rail   <  100 — history rows stack to two lines; the UI also drops
 *                   to single-pane mode (see `LAYOUT_SINGLE_PANE_BELOW`)
 */
export const LAYOUT_TIGHT_BELOW = 120
export const LAYOUT_NORMAL_BELOW = 160
export const LAYOUT_RAIL_BELOW = 100

/**
 * Width below which the three-panel layout can't tile without starving
 * every pane, so the UI shows exactly one full-width pane (the focused
 * one) and Tab cycles which pane is visible. Coincides with the `rail`
 * density breakpoint — single-pane mode replaces the old 8-cell icon
 * rails that used to render at this width.
 */
export const LAYOUT_SINGLE_PANE_BELOW = LAYOUT_RAIL_BELOW

/**
 * Sidebar at-rest size targets, tier-aware. The sidebar's purpose at
 * rest is to surface enough room for the most common tab content
 * (status / branches / tags / stashes / worktrees) without dominating
 * the layout — the history graph + diff are usually the focal point.
 *
 * The tier split lets narrow terminals stay compact (the user has
 * little room to spare) while wider terminals get a slightly larger
 * sidebar. **Pinned at the wide-tier ceiling**: once the terminal
 * grows past the normal tier the sidebar tops out at 32 cells. All
 * additional terminal width flows to the history graph + inspector
 * instead of bloating the sidebar. Matches user expectation that the
 * git graph is the dominant view on big terminals.
 *
 *   tight  (100-119) → `clamp(22, 28, 24% × cols)`  e.g. 100→24, 119→28
 *   normal (120-159) → `clamp(22, 30, 22% × cols)`  e.g. 120→26, 140→30
 *   wide   (≥ 160)   → `clamp(28, 32, 20% × cols)`  e.g. 160→32, 220→32
 *
 * The `tight` and `normal` tiers honor a hard floor of 22 cells —
 * narrower than that and the tab labels stop fitting on a single
 * line. The `wide` tier raises the floor to 28 so the sidebar
 * doesn't visually shrink when crossing the 159→160 boundary on a
 * resize. The wide-tier max of 32 keeps the sidebar from growing
 * past what the normal tier asks for — extra space goes to the
 * main panel.
 *
 * Focused state (Tab → sidebar) uses a different formula entirely
 * (`clamp(32, 50, 36% × cols)`) — deliberate user intent to read the
 * sidebar deserves the extra width regardless of tier.
 */
type SidebarAtRestConfig = { min: number; max: number; fraction: number }
const SIDEBAR_AT_REST_BY_TIER: Record<LogInkLayoutDensity, SidebarAtRestConfig> = {
  rail: { min: 22, max: 28, fraction: 0.24 }, // unused at rest — single-pane mode overrides the width
  tight: { min: 22, max: 28, fraction: 0.24 },
  normal: { min: 22, max: 30, fraction: 0.22 },
  wide: { min: 28, max: 32, fraction: 0.20 },
}

function calcSidebarAtRestWidth(columns: number, density: LogInkLayoutDensity): number {
  const config = SIDEBAR_AT_REST_BY_TIER[density]
  return Math.max(config.min, Math.min(config.max, Math.floor(columns * config.fraction)))
}

export function getLogInkLayout(input: LogInkLayoutInput): LogInkLayout {
  const columns = input.columns || LOG_INK_DEFAULT_COLUMNS
  const rows = input.rows || LOG_INK_DEFAULT_ROWS
  const density: LogInkLayoutDensity =
    columns >= LAYOUT_NORMAL_BELOW
      ? 'wide'
      : columns >= LAYOUT_TIGHT_BELOW
        ? 'normal'
        : columns >= LAYOUT_RAIL_BELOW
          ? 'tight'
          : 'rail'

  // Below the single-pane breakpoint the three-panel layout can't tile
  // without starving every pane, so we show exactly one full-width pane
  // — the focused one — and Tab cycles which pane is visible. This
  // replaces the retired 8-cell icon rails (an 8-cell stub showed a tab
  // glyph + count and nothing actionable).
  const singlePane = columns < LAYOUT_SINGLE_PANE_BELOW

  // Which pane shows in single-pane mode. Defaults to the focused pane
  // (focus and visibility coalesce, so the existing Tab focus cycle
  // drives it). An active overlay can force a specific pane via
  // `forcedPane` so its surface isn't hidden behind whatever pane focus
  // points at.
  const focusPane: LogInkVisiblePane = input.sidebarFocused
    ? 'sidebar'
    : input.inspectorFocused
      ? 'inspector'
      : 'main'
  const visiblePane: LogInkVisiblePane = singlePane
    ? input.forcedPane ?? focusPane
    : focusPane

  // Inspector width — at rest 20-32 cells (~22% of width), focused
  // 36-60 cells (~40% of width). Narrow rest state keeps the commit
  // graph dominant; focus expansion gives the inspector room for long
  // commit bodies / file lists / action labels. Mirrors the sidebar
  // pattern (sidebarFocused above): instant transition per render.
  //
  // Help overlay overrides both — it borrows ~50% of the terminal so
  // hotkey descriptions render in full instead of truncating to
  // "Move focus...". Capped at 100 cells so a wide terminal doesn't
  // waste an absurd amount of horizontal space on the cheat sheet.
  //
  // (In single-pane mode these three-panel widths are recomputed below
  // so the visible pane gets the full terminal.)
  const detailWidth = input.helpOverlayActive
    ? Math.max(60, Math.min(100, Math.floor(columns * 0.50)))
    : input.inspectorFocused
      ? Math.max(36, Math.min(60, Math.floor(columns * 0.40)))
      : Math.max(20, Math.min(32, Math.floor(columns * 0.22)))
  // Sidebar at rest is tier-aware (see `SIDEBAR_AT_REST_BY_TIER`):
  // tight stays compact (22-28), normal shrinks slightly (22-30),
  // wide grows naturally (28-48) so the side panel doesn't get pinned
  // at an arbitrary cap on big terminals while the main panel hogs
  // 80% of the width. Focused: 32-50 cells (~36% of width),
  // regardless of tier — deliberate user intent to read the sidebar
  // deserves the extra width.
  const sidebarWidth = input.sidebarFocused
    ? Math.max(32, Math.min(50, Math.floor(columns * 0.36)))
    : calcSidebarAtRestWidth(columns, density)

  // Single-pane mode: exactly one pane renders, full-width; the other
  // two are hidden (width 0), not railed. Above the breakpoint the
  // three panels tile flush across the terminal.
  const paneWidths = singlePane
    ? {
        sidebarWidth: visiblePane === 'sidebar' ? columns : 0,
        mainPanelWidth: visiblePane === 'main' ? columns : 0,
        detailWidth: visiblePane === 'inspector' ? columns : 0,
      }
    : {
        sidebarWidth,
        mainPanelWidth: Math.max(20, columns - sidebarWidth - detailWidth),
        detailWidth,
      }

  return {
    bodyRows: Math.max(8, rows - 5),
    columns,
    rows,
    tooSmall: columns < LOG_INK_MIN_COLUMNS || rows < LOG_INK_MIN_ROWS,
    inspectorTabbed: rows < INSPECTOR_TABBED_BELOW_ROWS,
    density,
    singlePane,
    visiblePane,
    historyRowMode: density === 'rail' ? 'stacked' : 'single',
    ...paneWidths,
  }
}
