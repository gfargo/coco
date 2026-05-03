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
}

export const LOG_INK_MIN_COLUMNS = 80
export const LOG_INK_MIN_ROWS = 24
export const LOG_INK_DEFAULT_COLUMNS = 120
export const LOG_INK_DEFAULT_ROWS = 40

export function getLogInkLayout(input: LogInkLayoutInput): LogInkLayout {
  const columns = input.columns || LOG_INK_DEFAULT_COLUMNS
  const rows = input.rows || LOG_INK_DEFAULT_ROWS
  // Inspector width — 26-44 cells (~28% of width). Narrowed from the
  // earlier 30-56 range when the inspector dropped its duplicative
  // workflows trailer (repo / branch / status — all already visible in
  // the top header and left sidebar). The reclaimed columns go to the
  // commit graph in the main panel.
  const detailWidth = Math.max(26, Math.min(44, Math.floor(columns * 0.28)))
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
  }
}
