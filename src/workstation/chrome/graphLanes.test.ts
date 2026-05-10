import {
  advanceTrackerThrough,
  createLaneTrackerState,
  getLaneColor,
  getLanePalette,
  renderGraphRowSegments,
} from './graphLanes'
import { createLogInkTheme } from './theme'

describe('renderGraphRowSegments', () => {
  it('returns a single lane-less segment when ascii is true', () => {
    const tracker = createLaneTrackerState()
    expect(renderGraphRowSegments('|\\', tracker, { ascii: true })).toEqual([
      { text: '|\\', laneId: undefined },
    ])
    // Tracker should not advance under ascii — legacy terminals get
    // raw output and we never paint lane colors over it.
    expect(tracker.columnLanes.size).toBe(0)
    expect(tracker.nextLaneId).toBe(0)
  })

  it('assigns a single lane id to a vertical-only row', () => {
    const tracker = createLaneTrackerState()
    const segments = renderGraphRowSegments('|', tracker, { ascii: false })

    expect(segments).toEqual([{ text: '│', laneId: 0 }])
    expect(tracker.columnLanes.get(0)).toBe(0)
  })

  it('keeps the same lane id across consecutive rows in the same column', () => {
    const tracker = createLaneTrackerState()
    renderGraphRowSegments('*', tracker, { ascii: false })
    const second = renderGraphRowSegments('|', tracker, { ascii: false })

    expect(second).toEqual([{ text: '│', laneId: 0 }])
  })

  it('forks a new lane id on the |\\ pattern', () => {
    const tracker = createLaneTrackerState()
    renderGraphRowSegments('*', tracker, { ascii: false })
    const fork = renderGraphRowSegments('|\\', tracker, { ascii: false })

    // Two segments: ├ on lane 0 (the trunk continuing) and ╮ on lane 1
    // (the freshly-spawned branch). The renderer paints them in
    // different palette colors so the fork is immediately legible.
    expect(fork).toEqual([
      { text: '├', laneId: 0 },
      { text: '╮', laneId: 1 },
    ])
    expect(tracker.columnLanes.get(0)).toBe(0)
    expect(tracker.columnLanes.get(1)).toBe(1)
  })

  it('inherits the new lane id on the row below the fork', () => {
    const tracker = createLaneTrackerState()
    renderGraphRowSegments('*', tracker, { ascii: false })
    renderGraphRowSegments('|\\', tracker, { ascii: false })
    const next = renderGraphRowSegments('| *', tracker, { ascii: false })

    expect(next).toEqual([
      { text: '│', laneId: 0 },
      { text: ' ', laneId: undefined },
      { text: '●', laneId: 1 },
    ])
  })

  it('absorbs the side lane id on the |/ pattern and removes it next row', () => {
    const tracker = createLaneTrackerState()
    renderGraphRowSegments('*', tracker, { ascii: false })
    renderGraphRowSegments('|\\', tracker, { ascii: false })
    renderGraphRowSegments('| *', tracker, { ascii: false })
    const converge = renderGraphRowSegments('|/', tracker, { ascii: false })

    // The ╯ keeps the absorbed lane's color so the side branch's tail
    // visually terminates on its own color before merging into the
    // trunk.
    expect(converge).toEqual([
      { text: '├', laneId: 0 },
      { text: '╯', laneId: 1 },
    ])
    expect(tracker.columnLanes.has(1)).toBe(false)

    const after = renderGraphRowSegments('*', tracker, { ascii: false })
    expect(after).toEqual([{ text: '●', laneId: 0 }])
  })

  it('groups runs of same-lane chars into one segment', () => {
    const tracker = createLaneTrackerState()
    // `* | |` — three columns, three different lane ids, intermixed
    // with spaces. Spaces collapse into their own undefined-lane
    // segment between lane segments.
    const segments = renderGraphRowSegments('* | |', tracker, { ascii: false })

    expect(segments).toEqual([
      { text: '●', laneId: 0 },
      { text: ' ', laneId: undefined },
      { text: '│', laneId: 1 },
      { text: ' ', laneId: undefined },
      { text: '│', laneId: 2 },
    ])
  })

  it('honors the configured commit glyph in fork / converge patterns', () => {
    // Stage 3 will pass ◆ for merges; verify the segment builder threads
    // it through both standalone commits and the diagonal-followed
    // commit row variants.
    const tracker = createLaneTrackerState()
    expect(renderGraphRowSegments('*', tracker, { ascii: false, commitGlyph: '◆' }))
      .toEqual([{ text: '◆', laneId: 0 }])

    const tracker2 = createLaneTrackerState()
    expect(renderGraphRowSegments('*\\', tracker2, { ascii: false, commitGlyph: '◉' }))
      .toEqual([
        { text: '◉', laneId: 0 },
        { text: '╮', laneId: 1 },
      ])
  })

  it('falls back to muted (undefined) lane id for standalone diagonals', () => {
    // A `\` not directly preceded by `|` or `*` is some less common
    // shift git emits — we render it but do not pretend to know which
    // lane owns it, so it stays muted.
    const tracker = createLaneTrackerState()
    const segments = renderGraphRowSegments(' \\', tracker, { ascii: false })

    // Adjacent undefined-lane chars collapse into one segment so the
    // renderer paints the whole muted run with a single Text span.
    expect(segments).toEqual([
      { text: ' ╲', laneId: undefined },
    ])
  })
})

