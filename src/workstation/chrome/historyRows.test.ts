import { GitLogRow } from '../../commands/log/data'
import {
  commitGlyphFor,
  formatInkHistoryGraphRow,
  formatInkRefLabels,
  getVisibleLogInkHistory,
} from './historyRows'
import { applyLogInkAction, createLogInkState } from '../../workstation/runtime/inkViewModel'

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
    // 0.54.x flipped the default `fullGraph` to true; explicit
    // override here so the compact-mode behaviour stays pinned.
    const state = createLogInkState(rows, { fullGraph: false })
    const visible = getVisibleLogInkHistory(state, 5)

    expect(visible.items.map((item) => item.type)).toEqual(['commit', 'commit', 'commit'])
    expect(visible.graphWidth).toBe(1)
  })

  it('interleaves a transition row after each commit in full graph mode', () => {
    // Full mode is the 0.54.x default; pass explicitly so the test
    // intent reads correctly without depending on the default. The DAG
    // renderer emits a transition (graph) row beneath every commit,
    // carrying its topology + lane continuation.
    const state = createLogInkState(rows, { fullGraph: true })
    const visible = getVisibleLogInkHistory(state, 5, { fullGraphSpacing: true })

    expect(visible.items.map((item) => item.type)).toEqual([
      'commit',
      'graph',
      'commit',
      'graph',
      'commit',
    ])
    // 2-cells-per-column grid: a 2-lane fork spans 3 cells (●·●).
    expect(visible.graphWidth).toBe(3)
  })

  it('renders commit rows only when spacing is off', () => {
    const state = createLogInkState(rows, { fullGraph: true })
    const visible = getVisibleLogInkHistory(state, 5)

    expect(visible.items.map((item) => item.type)).toEqual(['commit', 'commit', 'commit'])
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
      const state = createLogInkState(rows, { fullGraph: true })
      const visible = getVisibleLogInkHistory(state, 5, { fullGraphSpacing: true })

      const types = visible.items.map((item) => Boolean(item.laneSegments))
      expect(types).toEqual([true, true, true, true, true])

      // First commit is HEAD on a merge; HEAD ring wins (stage 3).
      expect(visible.items[0].laneSegments).toEqual([{ text: '◉', laneId: 0 }])
      // Transition below the merge: trunk continues (├) on lane 0 while
      // the feature parent forks right (─╮) on its own lane, the corner
      // landing under the lane it opens.
      expect(visible.items[1].laneSegments).toEqual([
        { text: '├', laneId: 0 },
        { text: '─╮', laneId: 1 },
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
        // Connected linear chain — each commit's parent is the next one,
        // so they share a single trunk lane (id 0). With disconnected
        // roots the DAG engine would (correctly) hand each its own lane.
        parents: i < 19 ? [`hash${i + 1}`.padEnd(40, '0')] : [],
        date: '2026-04-30',
        author: 'Coco',
        refs: [],
        message: `commit ${i}`,
      }))
      const state = createLogInkState(longRows, { fullGraph: true })
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
      const state = createLogInkState(rows, { fullGraph: false })
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
      const state = createLogInkState(rows, { fullGraph: true })
      const visible = getVisibleLogInkHistory(state, 5)

      // First fixture row is HEAD -> main + a merge — HEAD wins.
      const head = visible.items[0]
      expect(head.type).toBe('commit')
      expect(head.laneSegments?.[0]).toEqual({ text: '◉', laneId: 0 })
    })

    it('renders compact-mode commits with their distinct glyphs', () => {
      const state = createLogInkState(rows, { fullGraph: false })
      const visible = getVisibleLogInkHistory(state, 5)

      // Order in compact (no graph rows): HEAD merge, side commit, root.
      expect(visible.items[0].laneSegments).toEqual([{ text: '◉', laneId: undefined }])
      expect(visible.items[1].laneSegments).toEqual([{ text: '●', laneId: undefined }])
      expect(visible.items[2].laneSegments).toEqual([{ text: '●', laneId: undefined }])
    })
  })

  // Full-graph spacing — visual fidelity follow-up. With
  // `fullGraphSpacing: true` the row builder injects a synthetic
  // vertical-only graph row after every commit so the eye reads
  // consecutive commits with comfortable rhythm rather than a stack.
  describe('fullGraphSpacing', () => {
    const linearRows: GitLogRow[] = Array.from({ length: 4 }, (_, i) => ({
      type: 'commit',
      graph: '* ',
      shortHash: `hash${i}`,
      hash: `hash${i}`.padEnd(40, '0'),
      // Connected chain so the four commits share one trunk lane.
      parents: i < 3 ? [`hash${i + 1}`.padEnd(40, '0')] : [],
      date: '2026-04-30',
      author: 'Coco',
      refs: [],
      message: `commit ${i}`,
    }))

    it('injects a vertical-only graph row after every commit in full mode', () => {
      const state = createLogInkState(linearRows, { fullGraph: true })
      const visible = getVisibleLogInkHistory(state, 8, { fullGraphSpacing: true })

      expect(visible.items.map((item) => item.type)).toEqual([
        'commit', 'graph', 'commit', 'graph', 'commit', 'graph', 'commit', 'graph',
      ])
      // The transition rows carry vertical lane markers (rendered as the
      // box-drawing `│`), not the commit dot — a single-lane chain is one
      // cell wide, so the ASCII projection is just `|`.
      expect(visible.items[1].graph).toBe('|')
      const spacer = visible.items[1] as {
        laneSegments?: Array<{ text: string }>
        spacer?: boolean
      }
      expect(spacer.laneSegments?.find((s) => s.text === '│')).toBeDefined()
      // The `spacer: true` flag distinguishes our injected lane
      // continuation from git's own topology rows so the renderer
      // can keep spacers at full lane brightness while topology
      // rows stay dim as scaffolding.
      expect(spacer.spacer).toBe(true)
    })

    it('marks every transition row as a spacer', () => {
      // The DAG renderer owns the topology now — git's own graph rows in
      // `state.rows` are ignored, so every graph row in the output is one
      // of our transition rows and carries `spacer: true` (the renderer
      // uses that flag to keep them at full lane brightness).
      const mergeShapedRows: GitLogRow[] = [
        {
          type: 'commit', graph: '*   ', shortHash: 'main1', hash: 'main1'.padEnd(40, '0'),
          parents: ['main0'.padEnd(40, '0')],
          date: '2026-05-15', author: 'Coco', refs: [], message: 'feat: main commit',
        },
        {
          type: 'commit', graph: '*   ', shortHash: 'main0', hash: 'main0'.padEnd(40, '0'),
          parents: ['side1'.padEnd(40, '0'), 'p2'.padEnd(40, '0')],
          date: '2026-04-23', author: 'Coco', refs: [], message: "Merge branch 'feat/x'",
        },
        { type: 'graph', graph: '|\\  ' },
        {
          type: 'commit', graph: '| * ', shortHash: 'side1', hash: 'side1'.padEnd(40, '0'),
          parents: [], date: '2026-04-22', author: 'Coco', refs: [], message: 'feat: side',
        },
      ]
      const state = createLogInkState(mergeShapedRows, { fullGraph: true })
      const visible = getVisibleLogInkHistory(state, 10, { fullGraphSpacing: true })

      const items = visible.items as Array<{ type: string; spacer?: boolean }>
      const graphRows = items.filter((i) => i.type === 'graph')

      expect(graphRows.length).toBeGreaterThan(0)
      expect(graphRows.every((i) => i.spacer === true)).toBe(true)
    })

    it('does not inject spacers when fullGraphSpacing is off', () => {
      const state = createLogInkState(linearRows, { fullGraph: true })
      const visible = getVisibleLogInkHistory(state, 8)

      expect(visible.items.every((item) => item.type === 'commit')).toBe(true)
    })

    it('does not inject spacers in compact mode regardless of option', () => {
      const state = createLogInkState(linearRows, { fullGraph: false })
      const visible = getVisibleLogInkHistory(state, 8, { fullGraphSpacing: true })

      expect(visible.items.every((item) => item.type === 'commit')).toBe(true)
    })

    it('preserves trunk lane id 0 across spacers when scrolling', () => {
      const state = createLogInkState(linearRows, { fullGraph: true })
      const scrolled = applyLogInkAction(state, { type: 'move', delta: 2 })
      const visible = getVisibleLogInkHistory(scrolled, 4, { fullGraphSpacing: true })

      // Every commit and every spacer should still place the trunk
      // glyph / lane bar on lane 0 — the fast-forward prefix has to
      // include the synthetic spacers so the tracker stays in sync.
      visible.items.forEach((item) => {
        if (item.type === 'bucket-header') return
        const trunkSegment = item.laneSegments?.find(
          (seg) => seg.text === '●' || seg.text === '◉' || seg.text === '◆' || seg.text === '│'
        )
        expect(trunkSegment?.laneId).toBe(0)
      })
    })

    it('emits exactly one transition row after every commit', () => {
      // The DAG renderer pairs each commit with a single transition row
      // (its topology + continuation). No suppression heuristics — the
      // count is deterministic: 2 rows per commit.
      const state = createLogInkState(linearRows, { fullGraph: true })
      const visible = getVisibleLogInkHistory(state, 8, { fullGraphSpacing: true })

      const commits = visible.items.filter((i) => i.type === 'commit')
      const transitions = visible.items.filter((i) => i.type === 'graph')
      expect(commits.length).toBe(4)
      expect(transitions.length).toBe(4)
    })

    it('draws a fork junction in the transition row below a merge', () => {
      // A real merge DAG: M merges A (first parent) and F (feature);
      // F rejoins at A. The transition below M must fork right toward
      // the feature lane.
      const mergeRows: GitLogRow[] = [
        {
          type: 'commit', graph: '*', shortHash: 'mmm', hash: 'mmm'.padEnd(40, '0'),
          parents: ['aaa'.padEnd(40, '0'), 'fff'.padEnd(40, '0')],
          date: '2026-04-23', author: 'Coco', refs: [], message: 'Merge feature',
        },
        {
          type: 'commit', graph: '*', shortHash: 'fff', hash: 'fff'.padEnd(40, '0'),
          parents: ['aaa'.padEnd(40, '0')],
          date: '2026-04-22', author: 'Coco', refs: [], message: 'feat: feature commit',
        },
        {
          type: 'commit', graph: '*', shortHash: 'aaa', hash: 'aaa'.padEnd(40, '0'),
          parents: [], date: '2026-04-21', author: 'Coco', refs: [], message: 'feat: base',
        },
      ]
      const state = createLogInkState(mergeRows, { fullGraph: true })
      const visible = getVisibleLogInkHistory(state, 10, { fullGraphSpacing: true })

      // items[1] is the transition below the merge commit.
      const transition = visible.items[1]
      expect(transition.type).toBe('graph')
      const rendered = transition.laneSegments?.map((s) => s.text).join('')
      expect(rendered).toBe('├─╮')
    })
  })

  // Date bucketing — replaces the per-row date column with section
  // dividers so adjacent commits within the same bucket share one
  // visible label and the eye gets temporal orientation without per-
  // row repetition. Triggered by passing `dateBucketingNow`.
  describe('dateBucketingNow', () => {
    const NOW = new Date(Date.UTC(2026, 4, 14)) // 2026-05-14

    const fixtureRows: GitLogRow[] = [
      {
        type: 'commit', graph: '* ', shortHash: 'a1', hash: 'a1'.padEnd(40, '0'),
        parents: [], date: '2026-05-14', author: 'Coco', refs: [], message: 'today commit',
      },
      {
        type: 'commit', graph: '* ', shortHash: 'b2', hash: 'b2'.padEnd(40, '0'),
        parents: [], date: '2026-05-13', author: 'Coco', refs: [], message: 'yesterday commit',
      },
      {
        type: 'commit', graph: '* ', shortHash: 'c3', hash: 'c3'.padEnd(40, '0'),
        parents: [], date: '2026-04-30', author: 'Coco', refs: [], message: 'april commit',
      },
    ]

    it('injects a bucket-header before the first commit and on each transition (compact mode)', () => {
      const state = createLogInkState(fixtureRows)
      const visible = getVisibleLogInkHistory(state, 10, { dateBucketingNow: NOW })

      expect(visible.items.map((item) => item.type)).toEqual([
        'bucket-header', 'commit',
        'bucket-header', 'commit',
        'bucket-header', 'commit',
      ])
      const headers = visible.items.filter((i) => i.type === 'bucket-header')
      expect(headers.map((h) => (h as { label: string }).label)).toEqual([
        'Today', 'Yesterday', 'April 2026',
      ])
    })

    // Regression (verified by execution before the fix): headers consume
    // rows AFTER the window start was computed headerless, so with the
    // cursor at the end of the list every emitted header pushed the tail
    // — including the SELECTED commit — off the render. Further j
    // presses looked dead because the highlight was off-screen.
    it('always renders the selected commit, even at end-of-list with headers eating the budget', () => {
      const manyRows: GitLogRow[] = Array.from({ length: 20 }, (_, i) => ({
        type: 'commit', graph: '* ', shortHash: `h${i}`, hash: `h${i}`.padEnd(40, '0'),
        parents: [],
        // Alternate dates so bucket transitions emit several headers.
        date: i % 2 === 0 ? '2026-05-14' : '2026-04-30',
        author: 'Coco', refs: [], message: `commit ${i}`,
      }))
      let state = createLogInkState(manyRows)
      state = { ...state, selectedIndex: 19 }

      const visible = getVisibleLogInkHistory(state, 10, { dateBucketingNow: NOW })
      const selectedRendered = visible.items.some(
        (item) => item.type === 'commit' && item.selected
      )
      expect(selectedRendered).toBe(true)
      expect(visible.items.length).toBeLessThanOrEqual(10)
    })

    it('reuses one header for consecutive commits in the same bucket', () => {
      const sameDayRows: GitLogRow[] = Array.from({ length: 3 }, (_, i) => ({
        type: 'commit', graph: '* ', shortHash: `h${i}`, hash: `h${i}`.padEnd(40, '0'),
        parents: [], date: '2026-05-14', author: 'Coco', refs: [], message: `today ${i}`,
      }))
      const state = createLogInkState(sameDayRows)
      const visible = getVisibleLogInkHistory(state, 10, { dateBucketingNow: NOW })

      expect(visible.items.map((item) => item.type)).toEqual([
        'bucket-header', 'commit', 'commit', 'commit',
      ])
    })

    it('does not bucket when no bucketingNow is passed', () => {
      const state = createLogInkState(fixtureRows)
      const visible = getVisibleLogInkHistory(state, 10)

      expect(visible.items.every((item) => item.type === 'commit')).toBe(true)
    })

    it('suppresses bucketing when a filter is active', () => {
      // Filter shuffles commits by relevance — adjacent-bucket
      // invariant breaks, so bucketing should not render.
      let state = createLogInkState(fixtureRows)
      state = applyLogInkAction(state, { type: 'setFilter', value: 'today' })
      const visible = getVisibleLogInkHistory(state, 10, { dateBucketingNow: NOW })

      expect(visible.items.every((item) => item.type === 'commit')).toBe(true)
    })

    it('injects headers in full graph mode without disturbing lane tracking', () => {
      const state = createLogInkState(fixtureRows, { fullGraph: true })
      const visible = getVisibleLogInkHistory(state, 10, { dateBucketingNow: NOW })

      // Headers appear; commits still carry lane segments.
      const headers = visible.items.filter((i) => i.type === 'bucket-header')
      expect(headers.length).toBe(3)
      const commits = visible.items.filter((i) => i.type === 'commit')
      commits.forEach((c) => {
        const cc = c as { laneSegments?: unknown[] }
        expect(cc.laneSegments).toBeDefined()
      })
    })

    it('prepends a sticky header when the window scrolls past the natural label', () => {
      // 5 same-day commits + 5 yesterday — scroll deep into the yesterday
      // bucket so the natural "Yesterday" header is above the visible
      // window. The sticky prepend keeps the user oriented.
      const longRows: GitLogRow[] = [
        ...Array.from({ length: 5 }, (_, i) => ({
          type: 'commit' as const, graph: '* ', shortHash: `t${i}`, hash: `t${i}`.padEnd(40, '0'),
          parents: [], date: '2026-05-14', author: 'Coco', refs: [], message: `today ${i}`,
        })),
        ...Array.from({ length: 5 }, (_, i) => ({
          type: 'commit' as const, graph: '* ', shortHash: `y${i}`, hash: `y${i}`.padEnd(40, '0'),
          parents: [], date: '2026-05-13', author: 'Coco', refs: [], message: `yesterday ${i}`,
        })),
      ]
      const state = createLogInkState(longRows, { fullGraph: true })
      // Move the cursor to the 8th commit (deep in yesterday)
      const scrolled = applyLogInkAction(state, { type: 'move', delta: 7 })
      const visible = getVisibleLogInkHistory(scrolled, 4, { dateBucketingNow: NOW })

      // The first item should be a header even though the natural
      // "Yesterday" header sits above the visible slice.
      expect(visible.items[0].type).toBe('bucket-header')
      const firstHeader = visible.items[0] as { label: string }
      expect(firstHeader.label).toBe('Yesterday')
    })
  })
})
