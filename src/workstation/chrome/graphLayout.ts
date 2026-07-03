/**
 * DAG-based commit-graph lane layout (#1190, stage 1).
 *
 * Today the history graph is rendered by parsing the ASCII topology
 * `git log --graph` emits. That ASCII lays lanes out on a 2-column
 * pitch, which makes it impossible to route a junction corner directly
 * under the commit it joins — so fork/merge connectors always read as
 * slightly detached. The fix is to stop parsing git's ASCII and compute
 * the lane layout ourselves from the commit DAG, which we already have:
 * every `GitLogCommitRow` carries `parents: string[]` (from `%P`).
 *
 * This module is the pure layout engine. It takes the ordered commit
 * list (newest first, exactly as `git log` returns it) and produces a
 * structured per-commit model — column assignment, lane ids for
 * coloring, the lanes passing through each commit row, and the edges
 * that must be drawn in the transition row beneath each commit. A
 * separate renderer (stage 2) turns this model into glyph segments;
 * keeping the two apart means the layout can be unit-tested on data
 * alone, with no Ink or glyph concerns.
 *
 * ## Algorithm — swimlane assignment
 *
 * We walk commits top-to-bottom maintaining a list of *active lanes*,
 * one per column. Each active lane "expects" a specific parent hash:
 * it is the descending edge that will connect to that parent when we
 * reach it. For each commit:
 *
 *   - Its column is the leftmost active lane expecting its hash. Any
 *     other lanes expecting the same hash *converge* into that column
 *     (multiple children of one commit) and are freed.
 *   - If no lane expects it, the commit is a branch tip with no loaded
 *     child — it opens a fresh lane in the leftmost free column.
 *   - Its first parent continues straight down in the commit's column.
 *     Each additional parent (a merge) opens a new lane to carry that
 *     edge; merges that share a parent reuse one lane rather than
 *     duplicating columns.
 *   - A commit with no parents (a root) terminates its lane.
 *
 * Existing lanes never shift columns — a freed column is only reused by
 * a *new* lane, which keeps width bounded to the peak concurrent lane
 * count without lanes sliding sideways for no reason. A lane id is
 * assigned once when the lane is born and carried for its whole life,
 * so `getLaneColor` paints a logical branch one stable color even as
 * other lanes come and go around it.
 *
 * ## Edges
 *
 * The transition row beneath commit `i` connects commit `i` to commit
 * `i+1`. Each lane alive in that gap has a top attachment (where it
 * leaves row `i`) and a bottom attachment (where it enters row `i+1`):
 *
 *   - top    = the commit's column if the lane is the commit's own lane
 *              or a freshly-opened parent lane (both emanate from the
 *              dot); otherwise the lane's own column (a pass-through
 *              dropping straight down).
 *   - bottom = commit `i+1`'s column if the lane converges into it
 *              (it expects `i+1`'s hash); otherwise the lane's column.
 *
 * `from === to` is a straight vertical; `to < from` converges left;
 * `to > from` diverges right. Computing the bottom attachment needs one
 * commit of lookahead, so layout runs in two passes.
 */
import type { GitLogCommitRow } from '../../commands/log/data'

/**
 * One edge in the transition row below a commit. `from` is the column
 * it leaves the commit row at, `to` the column it enters the next row
 * at. Equal columns → vertical; `to < from` → converge; `to > from` →
 * diverge.
 */
export type LaneEdge = {
  laneId: number
  from: number
  to: number
}

/** Per-commit layout — everything the renderer needs for one commit. */
export type CommitLayoutRow = {
  hash: string
  /** Column (0-based) the commit dot sits in. */
  column: number
  /** Stable lane id for coloring; reuse `getLaneColor(laneId, theme)`. */
  laneId: number
  /** Lanes crossing this commit row that are not the commit itself. */
  passthrough: { laneId: number; column: number }[]
  /** Edges routed in the transition row beneath this commit. */
  edges: LaneEdge[]
  /** `parents.length > 1` — drawn with the merge glyph. */
  isMerge: boolean
  /** `parents.length === 0` — the lane terminates here. */
  isRoot: boolean
  /** Columns occupied at this row (max column + 1); for width math. */
  width: number
}

export type GraphLayout = {
  rows: CommitLayoutRow[]
  /** Widest row in the layout; feeds the dynamic graph-column width. */
  maxWidth: number
}

/** Minimal commit shape the engine needs — `GitLogCommitRow` satisfies it. */
export type LayoutCommit = Pick<GitLogCommitRow, 'hash' | 'parents'>

/** An active descending edge waiting to connect to `expecting`. */
type Lane = { laneId: number; expecting: string }

/** Leftmost free column (a hole left by a freed lane), else a new one. */
function firstFreeColumn(lanes: (Lane | null)[]): number {
  const hole = lanes.findIndex((lane) => lane === null)
  return hole === -1 ? lanes.length : hole
}

/** Drop trailing holes so width tracks the rightmost live lane. */
function trimTrailingHoles(lanes: (Lane | null)[]): void {
  while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
    lanes.pop()
  }
}

