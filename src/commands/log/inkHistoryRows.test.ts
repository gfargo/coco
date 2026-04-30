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
})
