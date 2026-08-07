import { clampListWindowStart, getLogInkLayout } from '../chrome/layout'
import { HEADER_ROWS, PANE_CHROME_ROWS } from '../chrome/hitTest'
import { parseSgrMouse, resolveMouseDispatch, type MouseDispatchState } from './mouseInput'

const baseDispatchState: MouseDispatchState = {
  focus: 'sidebar',
  diffSource: undefined,
  selectedIndex: 0,
  filteredCommitCount: 100,
  stashDiffLineCount: undefined,
  prDiffLineCount: undefined,
  filePreviewHunkCount: undefined,
}

describe('parseSgrMouse', () => {
  it('parses a left-click press', () => {
    expect(parseSgrMouse('\x1b[<0;10;5M')).toEqual({
      button: 'left',
      kind: 'press',
      x: 9,
      y: 4,
      shift: false,
      alt: false,
      ctrl: false,
    })
  })

  it('parses a left-click release', () => {
    expect(parseSgrMouse('\x1b[<0;10;5m')).toEqual({
      button: 'left',
      kind: 'release',
      x: 9,
      y: 4,
      shift: false,
      alt: false,
      ctrl: false,
    })
  })

  it('parses the sequence with the leading escape already stripped (Ink delivery shape)', () => {
    expect(parseSgrMouse('[<0;10;5M')).toEqual({
      button: 'left',
      kind: 'press',
      x: 9,
      y: 4,
      shift: false,
      alt: false,
      ctrl: false,
    })
  })

  it('parses middle and right buttons', () => {
    expect(parseSgrMouse('[<1;1;1M')?.button).toBe('middle')
    expect(parseSgrMouse('[<2;1;1M')?.button).toBe('right')
  })

  it('parses wheel-up and wheel-down (button codes 64/65)', () => {
    expect(parseSgrMouse('[<64;20;10M')).toMatchObject({ button: 'wheel-up', kind: 'press' })
    expect(parseSgrMouse('[<65;20;10M')).toMatchObject({ button: 'wheel-down', kind: 'press' })
  })

  it('decodes shift/alt/ctrl modifier bits', () => {
    // 0 (left) | 4 (shift) | 8 (alt) | 16 (ctrl) = 28
    expect(parseSgrMouse('[<28;1;1M')).toMatchObject({ shift: true, alt: true, ctrl: true })
  })

  it('returns null for a plain keystroke', () => {
    expect(parseSgrMouse('a')).toBeNull()
    expect(parseSgrMouse('\r')).toBeNull()
  })

  it('returns null for an incomplete/malformed sequence', () => {
    expect(parseSgrMouse('[<0;10;')).toBeNull()
    expect(parseSgrMouse('[<;;M')).toBeNull()
    expect(parseSgrMouse('')).toBeNull()
  })

  it('returns null for a non-mouse CSI sequence (e.g. an arrow key)', () => {
    expect(parseSgrMouse('[A')).toBeNull()
  })

  it('returns null for out-of-range (0-based-underflow) coordinates', () => {
    expect(parseSgrMouse('[<0;0;0M')).toBeNull()
  })
})