type LayoutNode = {
  hash: string
  column: number
  laneId: number
  isMerge: boolean
  isRoot: boolean
  /** Lane ids opened by this commit's extra (merge) parents. */
  bornParents: Set<number>
  /**
   * Lane ids of ALREADY-OPEN lanes this merge's extra parents resolved
   * to (#1335). Distinct from `bornParents`: a born lane's whole edge
   * emanates from the dot (no vertical above), while a reused lane
   * keeps its own vertical continuation and needs an ADDITIONAL
   * connector edge from the merge dot — without it the merge glyph
   * renders with only one descending line and the DAG edge to the
   * second parent is invisible.
   */
  mergedLanes: Set<number>
  /** Lane snapshot entering this commit row. */
  before: (Lane | null)[]
  /** Lane snapshot leaving this commit row (entering the next). */
  after: (Lane | null)[]
}

export function computeGraphLayout(commits: LayoutCommit[]): GraphLayout {
  const lanes: (Lane | null)[] = []
  let nextLaneId = 0
  const nodes: LayoutNode[] = []

  // Pass 1 — assign each commit a column + lane id, snapshotting the
  // lane state on either side so pass 2 can route the edge rows.
  for (const commit of commits) {
    const before = lanes.map((lane) => (lane ? { ...lane } : null))

    const matching: number[] = []
    for (let c = 0; c < lanes.length; c += 1) {
      if (lanes[c]?.expecting === commit.hash) matching.push(c)
    }

    let column: number
    let laneId: number
    if (matching.length === 0) {
      // Branch tip with no loaded child — open a fresh lane.
      column = firstFreeColumn(lanes)
      laneId = nextLaneId
      nextLaneId += 1
    } else {
      // Leftmost expecting lane is our column; the rest converge in.
      column = matching[0]
      laneId = lanes[column]!.laneId
    }
    for (const c of matching) {
      if (c !== column) lanes[c] = null
    }

    const isRoot = commit.parents.length === 0
    const isMerge = commit.parents.length > 1
    const bornParents = new Set<number>()
    const mergedLanes = new Set<number>()

    if (isRoot) {
      lanes[column] = null
    } else {
      lanes[column] = { laneId, expecting: commit.parents[0] }
      for (let p = 1; p < commit.parents.length; p += 1) {
        const parentHash = commit.parents[p]
        // Reuse a lane already waiting for this parent so two merges
        // that share a parent share its lane.
        const target = lanes.findIndex((lane) => lane?.expecting === parentHash)
        if (target === -1) {
          const born = firstFreeColumn(lanes)
          const newLaneId = nextLaneId
          nextLaneId += 1
          lanes[born] = { laneId: newLaneId, expecting: parentHash }
          bornParents.add(newLaneId)
        } else if (target !== column) {
          // The parent's lane already exists (#1335) — record the
          // connection so pass 2 emits a connector from the merge dot
          // to that lane in addition to the lane's own vertical.
          mergedLanes.add(lanes[target]!.laneId)
        }
      }
    }

    trimTrailingHoles(lanes)
    const after = lanes.map((lane) => (lane ? { ...lane } : null))
    nodes.push({ hash: commit.hash, column, laneId, isMerge, isRoot, bornParents, mergedLanes, before, after })
  }

  // Pass 2 — derive pass-throughs and edge rows (one commit lookahead).
  const rows: CommitLayoutRow[] = []
  let maxWidth = 1
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i]
    const next = nodes[i + 1]

    const passthrough: { laneId: number; column: number }[] = []
    for (let c = 0; c < node.before.length; c += 1) {
      const lane = node.before[c]
      if (!lane) continue
      if (c === node.column) continue
      // Lanes converging into this commit merged in the edge row above,
      // so they are not drawn again on the commit row itself.
      if (lane.expecting === node.hash) continue
      passthrough.push({ laneId: lane.laneId, column: c })
    }

    const edges: LaneEdge[] = []
    for (let c = 0; c < node.after.length; c += 1) {
      const lane = node.after[c]
      if (!lane) continue
      const emanatesFromDot = lane.laneId === node.laneId || node.bornParents.has(lane.laneId)
      const from = emanatesFromDot ? node.column : c
      const to = next && lane.expecting === next.hash ? next.column : c
      edges.push({ laneId: lane.laneId, from, to })
      // A merge parent that resolved to this ALREADY-OPEN lane (#1335):
      // the lane's own vertical (above) keeps its continuity, and this
      // extra edge draws the connector from the merge dot into the
      // lane. The renderer composes the two per-cell (├─┤ junctions),
      // so the second-parent edge is no longer invisible.
      if (node.mergedLanes.has(lane.laneId) && node.column !== to) {
        edges.push({ laneId: lane.laneId, from: node.column, to })
      }
    }

    const width =
      Math.max(
        node.column,
        ...passthrough.map((p) => p.column),
        ...edges.flatMap((e) => [e.from, e.to])
      ) + 1
    maxWidth = Math.max(maxWidth, width)

    rows.push({
      hash: node.hash,
      column: node.column,
      laneId: node.laneId,
      passthrough,
      edges,
      isMerge: node.isMerge,
      isRoot: node.isRoot,
      width,
    })
  }

  return { rows, maxWidth }
}
