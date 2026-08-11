/**
 * Mouse hit-testing (OSS-1608, `logTui.mouse`): maps a terminal (x, y)
 * click/wheel coordinate to which of the three panes it landed in, using
 * the same pane rectangles `getLogInkLayout` already computes for
 * rendering — see `layout.ts`. `layout.ts` returns pane *widths*, not
 * x-origins, so the origins here are the cumulative sum: sidebar starts at
 * 0, main starts at `sidebarWidth`, inspector starts at
 * `sidebarWidth + mainPanelWidth`.
 */

import type { LogInkLayout, LogInkVisiblePane } from './layout'

/**
 * Rows consumed by the global chrome (the header box, see
 * `runtime/header.ts`) before the three-pane body starts.
 */
export const HEADER_ROWS = 3

/**
 * Rows consumed by a pane's own top border + title line before its list
 * content starts, common to every pane's bordered `Box`. This is an
 * approximation shared by every surface: some (e.g. the history panel with
 * its upstream-ahead banner or the search-fetch indicator) push their list
 * content down by 1-2 more rows that aren't accounted for here. A click
 * that lands past a shorter list's last real row should no-op rather than
 * mis-select — callers own that bounds check using the row count they
 * already have for the active surface.
 */
export const PANE_CHROME_ROWS = 2

export type MousePaneHit = {
  pane: LogInkVisiblePane
  /**
   * 0-based row within the pane's content area (i.e. already offset past
   * `HEADER_ROWS` + `PANE_CHROME_ROWS`). Negative when the click landed on
   * the pane's own border/title rows — still a valid pane-focus target,
   * just not a selectable list row.
   */
  paneRow: number
  /** 0-based column within the pane. */
  paneColumn: number
}

/**
 * Resolves a terminal (x, y) to a pane hit, or `null` when the coordinate
 * falls outside the three-pane body (header, footer, or — in three-pane
 * mode — a zero-width pane that budget starved to nothing).
 */
export function hitTestPane(layout: LogInkLayout, x: number, y: number): MousePaneHit | null {
  const bodyY = y - HEADER_ROWS
  if (x < 0 || bodyY < 0 || bodyY >= layout.bodyRows) {
    return null
  }

  const paneRow = bodyY - PANE_CHROME_ROWS

  if (layout.singlePane) {
    if (x >= layout.columns) {
      return null
    }
    return { pane: layout.visiblePane, paneRow, paneColumn: x }
  }

  if (x < layout.sidebarWidth) {
    return { pane: 'sidebar', paneRow, paneColumn: x }
  }

  const mainStart = layout.sidebarWidth
  if (x < mainStart + layout.mainPanelWidth) {
    return { pane: 'main', paneRow, paneColumn: x - mainStart }
  }

  const detailStart = mainStart + layout.mainPanelWidth
  if (x < detailStart + layout.detailWidth) {
    return { pane: 'inspector', paneRow, paneColumn: x - detailStart }
  }

  return null
}
