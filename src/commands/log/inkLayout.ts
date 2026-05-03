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
}

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

export function getLogInkLayout(input: LogInkLayoutInput): LogInkLayout {
  const columns = input.columns || LOG_INK_DEFAULT_COLUMNS
  const rows = input.rows || LOG_INK_DEFAULT_ROWS
  // Inspector width — at rest 20-32 cells (~22% of width), focused
  // 36-60 cells (~40% of width). Narrow rest state keeps the commit
  // graph dominant; focus expansion gives the inspector room for long
  // commit bodies / file lists / action labels. Mirrors the sidebar
  // pattern (sidebarFocused above): instant transition per render.
  const detailWidth = input.inspectorFocused
    ? Math.max(36, Math.min(60, Math.floor(columns * 0.40)))
    : Math.max(20, Math.min(32, Math.floor(columns * 0.22)))
  // Sidebar at rest: 22-34 cells (~24% of width). Focused: 32-50 cells
  // (~36% of width). The transition is instant per render — focus tab to
  // expand, focus away to collapse.
  const sidebarWidth = input.sidebarFocused
    ? Math.max(32, Math.min(50, Math.floor(columns * 0.36)))
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
  }
}
