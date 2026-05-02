import { GitLogRow } from './data'
import {
  formatInkHistoryGraphRow,
  formatInkRefLabels,
  getVisibleLogInkHistory,
} from './inkHistoryRows'
import { applyLogInkAction, createLogInkState } from './inkViewModel'

const rows: GitLogRow[] = [
  {
    type: 'commit',
    graph: '*   ',
    shortHash: 'aaa1111',
    hash: 'aaa111111111',
    date: '2026-04-30',
    author: 'Coco',
    refs: ['HEAD -> main', 'tag: 0.34.0'],
    message: 'Merge branch feature/history',
  },
  {
    type: 'graph',
    graph: '|\\  ',
  },
  {
    type: 'commit',
    graph: '| * ',
    shortHash: 'bbb2222',
    hash: 'bbb222222222',
    date: '2026-04-29',
    author: 'Coco',
    refs: ['feature/history-with-a-long-name'],
    message: 'feat: improve graph fidelity',
  },
  {
    type: 'graph',
    graph: '|/  ',
  },
  {
    type: 'commit',
    graph: '*   ',
    shortHash: 'ccc3333',
    hash: 'ccc333333333',
    date: '2026-04-28',
    author: 'Coco',
    refs: [],
    message: 'fix: status view',
  },
]

describe('Ink history rows', () => {
  it('keeps compact mode calm by rendering commits only', () => {
    const state = createLogInkState(rows)
    const visible = getVisibleLogInkHistory(state, 5)

    expect(visible.items.map((item) => item.type)).toEqual(['commit', 'commit', 'commit'])
    expect(visible.graphWidth).toBe(1)
  })

  it('preserves graph continuation rows in full graph mode', () => {
    const state = applyLogInkAction(createLogInkState(rows), { type: 'toggleGraph' })
    const visible = getVisibleLogInkHistory(state, 5)

    expect(visible.items.map((item) => item.type)).toEqual([
      'commit',
      'graph',
      'commit',
      'graph',
      'commit',
    ])
    expect(visible.graphWidth).toBe(4)
  })

  it('renders refs as distinct labels without dot truncation', () => {
    expect(formatInkRefLabels(['HEAD -> main', 'tag: 0.34.0', 'origin/main'])).toBe(
      ' [HEAD -> main] [tag: 0.34.0] [origin/main]'
    )
  })

  it('pads graph rows using the computed graph lane width', () => {
    expect(formatInkHistoryGraphRow({ type: 'graph', graph: '|/' }, 4)).toBe('|/  ')
  })

  // #791 stage 2 — lane coloring. Full graph mode attaches lane
  // segments to each visible item so the renderer can paint each
  // logical branch in its own palette color. Compact mode renders a
  // synthetic single `*` per commit and gets no lane info.
  describe('lane segment attachment', () => {
    it('attaches lane segments to each visible item in full graph mode', () => {
      const state = applyLogInkAction(createLogInkState(rows), { type: 'toggleGraph' })
      const visible = getVisibleLogInkHistory(state, 5)

      const types = visible.items.map((item) => Boolean(item.laneSegments))
      expect(types).toEqual([true, true, true, true, true])

      // First commit: just a commit on lane 0.
      expect(visible.items[0].laneSegments).toEqual([
        { text: '●', laneId: 0 },
        { text: '   ', laneId: undefined },
      ])
      // |\  fork row: trunk on lane 0, new branch lane id assigned.
      expect(visible.items[1].laneSegments).toEqual([
        { text: '├', laneId: 0 },
        { text: '╮', laneId: 1 },
        { text: '  ', laneId: undefined },
      ])
    })

    it('keeps lane ids stable when scrolling the visible window', () => {
      // Build a long enough rows list that scrolling actually shifts the
      // window. The lane tracker should fast-forward through skipped
      // rows so the lane id of column 0 remains 0 — which is what
      // guarantees the trunk keeps its color regardless of scroll.
      const longRows: GitLogRow[] = Array.from({ length: 20 }, (_, i) => ({
        type: 'commit',
        graph: '* ',
        shortHash: `hash${i}`,
        hash: `hash${i}`.padEnd(40, '0'),
        date: '2026-04-30',
        author: 'Coco',
        refs: [],
        message: `commit ${i}`,
      }))
      const state = applyLogInkAction(createLogInkState(longRows), { type: 'toggleGraph' })
      const scrolled = applyLogInkAction(state, { type: 'move', delta: 5 })
      const visible = getVisibleLogInkHistory(scrolled, 3)

      // Even after scrolling, the trunk should stay on lane 0 thanks to
      // the tracker fast-forward in toFullGraphItems.
      visible.items.forEach((item) => {
        const trunkSegment = item.laneSegments?.find((seg) => seg.text === '●')
        expect(trunkSegment?.laneId).toBe(0)
      })
    })

    it('does not attach lane segments in compact mode', () => {
      const state = createLogInkState(rows)
      const visible = getVisibleLogInkHistory(state, 5)

      visible.items.forEach((item) => {
        expect(item.laneSegments).toBeUndefined()
      })
    })
  })
})
