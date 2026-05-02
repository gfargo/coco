import { GitLogRow } from './data'
import {
  commitGlyphFor,
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
    parents: ['ccc333333333', 'bbb222222222'],
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
    parents: ['ccc333333333'],
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
    parents: [],
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

      // First commit is HEAD on a merge; HEAD ring wins (stage 3).
      expect(visible.items[0].laneSegments).toEqual([
        { text: '◉', laneId: 0 },
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
        parents: [],
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

    it('attaches single muted lane segments in compact mode for glyph rendering', () => {
      // Compact mode now ships lane segments too — they carry the
      // merge / HEAD glyph but stay laneId-undefined so they render
      // muted (matching the legacy compact look). Stage 3 (#791) — the
      // glyph differentiation is the win.
      const state = createLogInkState(rows)
      const visible = getVisibleLogInkHistory(state, 5)

      visible.items.forEach((item) => {
        expect(item.laneSegments).toHaveLength(1)
        expect(item.laneSegments?.[0].laneId).toBeUndefined()
      })
    })
  })

  // #791 stage 3 — distinct merge glyph + HEAD ring. Parent count and
  // ref decoration determine which Unicode glyph the renderer paints
  // for each commit so they stand out from the run of regular `●`s.
  describe('commit glyph selection', () => {
    it('paints HEAD with the fisheye ring', () => {
      expect(commitGlyphFor({
        type: 'commit',
        graph: '*',
        shortHash: 'aaa',
        hash: 'aaa',
        parents: ['bbb'],
        date: '2026-04-30',
        author: 'Coco',
        refs: ['HEAD -> main'],
        message: 'feat: head commit',
      })).toBe('◉')
    })

    it('paints merge commits with the filled diamond', () => {
      expect(commitGlyphFor({
        type: 'commit',
        graph: '*',
        shortHash: 'aaa',
        hash: 'aaa',
        parents: ['bbb', 'ccc'],
        date: '2026-04-30',
        author: 'Coco',
        refs: ['feature/x'],
        message: 'Merge branch x',
      })).toBe('◆')
    })

    it('prefers HEAD ring over merge diamond when both apply', () => {
      // HEAD on a merge commit — both signals fire; the ring wins
      // because it is the more salient cursor for the user.
      expect(commitGlyphFor({
        type: 'commit',
        graph: '*',
        shortHash: 'aaa',
        hash: 'aaa',
        parents: ['bbb', 'ccc'],
        date: '2026-04-30',
        author: 'Coco',
        refs: ['HEAD -> main'],
        message: 'Merge branch x',
      })).toBe('◉')
    })

    it('paints regular commits with the default filled circle', () => {
      expect(commitGlyphFor({
        type: 'commit',
        graph: '*',
        shortHash: 'aaa',
        hash: 'aaa',
        parents: ['bbb'],
        date: '2026-04-30',
        author: 'Coco',
        refs: [],
        message: 'feat: regular',
      })).toBe('●')
    })

    it('detects HEAD when listed standalone (detached HEAD case)', () => {
      expect(commitGlyphFor({
        type: 'commit',
        graph: '*',
        shortHash: 'aaa',
        hash: 'aaa',
        parents: ['bbb'],
        date: '2026-04-30',
        author: 'Coco',
        refs: ['HEAD'],
        message: 'detached',
      })).toBe('◉')
    })
  })

  describe('lane segments thread the commit glyph through', () => {
    it('renders the HEAD commit with ◉ in full graph mode', () => {
      const state = applyLogInkAction(createLogInkState(rows), { type: 'toggleGraph' })
      const visible = getVisibleLogInkHistory(state, 5)

      // First fixture row is HEAD -> main + a merge — HEAD wins.
      const head = visible.items[0]
      expect(head.type).toBe('commit')
      expect(head.laneSegments?.[0]).toEqual({ text: '◉', laneId: 0 })
    })

    it('renders compact-mode commits with their distinct glyphs', () => {
      const state = createLogInkState(rows)
      const visible = getVisibleLogInkHistory(state, 5)

      // Order in compact (no graph rows): HEAD merge, side commit, root.
      expect(visible.items[0].laneSegments).toEqual([{ text: '◉', laneId: undefined }])
      expect(visible.items[1].laneSegments).toEqual([{ text: '●', laneId: undefined }])
      expect(visible.items[2].laneSegments).toEqual([{ text: '●', laneId: undefined }])
    })
  })
})
