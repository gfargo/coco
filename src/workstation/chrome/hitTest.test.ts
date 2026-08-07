import { getLogInkLayout } from './layout'
import { HEADER_ROWS, PANE_CHROME_ROWS, hitTestPane } from './hitTest'

describe('hitTestPane', () => {
  it('returns null for clicks in the header rows', () => {
    const layout = getLogInkLayout({ columns: 160, rows: 40 })
    for (let y = 0; y < HEADER_ROWS; y++) {
      expect(hitTestPane(layout, 5, y)).toBeNull()
    }
  })

  it('returns null for clicks in the footer rows', () => {
    const layout = getLogInkLayout({ columns: 160, rows: 40 })
    const footerY = HEADER_ROWS + layout.bodyRows
    expect(hitTestPane(layout, 5, footerY)).toBeNull()
  })

  it('returns null for negative x', () => {
    const layout = getLogInkLayout({ columns: 160, rows: 40 })
    expect(hitTestPane(layout, -1, HEADER_ROWS)).toBeNull()
  })

  it('resolves a click in the sidebar column range to the sidebar pane', () => {
    const layout = getLogInkLayout({ columns: 160, rows: 40 })
    const hit = hitTestPane(layout, 1, HEADER_ROWS + PANE_CHROME_ROWS)
    expect(hit).toEqual({ pane: 'sidebar', paneRow: 0, paneColumn: 1 })
  })

  it('resolves a click just past the sidebar to the main pane, column-relative', () => {
    const layout = getLogInkLayout({ columns: 160, rows: 40 })
    const x = layout.sidebarWidth + 3
    const hit = hitTestPane(layout, x, HEADER_ROWS + PANE_CHROME_ROWS + 4)
    expect(hit).toEqual({ pane: 'main', paneRow: 4, paneColumn: 3 })
  })

  it('resolves a click in the rightmost columns to the inspector pane', () => {
    const layout = getLogInkLayout({ columns: 160, rows: 40 })
    const x = layout.columns - 1
    const hit = hitTestPane(layout, x, HEADER_ROWS + PANE_CHROME_ROWS)
    expect(hit?.pane).toBe('inspector')
  })

  it('reports a negative paneRow for clicks on a pane border/title row (still pane-focusable)', () => {
    const layout = getLogInkLayout({ columns: 160, rows: 40 })
    const hit = hitTestPane(layout, 1, HEADER_ROWS)
    expect(hit).toEqual({ pane: 'sidebar', paneRow: -PANE_CHROME_ROWS, paneColumn: 1 })
  })

  describe('single-pane mode (narrow terminals)', () => {
    it('routes every in-bounds click to the single visible pane', () => {
      const layout = getLogInkLayout({ columns: 80, rows: 30 })
      expect(layout.singlePane).toBe(true)
      const hit = hitTestPane(layout, 10, HEADER_ROWS + PANE_CHROME_ROWS)
      expect(hit?.pane).toBe(layout.visiblePane)
    })

    it('returns null for a click past the terminal width', () => {
      const layout = getLogInkLayout({ columns: 80, rows: 30 })
      expect(hitTestPane(layout, layout.columns, HEADER_ROWS)).toBeNull()
    })
  })

  it('returns null when a pane is budget-starved to zero width', () => {
    // Sidebar loses its budget entirely when the inspector is focused on a
    // narrow (but still three-pane) terminal — see allocateThreePaneWidths.
    const layout = getLogInkLayout({ columns: 100, rows: 30, inspectorFocused: true })
    expect(layout.singlePane).toBe(false)
    if (layout.sidebarWidth === 0) {
      expect(hitTestPane(layout, 0, HEADER_ROWS + PANE_CHROME_ROWS)?.pane).not.toBe('sidebar')
    }
  })
})
