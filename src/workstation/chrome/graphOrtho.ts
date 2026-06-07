/**
 * Orthogonal renderer for the DAG lane layout (#1190, stage 2).
 *
 * Stage 1 (`graphLayout.ts`) turns the commit DAG into a per-commit
 * model — column, lane id, pass-through lanes, and the edges to draw in
 * the transition row beneath each commit. This module turns that model
 * into the `LaneSegment[]` the existing renderer already consumes
 * (`renderLaneSegmentSpans` in the history surface), so the rest of the
 * pipeline is untouched.
 *
 * ## Why orthogonal beats diagonals
 *
 * git's ASCII lays lanes on a 2-column pitch, so a fork/merge connector
 * can only ever be a diagonal that meets the vertical bars and commit
 * dots at cell *corners*, never their centers — it always looks a hair
 * detached. Here we own the layout, so we use a fixed 2-cells-per-column
 * grid (column `c` owns char offsets `2c` for the node/bar and `2c+1`
 * for the connector to its right) and route every edge orthogonally
 * with box-drawing corners + horizontals. A junction corner lands
 * exactly under the commit column, so lines connect at cell edges with
 * zero offset.
 *
 * ## How a transition row is composed
 *
 * Each cell accumulates a set of connection directions (up/down/left/
 * right) as edges are laid down; the direction set then maps to a single
 * box-drawing glyph. This composition is what makes junctions fall out
 * for free: a trunk continuing down (`U+D`) plus a branch forking right
 * (`U+R`) in the same cell becomes `U+D+R` → `├`; a horizontal crossing
 * a vertical becomes `┼`; an octopus fork becomes `├─┬─╮`.
 *
 * Verticals (pass-throughs and the commit's own continuing lane) are
 * laid down first so they claim the cell's color; a converging or
 * diverging branch then adds its directions but leaves the junction
 * cell's color as the trunk's, while its own corner + horizontal keep
 * the branch's color (matching the prior convention where a merging
 * branch's tail stayed its own hue into the junction).
 */
import { DEFAULT_COMMIT_GLYPH } from './graphChars'
import type { CommitLayoutRow } from './graphLayout'
import type { LaneSegment } from './graphLanes'

// Connection directions, as a bitmask per cell.
const U = 1
const D = 2
const L = 4
const R = 8

const GLYPH_BY_MASK: Readonly<Record<number, string>> = {
  [U | D]: '│',
  [L | R]: '─',
  [D | R]: '╭',
  [D | L]: '╮',
  [U | R]: '╰',
  [U | L]: '╯',
  [U | D | R]: '├',
  [U | D | L]: '┤',
  [D | L | R]: '┬',
  [U | L | R]: '┴',
  [U | D | L | R]: '┼',
  // Dangling stubs (a lane that only enters/leaves on one side at the
  // window edge) degrade to the matching straight piece.
  [U]: '│',
  [D]: '│',
  [L]: '─',
  [R]: '─',
}

/** Char offset of a column's node/bar cell on the 2-per-column grid. */
function nodeOffset(column: number): number {
  return column * 2
}

/** Total grid cells for a row of the given column count. */
function cellCount(width: number): number {
  return Math.max(1, width * 2 - 1)
}

type Cell = { text: string; laneId: number | undefined }

/** Coalesce adjacent cells of equal lane id into segments; drop the
 *  trailing run of blanks (the downstream renderer pads to width). */
function coalesce(cells: Cell[]): LaneSegment[] {
  // Trim trailing blank (lane-less) cells.
  let end = cells.length
  while (end > 0 && cells[end - 1].text === ' ' && cells[end - 1].laneId === undefined) {
    end -= 1
  }
  const segments: LaneSegment[] = []
  for (let i = 0; i < end; i += 1) {
    const cell = cells[i]
    const last = segments[segments.length - 1]
    if (last && last.laneId === cell.laneId) {
      last.text += cell.text
    } else {
      segments.push({ text: cell.text, laneId: cell.laneId })
    }
  }
  return segments
}

/**
 * Render the commit row: the commit glyph at its column, a `│` for every
 * lane passing through, blanks elsewhere. `commitGlyph` is supplied by
 * the caller (merge `◆` / HEAD `◉` / regular `●` via `commitGlyphFor`).
 */
export function renderCommitRowSegments(
  row: CommitLayoutRow,
  commitGlyph: string = DEFAULT_COMMIT_GLYPH
): LaneSegment[] {
  const cells: Cell[] = Array.from({ length: cellCount(row.width) }, () => ({
    text: ' ',
    laneId: undefined,
  }))
  for (const lane of row.passthrough) {
    cells[nodeOffset(lane.column)] = { text: '│', laneId: lane.laneId }
  }
  cells[nodeOffset(row.column)] = { text: commitGlyph, laneId: row.laneId }
  return coalesce(cells)
}

/**
 * Render the transition row beneath a commit: every edge routed
 * orthogonally with corners + horizontals, junctions composed from the
 * accumulated direction set of each cell.
 */
export function renderTransitionRowSegments(row: CommitLayoutRow): LaneSegment[] {
  const masks: number[] = new Array(cellCount(row.width)).fill(0)
  const laneIds: (number | undefined)[] = new Array(masks.length).fill(undefined)

  const add = (offset: number, dirs: number, laneId: number) => {
    masks[offset] |= dirs
    if (laneIds[offset] === undefined) laneIds[offset] = laneId
  }

  // Pass 1 — verticals (pass-throughs + the commit's continuing lane)
  // claim their cell and its color first, so junctions read as trunk.
  for (const edge of row.edges) {
    if (edge.from === edge.to) add(nodeOffset(edge.from), U | D, edge.laneId)
  }

  // Pass 2 — diverging / converging branches add their corners and
  // horizontal run without overriding a claimed cell's color.
  for (const edge of row.edges) {
    if (edge.from === edge.to) continue
    const a = nodeOffset(edge.from)
    const b = nodeOffset(edge.to)
    if (edge.to > edge.from) {
      // Diverge right: up out of the dot, across, down into the new lane.
      add(a, U | R, edge.laneId)
      for (let x = a + 1; x < b; x += 1) add(x, L | R, edge.laneId)
      add(b, L | D, edge.laneId)
    } else {
      // Converge left: up out of the source column, across, down into
      // the target (the next commit's column).
      add(a, U | L, edge.laneId)
      for (let x = b + 1; x < a; x += 1) add(x, L | R, edge.laneId)
      add(b, D | R, edge.laneId)
    }
  }

  const cells: Cell[] = masks.map((mask, i) => ({
    text: mask === 0 ? ' ' : GLYPH_BY_MASK[mask] ?? ' ',
    laneId: mask === 0 ? undefined : laneIds[i],
  }))
  return coalesce(cells)
}

/** Grid cell width of a row — for padding / `graphWidth` projection. */
export function rowCellWidth(row: CommitLayoutRow): number {
  return cellCount(row.width)
}
