import type { CommitLayoutRow } from './graphLayout'
import {
  renderCommitRowSegments,
  renderTransitionRowSegments,
  rowCellWidth,
} from './graphOrtho'

/** Build a CommitLayoutRow with sensible defaults for the fields a test
 *  doesn't care about. */
function rowOf(partial: Partial<CommitLayoutRow> & { width: number }): CommitLayoutRow {
  return {
    hash: 'h',
    column: 0,
    laneId: 0,
    passthrough: [],
    edges: [],
    isMerge: false,
    isRoot: false,
    ...partial,
  }
}

/** Flatten segments back to the rendered string for offset assertions. */
function text(segments: { text: string }[]): string {
  return segments.map((s) => s.text).join('')
}

describe('renderCommitRowSegments', () => {
  it('renders a lone commit as its glyph', () => {
    expect(renderCommitRowSegments(rowOf({ width: 1 }))).toEqual([{ text: '●', laneId: 0 }])
  })

  it('honors the supplied commit glyph (merge / HEAD)', () => {
    expect(renderCommitRowSegments(rowOf({ width: 1 }), '◆')).toEqual([{ text: '◆', laneId: 0 }])
    expect(renderCommitRowSegments(rowOf({ width: 1 }), '◉')).toEqual([{ text: '◉', laneId: 0 }])
  })

  it('draws pass-through lanes as bars beside the commit', () => {
    // Commit on lane 1 / column 1; lane 0 passes through on the left.
    const segments = renderCommitRowSegments(
      rowOf({ column: 1, laneId: 1, passthrough: [{ laneId: 0, column: 0 }], width: 2 })
    )
    expect(segments).toEqual([
      { text: '│', laneId: 0 },
      { text: ' ', laneId: undefined },
      { text: '●', laneId: 1 },
    ])
    // Commit dot sits at the column's node offset (2 * column).
    expect(text(segments).indexOf('●')).toBe(2)
  })
})

describe('renderTransitionRowSegments', () => {
  it('renders a straight lane as a vertical bar', () => {
    const segments = renderTransitionRowSegments(
      rowOf({ width: 1, edges: [{ laneId: 0, from: 0, to: 0 }] })
    )
    expect(segments).toEqual([{ text: '│', laneId: 0 }])
  })

  it('routes a fork as ├─╮ with the branch keeping its own color', () => {
    // Trunk continues at col 0; a new lane diverges right to col 1.
    const segments = renderTransitionRowSegments(
      rowOf({
        width: 2,
        edges: [
          { laneId: 0, from: 0, to: 0 },
          { laneId: 1, from: 0, to: 1 },
        ],
      })
    )
    expect(text(segments)).toBe('├─╮')
    expect(segments).toEqual([
      { text: '├', laneId: 0 }, // junction reads as trunk
      { text: '─╮', laneId: 1 }, // the branch's horizontal + corner
    ])
  })

  it('routes a converge as ├─╯ with the corner under the source column', () => {
    // Trunk at col 0; a branch on col 1 converges left into col 0.
    const segments = renderTransitionRowSegments(
      rowOf({
        width: 2,
        edges: [
          { laneId: 0, from: 0, to: 0 },
          { laneId: 1, from: 1, to: 0 },
        ],
      })
    )
    expect(text(segments)).toBe('├─╯')
    // The ╯ sits exactly under the converging commit's column (col 1 →
    // offset 2), so the line meets the commit at the cell edge.
    expect(text(segments).indexOf('╯')).toBe(2)
    expect(segments).toEqual([
      { text: '├', laneId: 0 },
      { text: '─╯', laneId: 1 },
    ])
  })

  it('routes an octopus fork as a multi-pronged ├─┬─╮', () => {
    const segments = renderTransitionRowSegments(
      rowOf({
        width: 3,
        edges: [
          { laneId: 0, from: 0, to: 0 },
          { laneId: 1, from: 0, to: 1 },
          { laneId: 2, from: 0, to: 2 },
        ],
      })
    )
    expect(text(segments)).toBe('├─┬─╮')
  })

  it('crosses a passing lane with ┼', () => {
    // Lane 5 passes straight through col 1 while lane 9 converges from
    // col 2 to col 0 — the horizontal must cross the vertical as ┼.
    const segments = renderTransitionRowSegments(
      rowOf({
        width: 3,
        edges: [
          { laneId: 0, from: 0, to: 0 },
          { laneId: 5, from: 1, to: 1 },
          { laneId: 9, from: 2, to: 0 },
        ],
      })
    )
    const rendered = text(segments)
    expect(rendered).toBe('├─┼─╯')
    // The crossing sits at the passing lane's column (col 1 → offset 2)
    // and keeps that lane's color.
    expect(rendered.indexOf('┼')).toBe(2)
    const crossSegment = segments.find((s) => s.text.includes('┼'))
    expect(crossSegment?.laneId).toBe(5)
  })
})

describe('rowCellWidth', () => {
  it('is two cells per column minus the trailing connector', () => {
    expect(rowCellWidth(rowOf({ width: 1 }))).toBe(1)
    expect(rowCellWidth(rowOf({ width: 2 }))).toBe(3)
    expect(rowCellWidth(rowOf({ width: 4 }))).toBe(7)
  })
})
