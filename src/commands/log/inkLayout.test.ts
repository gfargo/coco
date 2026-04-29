import {
  LOG_INK_MIN_COLUMNS,
  LOG_INK_MIN_ROWS,
  getLogInkLayout,
} from './inkLayout'

describe('log Ink layout', () => {
  it('accepts the minimum supported terminal size', () => {
    const layout = getLogInkLayout({
      columns: LOG_INK_MIN_COLUMNS,
      rows: LOG_INK_MIN_ROWS,
    })

    expect(layout.tooSmall).toBe(false)
    expect(layout.bodyRows).toBe(19)
    expect(layout.sidebarWidth).toBe(22)
    expect(layout.detailWidth).toBe(30)
  })

  it('uses a balanced layout at the default terminal size', () => {
    const layout = getLogInkLayout({ columns: 120, rows: 40 })

    expect(layout.tooSmall).toBe(false)
    expect(layout.bodyRows).toBe(35)
    expect(layout.sidebarWidth).toBe(28)
    expect(layout.detailWidth).toBe(40)
  })

  it('caps side panel widths on wide terminals', () => {
    const layout = getLogInkLayout({ columns: 200, rows: 60 })

    expect(layout.tooSmall).toBe(false)
    expect(layout.bodyRows).toBe(55)
    expect(layout.sidebarWidth).toBe(34)
    expect(layout.detailWidth).toBe(56)
  })

  it('reports terminals below the minimum as too small', () => {
    expect(getLogInkLayout({ columns: 79, rows: 24 }).tooSmall).toBe(true)
    expect(getLogInkLayout({ columns: 80, rows: 23 }).tooSmall).toBe(true)
  })
})
