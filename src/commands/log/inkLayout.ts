export type LogInkLayoutInput = {
  columns: number
  rows: number
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
  const detailWidth = Math.max(30, Math.min(56, Math.floor(columns * 0.34)))
  const sidebarWidth = Math.max(22, Math.min(34, Math.floor(columns * 0.24)))

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