describe('advanceTrackerThrough', () => {
  it('moves tracker state forward without producing render output', () => {
    const tracker = createLaneTrackerState()
    // After `*`, `|\`, `| *` we expect lanes 0 and 1 active.
    advanceTrackerThrough(['*', '|\\', '| *'], tracker, 3)

    expect(tracker.columnLanes.get(0)).toBe(0)
    expect(tracker.columnLanes.get(1)).toBe(1)
    // Resuming from this state for the next row should keep lane ids
    // stable, which is what scrolling needs to preserve coloring.
    const next = renderGraphRowSegments('|/', tracker, { ascii: false })
    expect(next).toEqual([
      { text: '├', laneId: 0 },
      { text: '╯', laneId: 1 },
    ])
  })

  it('clamps count to the number of available rows', () => {
    const tracker = createLaneTrackerState()
    expect(() => advanceTrackerThrough(['*'], tracker, 10)).not.toThrow()
    expect(tracker.columnLanes.get(0)).toBe(0)
  })
})

describe('lane palette helpers', () => {
  it('returns an empty palette when noColor is set', () => {
    const theme = createLogInkTheme({ noColor: true, env: {} })
    expect(getLanePalette(theme)).toEqual([])
    expect(getLaneColor(0, theme)).toBeUndefined()
    expect(getLaneColor(7, theme)).toBeUndefined()
  })

  it('returns the default ANSI palette under the default preset', () => {
    const theme = createLogInkTheme({ preset: 'default', env: {} })
    const palette = getLanePalette(theme)

    expect(palette.length).toBeGreaterThanOrEqual(6)
    // Default uses ANSI named colors so 16-color terminals render them
    // faithfully without needing truecolor support.
    expect(palette[0]).toBe('cyan')
  })

  it('hashes lane ids modulo the palette size for stable color assignment', () => {
    const theme = createLogInkTheme({ preset: 'default', env: {} })
    const palette = getLanePalette(theme)

    expect(getLaneColor(0, theme)).toBe(palette[0])
    expect(getLaneColor(palette.length, theme)).toBe(palette[0])
    expect(getLaneColor(palette.length + 1, theme)).toBe(palette[1])
  })

  it('returns hex palette for catppuccin and gruvbox under truecolor', () => {
    const truecolor = { COLORTERM: 'truecolor' }
    const catppuccin = createLogInkTheme({ preset: 'catppuccin', env: truecolor })
    expect(getLanePalette(catppuccin)[0]).toBe('#89b4fa')

    const gruvbox = createLogInkTheme({ preset: 'gruvbox', env: truecolor })
    expect(getLanePalette(gruvbox)[0]).toBe('#83a598')
  })

  it('returns undefined lane color for undefined lane id', () => {
    const theme = createLogInkTheme({ preset: 'default', env: {} })
    expect(getLaneColor(undefined, theme)).toBeUndefined()
  })
})
