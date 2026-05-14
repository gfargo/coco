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
}

/**
 * Responsive tier for the whole UI, derived from terminal width. Higher
 * tiers progressively drop and reformat row segments to keep narrow
 * terminals readable:
 *
 *   - wide   (>= 160 cols) — absolute `YYYY-MM-DD` dates, full chrome
 *   - normal (120–159)     — compact relative dates (`2d`, `3w`)
 *   - tight  (100–119)     — date column dropped entirely
 *   - rail   (< 100)       — history rows stack on two lines; sidebar
 *     and inspector collapse to a thin icon rail when not focused
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
   * the history surface; also drives panel rail collapse below.
   */
  density: LogInkLayoutDensity
  /**
   * True when the sidebar should render as a thin icon rail (tab
   * glyph + count, no expanded tab content). Held to `density === 'rail'
   * && !sidebarFocused` so focusing the sidebar always pops it back
   * to its normal expanded form — same affordance as the existing
   * focus-grow pattern, just starting from a much smaller resting
   * state on narrow terminals.
   */
  sidebarRailed: boolean
  /**
   * True when the inspector should render as a thin rail (selected
   * shortHash + a focus hint, no commit body / file list / actions).
   * Same focus-rescue contract as `sidebarRailed`.
   */
  inspectorRailed: boolean
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
 *   rail   <  100 — even with side panels collapsed the row is tight;
 *                   stack to two lines and rail the side panels at rest
 */
export const LAYOUT_TIGHT_BELOW = 120
export const LAYOUT_NORMAL_BELOW = 160
export const LAYOUT_RAIL_BELOW = 100

/**
 * Fixed cell width for a railed side panel. Just wide enough for a
 * 1-cell icon + a 2-3 digit count after subtracting border (2) and
 * padding (2). Going narrower clips the count; going wider defeats
 * the purpose of railing in the first place.
 */
export const LAYOUT_RAIL_PANEL_WIDTH = 8

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

  // Rail collapse: only happens at the narrowest tier, and only for
  // the panel that does NOT currently hold focus AND is not being
  // commandeered by the help overlay. Focus always wins — pressing
  // tab to the sidebar pops it back open even on an 80-cell terminal
  // so the user can actually use it. The help overlay also wins for
  // the inspector since that's where its descriptions render.
  const sidebarRailed = density === 'rail' && !input.sidebarFocused
  const inspectorRailed =
    density === 'rail' && !input.inspectorFocused && !input.helpOverlayActive

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
  // Rail collapse wins over the at-rest range but loses to focus and
  // to the help overlay — both of those represent deliberate user
  // intent to read the panel.
  const detailWidth = input.helpOverlayActive
    ? Math.max(60, Math.min(100, Math.floor(columns * 0.50)))
    : input.inspectorFocused
      ? Math.max(36, Math.min(60, Math.floor(columns * 0.40)))
      : inspectorRailed
        ? LAYOUT_RAIL_PANEL_WIDTH
        : Math.max(20, Math.min(32, Math.floor(columns * 0.22)))
  // Sidebar at rest: 22-34 cells (~24% of width). Focused: 32-50 cells
  // (~36% of width). The transition is instant per render — focus tab to
  // expand, focus away to collapse. Rail mode (narrow terminal,
  // unfocused) shrinks to a fixed 8-cell strip with tab glyphs only.
  const sidebarWidth = input.sidebarFocused
    ? Math.max(32, Math.min(50, Math.floor(columns * 0.36)))
    : sidebarRailed
      ? LAYOUT_RAIL_PANEL_WIDTH
      : Math.max(22, Math.min(34, Math.floor(columns * 0.24)))

  return {
    bodyRows: Math.max(8, rows - 5),
    columns,
    detailWidth,
    mainPanelWidth: Math.max(20, columns - sidebarWidth - detailWidth),
    rows,
    sidebarWidth,
    tooSmall: columns < LOG_INK_MIN_COLUMNS || rows < LOG_INK_MIN_ROWS,
    inspectorTabbed: rows < INSPECTOR_TABBED_BELOW_ROWS,
    density,
    sidebarRailed,
    inspectorRailed,
    historyRowMode: density === 'rail' ? 'stacked' : 'single',
  }
}