describe('resolveMouseDispatch', () => {
  it('returns [] for a release event (only press is acted on)', () => {
    const layout = getLogInkLayout({ columns: 160, rows: 40 })
    const event = parseSgrMouse('[<0;10;5m')!
    expect(resolveMouseDispatch(event, layout, baseDispatchState)).toEqual([])
  })

  it('returns [] when the coordinate falls outside every pane (header row)', () => {
    const layout = getLogInkLayout({ columns: 160, rows: 40 })
    const event = parseSgrMouse('[<0;5;1M')!
    expect(resolveMouseDispatch(event, layout, baseDispatchState)).toEqual([])
  })

  it('focuses the clicked pane when it differs from the current focus', () => {
    const layout = getLogInkLayout({ columns: 160, rows: 40 })
    const y = HEADER_ROWS + PANE_CHROME_ROWS
    const event = parseSgrMouse(`[<0;2;${y + 1}M`)!
    const actions = resolveMouseDispatch(event, layout, { ...baseDispatchState, focus: 'commits' })
    expect(actions).toEqual([{ type: 'setFocus', value: 'sidebar' }])
  })

  it('does not dispatch setFocus when already focused on the clicked pane', () => {
    const layout = getLogInkLayout({ columns: 160, rows: 40 })
    const y = HEADER_ROWS + PANE_CHROME_ROWS
    const event = parseSgrMouse(`[<0;2;${y + 1}M`)!
    const actions = resolveMouseDispatch(event, layout, { ...baseDispatchState, focus: 'sidebar' })
    expect(actions).toEqual([])
  })

  it('a left click on a commits-pane row focuses commits and selects the row, offset by the scrolled window', () => {
    const layout = getLogInkLayout({ columns: 160, rows: 40 })
    const x = layout.sidebarWidth + 3
    const rowOffset = 4
    const y = HEADER_ROWS + PANE_CHROME_ROWS + rowOffset
    const event = parseSgrMouse(`[<0;${x + 1};${y + 1}M`)!
    const selectedIndex = 40
    const filteredCommitCount = 100
    const actions = resolveMouseDispatch(event, layout, {
      ...baseDispatchState,
      focus: 'sidebar',
      selectedIndex,
      filteredCommitCount,
    })
    const contentRows = Math.max(1, layout.bodyRows - PANE_CHROME_ROWS)
    const windowStart = clampListWindowStart(selectedIndex, filteredCommitCount, contentRows)
    expect(actions).toEqual([
      { type: 'setFocus', value: 'commits' },
      { type: 'setSelectedIndex', value: windowStart + rowOffset },
    ])
  })

  it('a left click on a commits-pane border row focuses the pane but does not select', () => {
    const layout = getLogInkLayout({ columns: 160, rows: 40 })
    const x = layout.sidebarWidth + 3
    const y = HEADER_ROWS
    const event = parseSgrMouse(`[<0;${x + 1};${y + 1}M`)!
    const actions = resolveMouseDispatch(event, layout, { ...baseDispatchState, focus: 'sidebar' })
    expect(actions).toEqual([{ type: 'setFocus', value: 'commits' }])
  })

  it('a left click on the inspector pane focuses it without selecting a commit', () => {
    const layout = getLogInkLayout({ columns: 160, rows: 40 })
    const x = layout.sidebarWidth + layout.mainPanelWidth + 1
    const y = HEADER_ROWS + PANE_CHROME_ROWS
    const event = parseSgrMouse(`[<0;${x + 1};${y + 1}M`)!
    const actions = resolveMouseDispatch(event, layout, { ...baseDispatchState, focus: 'sidebar' })
    expect(actions).toEqual([{ type: 'setFocus', value: 'detail' }])
  })

  it('wheel-down over the commits pane moves the cursor forward', () => {
    const layout = getLogInkLayout({ columns: 160, rows: 40 })
    const x = layout.sidebarWidth + 3
    const y = HEADER_ROWS + PANE_CHROME_ROWS
    const event = parseSgrMouse(`[<65;${x + 1};${y + 1}M`)!
    const actions = resolveMouseDispatch(event, layout, { ...baseDispatchState, focus: 'commits' })
    expect(actions).toEqual([{ type: 'move', delta: 1 }])
  })

  it('wheel-up over the commits pane moves the cursor backward', () => {
    const layout = getLogInkLayout({ columns: 160, rows: 40 })
    const x = layout.sidebarWidth + 3
    const y = HEADER_ROWS + PANE_CHROME_ROWS
    const event = parseSgrMouse(`[<64;${x + 1};${y + 1}M`)!
    const actions = resolveMouseDispatch(event, layout, { ...baseDispatchState, focus: 'commits' })
    expect(actions).toEqual([{ type: 'move', delta: -1 }])
  })

  it('wheel over the inspector pane pages the commit diff preview by hunk count', () => {
    const layout = getLogInkLayout({ columns: 160, rows: 40 })
    const x = layout.sidebarWidth + layout.mainPanelWidth + 1
    const y = HEADER_ROWS + PANE_CHROME_ROWS
    const event = parseSgrMouse(`[<65;${x + 1};${y + 1}M`)!
    const actions = resolveMouseDispatch(event, layout, {
      ...baseDispatchState,
      focus: 'detail',
      diffSource: 'commit',
      filePreviewHunkCount: 20,
    })
    expect(actions).toEqual([{ type: 'pageDetailPreview', delta: 1, previewLineCount: 20 }])
  })

  it('wheel over the inspector pane uses the stash diff line count when diffSource is stash', () => {
    const layout = getLogInkLayout({ columns: 160, rows: 40 })
    const x = layout.sidebarWidth + layout.mainPanelWidth + 1
    const y = HEADER_ROWS + PANE_CHROME_ROWS
    const event = parseSgrMouse(`[<65;${x + 1};${y + 1}M`)!
    const actions = resolveMouseDispatch(event, layout, {
      ...baseDispatchState,
      focus: 'detail',
      diffSource: 'stash',
      stashDiffLineCount: 15,
      filePreviewHunkCount: 20,
    })
    expect(actions).toEqual([{ type: 'pageDetailPreview', delta: 1, previewLineCount: 15 }])
  })

  it('wheel over the inspector pane uses the PR diff line count when diffSource is pr', () => {
    const layout = getLogInkLayout({ columns: 160, rows: 40 })
    const x = layout.sidebarWidth + layout.mainPanelWidth + 1
    const y = HEADER_ROWS + PANE_CHROME_ROWS
    const event = parseSgrMouse(`[<65;${x + 1};${y + 1}M`)!
    const actions = resolveMouseDispatch(event, layout, {
      ...baseDispatchState,
      focus: 'detail',
      diffSource: 'pr',
      prDiffLineCount: 12,
      filePreviewHunkCount: 20,
    })
    expect(actions).toEqual([{ type: 'pageDetailPreview', delta: 1, previewLineCount: 12 }])
  })

  it('wheel over the inspector pane no-ops when no preview content is loaded', () => {
    const layout = getLogInkLayout({ columns: 160, rows: 40 })
    const x = layout.sidebarWidth + layout.mainPanelWidth + 1
    const y = HEADER_ROWS + PANE_CHROME_ROWS
    const event = parseSgrMouse(`[<65;${x + 1};${y + 1}M`)!
    const actions = resolveMouseDispatch(event, layout, { ...baseDispatchState, focus: 'detail' })
    expect(actions).toEqual([])
  })

  it('wheel over the sidebar pane only focuses it (no scroll action in scope)', () => {
    const layout = getLogInkLayout({ columns: 160, rows: 40 })
    const y = HEADER_ROWS + PANE_CHROME_ROWS
    const event = parseSgrMouse(`[<65;2;${y + 1}M`)!
    const actions = resolveMouseDispatch(event, layout, { ...baseDispatchState, focus: 'commits' })
    expect(actions).toEqual([{ type: 'setFocus', value: 'sidebar' }])
  })
})
