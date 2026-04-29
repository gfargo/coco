export type LogInkLayoutInput = {
  columns: number
  rows: number
}

export type LogInkLayout = {
  bodyRows: number
  columns: number
  detailWidth: number
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

  return {
    bodyRows: Math.max(8, rows - 5),
    columns,
    detailWidth: Math.max(30, Math.min(56, Math.floor(columns * 0.34))),
    rows,
    sidebarWidth: Math.max(22, Math.min(34, Math.floor(columns * 0.24))),
    tooSmall: columns < LOG_INK_MIN_COLUMNS || rows < LOG_INK_MIN_ROWS,
  }
}
