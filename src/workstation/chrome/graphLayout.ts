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
import type { GitLogCommitRow } from '../../git/logData'

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

/** Pass-1 state, kept so a layout can be resumed when commits are appended. */
type LayoutState = {
  lanes: (Lane | null)[]
  nextLaneId: number
  /** Pass-1 nodes from commit index `nodesStart` onward. */
  nodes: LayoutNode[]
  nodesStart: number
}

/**
 * Resume state for layouts this module produced. Held off to the side so
 * `GraphLayout` stays a plain data shape for callers and tests.
 */
const resumeState = new WeakMap<GraphLayout, LayoutState>()

/** Pass 1 for one commit: assign its column + lane id, snapshotting lanes on either side. */
function placeCommit(commit: LayoutCommit, state: LayoutState): void {
  const { lanes } = state
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
    laneId = state.nextLaneId
    state.nextLaneId += 1
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
        const newLaneId = state.nextLaneId
        state.nextLaneId += 1
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
  state.nodes.push({ hash: commit.hash, column, laneId, isMerge, isRoot, bornParents, mergedLanes, before, after })
}

/** Pass 2 for one commit: pass-throughs and the edge row beneath it (needs one commit of lookahead). */
function routeRow(node: LayoutNode, next: LayoutNode | undefined): CommitLayoutRow {
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

  return {
    hash: node.hash,
    column: node.column,
    laneId: node.laneId,
    passthrough,
    edges,
    isMerge: node.isMerge,
    isRoot: node.isRoot,
    width,
  }
}

/**
 * Lay out `commits[from..]` on top of `state` (which already holds
 * `commits[0..from)`), reusing `prevRows` for every row whose lookahead is
 * unchanged. Only the last previous row is re-routed: it had no next
 * commit before, so its edges ended in place.
 */
function layoutFrom(
  commits: LayoutCommit[],
  from: number,
  state: LayoutState,
  prevRows: CommitLayoutRow[]
): GraphLayout {
  for (let i = from; i < commits.length; i += 1) placeCommit(commits[i], state)

  const keep = Math.max(0, from - 1)
  const rows = prevRows.slice(0, keep)
  const node = (index: number) => state.nodes[index - state.nodesStart]
  const total = state.nodesStart + state.nodes.length
  for (let i = keep; i < total; i += 1) {
    rows.push(routeRow(node(i), i + 1 < total ? node(i + 1) : undefined))
  }
  let maxWidth = 1
  for (const row of rows) if (row.width > maxWidth) maxWidth = row.width

  const layout: GraphLayout = { rows, maxWidth }
  // Resuming re-routes only the last row, so keep only its node and the
  // lane state. Keeping every node (each with lane snapshots on both
  // sides) made a 20k-commit layout hold millions of objects (#2208).
  resumeState.set(layout, {
    lanes: state.lanes,
    nextLaneId: state.nextLaneId,
    nodes: total > 0 ? [node(total - 1)] : [],
    nodesStart: Math.max(0, total - 1),
  })
  return layout
}

export function computeGraphLayout(commits: LayoutCommit[]): GraphLayout {
  return layoutFrom(commits, 0, { lanes: [], nextLaneId: 0, nodes: [], nodesStart: 0 }, [])
}

/**
 * Extend `previous` — the layout of the first `previous.rows.length`
 * entries of `commits` — to all of `commits` (#2208). Paging appends a
 * 1000-commit page at a time; laying everything out again on every page
 * made reaching n commits cost O(n^2). The result equals
 * `computeGraphLayout(commits)`.
 *
 * Falls back to a full layout when `previous` was not produced here or is
 * not a prefix of `commits` (an anchored context load merges rows in the
 * middle, not at the end).
 */
export function extendGraphLayout(previous: GraphLayout, commits: LayoutCommit[]): GraphLayout {
  const saved = resumeState.get(previous)
  const prevCount = previous.rows.length
  const isPrefix =
    saved !== undefined &&
    prevCount <= commits.length &&
    previous.rows.every((row, i) => row.hash === commits[i].hash)
  if (!isPrefix) return computeGraphLayout(commits)
  if (prevCount === commits.length) return previous

  // Copy the pass-1 state so `previous` stays resumable on its own.
  const state: LayoutState = {
    lanes: saved.lanes.map((lane) => (lane ? { ...lane } : null)),
    nextLaneId: saved.nextLaneId,
    nodes: saved.nodes.slice(),
    nodesStart: saved.nodesStart,
  }
  return layoutFrom(commits, prevCount, state, previous.rows)
}
