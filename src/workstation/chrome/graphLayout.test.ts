import { computeGraphLayout, LayoutCommit } from './graphLayout'

/** Terse fixture builder: `c('A', 'B')` → commit A with parent B. */
function c(hash: string, ...parents: string[]): LayoutCommit {
  return { hash, parents }
}

describe('computeGraphLayout', () => {
  it('lays linear history in a single column', () => {
    const layout = computeGraphLayout([c('A', 'B'), c('B', 'C'), c('C')])

    expect(layout.maxWidth).toBe(1)
    expect(layout.rows.map((r) => r.column)).toEqual([0, 0, 0])
    expect(layout.rows.map((r) => r.laneId)).toEqual([0, 0, 0])
    expect(layout.rows.every((r) => r.passthrough.length === 0)).toBe(true)
    // A→B and B→C continue straight; C is a root with no edge below.
    expect(layout.rows[0].edges).toEqual([{ laneId: 0, from: 0, to: 0 }])
    expect(layout.rows[1].edges).toEqual([{ laneId: 0, from: 0, to: 0 }])
    expect(layout.rows[2].edges).toEqual([])
    expect(layout.rows[2].isRoot).toBe(true)
  })

  it('routes a fork-and-merge through a feature lane', () => {
    // M is a merge of main (A) and feature (F); F branches off and
    // rejoins at A.
    const layout = computeGraphLayout([
      c('M', 'A', 'F'),
      c('F', 'A'),
      c('A', 'Z'),
      c('Z'),
    ])
    const [m, f, a, z] = layout.rows

    expect(layout.maxWidth).toBe(2)

    // Merge commit sits on the trunk; opens the feature lane to the right.
    expect(m).toMatchObject({ column: 0, laneId: 0, isMerge: true })
    expect(m.passthrough).toEqual([])
    expect(m.edges).toEqual([
      { laneId: 0, from: 0, to: 0 }, // trunk continues toward A
      { laneId: 1, from: 0, to: 1 }, // feature lane diverges right
    ])

    // Feature commit on lane 1; trunk passes through on the left.
    expect(f).toMatchObject({ column: 1, laneId: 1 })
    expect(f.passthrough).toEqual([{ laneId: 0, column: 0 }])
    expect(f.edges).toEqual([
      { laneId: 0, from: 0, to: 0 }, // trunk straight down to A
      { laneId: 1, from: 1, to: 0 }, // feature converges left into A
    ])

    // A absorbs the feature lane (no passthrough — it merged above).
    expect(a).toMatchObject({ column: 0, laneId: 0 })
    expect(a.passthrough).toEqual([])
    expect(a.edges).toEqual([{ laneId: 0, from: 0, to: 0 }])

    // Z is the root.
    expect(z).toMatchObject({ column: 0, laneId: 0, isRoot: true })
    expect(z.edges).toEqual([])
  })

  it('keeps two independent branches in stable, distinct lanes', () => {
    // Two unrelated lines (e.g. under `--all`): A→C and B→D, no merge.
    const layout = computeGraphLayout([
      c('A', 'C'),
      c('B', 'D'),
      c('C'),
      c('D'),
    ])
    const [a, b, cc, d] = layout.rows

    expect(layout.maxWidth).toBe(2)
    expect(a).toMatchObject({ column: 0, laneId: 0 })
    expect(b).toMatchObject({ column: 1, laneId: 1 })
    // While B's line is alive, A's lane (0) passes through B's row.
    expect(b.passthrough).toEqual([{ laneId: 0, column: 0 }])
    expect(cc).toMatchObject({ column: 0, laneId: 0, isRoot: true })
    // D's lane (1) passes through C's row before terminating.
    expect(cc.passthrough).toEqual([{ laneId: 1, column: 1 }])
    expect(d).toMatchObject({ column: 1, laneId: 1, isRoot: true })
    // Lane ids stay attached to their branch throughout.
    expect(a.laneId).not.toBe(b.laneId)
  })

  it('opens one lane per extra parent for an octopus merge', () => {
    const layout = computeGraphLayout([
      c('O', 'P1', 'P2', 'P3'),
      c('P1'),
      c('P2'),
      c('P3'),
    ])
    const o = layout.rows[0]

    expect(o.isMerge).toBe(true)
    expect(o.column).toBe(0)
    expect(layout.maxWidth).toBe(3)
    // Three prongs fan out from the merge dot at column 0.
    expect(o.edges).toEqual([
      { laneId: 0, from: 0, to: 0 },
      { laneId: 1, from: 0, to: 1 },
      { laneId: 2, from: 0, to: 2 },
    ])
  })

  it('reuses a freed column for a new branch but assigns a fresh lane id', () => {
    // A→B ends at the root B (column 0 freed); C is a new tip that
    // reuses column 0 but must get a NEW lane id so its color differs.
    const layout = computeGraphLayout([c('A', 'B'), c('B'), c('C', 'D'), c('D')])
    const [a, b, cc] = layout.rows

    expect(a).toMatchObject({ column: 0, laneId: 0 })
    expect(b).toMatchObject({ column: 0, laneId: 0, isRoot: true })
    expect(cc.column).toBe(0)
    expect(cc.laneId).toBe(1) // reused column, new lane id → new color
  })

  it('shares one lane when two merge parents point at the same commit', () => {
    // M merges P twice (degenerate but valid): only one lane to P.
    const layout = computeGraphLayout([c('M', 'P', 'Q'), c('Q', 'P'), c('P')])
    const m = layout.rows[0]

    // M opens lane 1 for Q; Q's parent P reuses M's trunk lane (which
    // already expects P), so P never needs a third column.
    expect(layout.maxWidth).toBe(2)
    expect(m.edges).toEqual([
      { laneId: 0, from: 0, to: 0 },
      { laneId: 1, from: 0, to: 1 },
    ])
  })

  it('draws a connector when a merge parent resolves to an already-open lane (#1335)', () => {
    // X merges F in (opening F's lane), then M2 merges F AGAIN. When
    // M2's extra parent resolves to the existing F lane, the layout
    // must still emit an edge from the merge dot (column 0) into that
    // lane — before the fix M2 rendered a ◆ with a single descending
    // line and the second-parent edge was invisible.
    const layout = computeGraphLayout([
      c('X', 'M2', 'F'),
      c('M2', 'A', 'F'),
      c('F', 'A'),
      c('A'),
    ])
    const m2 = layout.rows[1]

    expect(m2).toMatchObject({ column: 0, isMerge: true })
    expect(m2.edges).toEqual([
      { laneId: 0, from: 0, to: 0 }, // trunk continues toward A
      { laneId: 1, from: 1, to: 1 }, // F lane's own vertical continuity
      { laneId: 1, from: 0, to: 1 }, // NEW: merge-dot connector into the F lane
    ])
  })

  it('does not crash when a parent hash is outside the loaded window', () => {
    // A's parent was never loaded (paginated off): its lane simply runs
    // to the bottom of the window with a straight edge, no throw.
    const layout = computeGraphLayout([c('A', 'OFFSCREEN')])

    expect(layout.maxWidth).toBe(1)
    expect(layout.rows[0]).toMatchObject({ column: 0, laneId: 0 })
    expect(layout.rows[0].edges).toEqual([{ laneId: 0, from: 0, to: 0 }])
  })

  it('keeps width bounded under merge-heavy history', () => {
    // Repeated branch/merge cycles must not let columns drift right:
    // width should track peak concurrency (2 lanes), not commit count.
    const commits: LayoutCommit[] = []
    for (let i = 0; i < 12; i += 1) {
      const main = `m${i}`
      const feat = `f${i}`
      const nextMain = `m${i + 1}`
      commits.push(c(main, nextMain, feat)) // merge feature into main
      commits.push(c(feat, nextMain)) // feature commit off the next main
    }
    commits.push(c('m12'))

    const layout = computeGraphLayout(commits)
    expect(layout.maxWidth).toBe(2)
  })

  it('handles an empty commit list', () => {
    expect(computeGraphLayout([])).toEqual({ rows: [], maxWidth: 1 })
  })
})
