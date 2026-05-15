import { GitLogCommitRow, GitLogGraphRow, GitLogRow } from '../../commands/log/data'
import {
  DEFAULT_COMMIT_GLYPH,
  HEAD_COMMIT_GLYPH,
  MERGE_COMMIT_GLYPH,
} from './graphChars'
import {
  LaneSegment,
  advanceTrackerThrough,
  createLaneTrackerState,
  renderGraphRowSegments,
} from './graphLanes'
import { LogInkState } from '../../commands/log/inkViewModel'

/**
 * Pick the commit glyph based on parent count + HEAD-ness so the
 * renderer can flag merges and the current head visually. HEAD wins
 * over merge when both apply (HEAD on a merge commit) — the ◉ ring
 * is the more salient signal and the user can still see the merge
 * via the lane topology.
 */
export function commitGlyphFor(commit: GitLogCommitRow): string {
  if (isHeadCommit(commit)) {
    return HEAD_COMMIT_GLYPH
  }
  if (commit.parents.length > 1) {
    return MERGE_COMMIT_GLYPH
  }
  return DEFAULT_COMMIT_GLYPH
}

function isHeadCommit(commit: GitLogCommitRow): boolean {
  return commit.refs.some((ref) => ref === 'HEAD' || ref.startsWith('HEAD ->'))
}

export type LogInkHistoryCommitItem = {
  type: 'commit'
  commit: GitLogCommitRow
  graph: string
  /**
   * Lane-colored segments for the rendered graph prefix. Only attached
   * in full graph mode; compact mode renders a single `*` per commit so
   * lane tracking is not meaningful and segments stay undefined.
   */
  laneSegments?: LaneSegment[]
  selected: boolean
}

export type LogInkHistoryGraphItem = {
  type: 'graph'
  graph: string
  laneSegments?: LaneSegment[]
  /**
   * True for the synthetic vertical-only rows we inject between two
   * commits to give linear-history stretches a comfortable rhythm,
   * false (or undefined) for git's own topology rows (`|/` close,
   * `|\` fork). The renderer uses this to keep spacers at full lane
   * brightness — they read as "this is the same lane, continuing" —
   * while topology rows stay dimmed as scaffolding that should
   * recede behind the commits they connect.
   */
  spacer?: boolean
}

export type LogInkHistoryItem = LogInkHistoryCommitItem | LogInkHistoryGraphItem

export type VisibleLogInkHistory = {
  graphWidth: number
  items: LogInkHistoryItem[]
}

function clampWindowStart(index: number, count: number, visibleCount: number): number {
  return Math.max(0, Math.min(index - Math.floor(visibleCount / 2), Math.max(0, count - visibleCount)))
}

function commitKey(commit: GitLogCommitRow): string {
  return commit.hash || commit.shortHash
}

function graphWidth(items: LogInkHistoryItem[]): number {
  return Math.max(1, ...items.map((item) => item.graph.length))
}

function toCompactItems(state: LogInkState, visibleCount: number): LogInkHistoryItem[] {
  const start = clampWindowStart(state.selectedIndex, state.filteredCommits.length, visibleCount)

  return state.filteredCommits.slice(start, start + visibleCount).map((commit, offset) => ({
    type: 'commit',
    commit,
    graph: '*',
    // Compact mode skips lane tracking (no topology to color) but still
    // wants the merge / HEAD glyph so the user can spot them at a
    // glance. Lane id stays undefined so the segment renders muted —
    // matching the legacy compact appearance, just with a richer glyph.
    laneSegments: [{ text: commitGlyphFor(commit), laneId: undefined }],
    selected: start + offset === state.selectedIndex,
  }))
}

function isSelectedCommit(row: GitLogRow, selected: GitLogCommitRow | undefined): boolean {
  return row.type === 'commit' && selected ? commitKey(row) === commitKey(selected) : false
}

/**
 * Build the vertical-only graph string that follows a commit row when
 * `withSpacers` is enabled. Every commit-cell glyph (`*`) is rewritten
 * to a lane bar (`|`) so the synthetic row continues every open lane
 * without re-rendering the commit dot. All other graph chars pass
 * through unchanged, so a commit graph like `* | |` becomes `| | |`.
 */
function buildSpacerGraph(commitGraph: string): string {
  return commitGraph.replace(/\*/g, '|')
}

type ExpandedRow =
  | { kind: 'source'; row: GitLogRow }
  | { kind: 'spacer'; sourceCommit: GitLogCommitRow }

/**
 * Walk `state.rows` and inject a synthetic spacer entry after every
 * commit row when `withSpacers` is true. The spacer is a graph-only
 * row that renders as `|` per active lane so consecutive commits have
 * a clear vertical rhythm without losing topology continuity.
 *
 * The spacer is suppressed in two cases where it would create visible
 * "tearing" on the graph column:
 *
 *   1. The next row is git's own graph-only topology row (`|\` /
 *      `|/` / `| |`). That row already provides vertical breathing
 *      AND draws the lane transition; sandwiching our spacer between
 *      the commit and the transition produces an extra all-pipes row
 *      that reads as misalignment.
 *
 *   2. The current commit's graph contains a backslash or forward
 *      slash (the compressed forms git uses for `*\` / `*` followed
 *      by slash, when it draws the fork on the same row as the
 *      commit). The spacer's commit-glyph → lane-bar rewrite would
 *      leave the diagonal intact, rendering a second corner glyph
 *      immediately below the merge — a duplicate that looks like a
 *      glyph stutter.
 *
 * When `withSpacers` is false the list is identity-mapped from
 * source rows, preserving the legacy zero-padding behavior for any
 * caller that wants raw git topology (filters, tests, etc.).
 */
function commitGraphIsSimple(graph: string): boolean {
  return !/[\\/]/.test(graph)
}

function expandRowsWithSpacers(rows: GitLogRow[], withSpacers: boolean): ExpandedRow[] {
  const out: ExpandedRow[] = []
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]
    out.push({ kind: 'source', row })
    if (!withSpacers || row.type !== 'commit') continue
    if (!commitGraphIsSimple(row.graph || '*')) continue
    const next = rows[i + 1]
    if (next && next.type === 'graph') continue
    out.push({ kind: 'spacer', sourceCommit: row })
  }
  return out
}

function toFullGraphItems(
  state: LogInkState,
  visibleCount: number,
  options: { withSpacers: boolean } = { withSpacers: false }
): LogInkHistoryItem[] {
  const selected = state.filteredCommits[state.selectedIndex]
  const expanded = expandRowsWithSpacers(state.rows, options.withSpacers)
  const selectedExpandedIndex = expanded.findIndex(
    (entry) => entry.kind === 'source' && isSelectedCommit(entry.row, selected)
  )
  const start = clampWindowStart(
    selectedExpandedIndex >= 0 ? selectedExpandedIndex : 0,
    expanded.length,
    visibleCount
  )

  // Lane tracking is order-dependent — fast-forward the tracker through
  // every row above the visible window so lane ids stay stable as the
  // user scrolls. Without this, scrolling would re-color lanes from a
  // fresh tracker each time. Spacers contribute their vertical-only
  // graph to the prefix so the tracker sees a no-op advance and lane
  // state stays consistent at the window boundary.
  const tracker = createLaneTrackerState()
  const prefixGraphs: string[] = []
  for (let k = 0; k < start; k += 1) {
    const entry = expanded[k]
    if (entry.kind === 'spacer') {
      prefixGraphs.push(buildSpacerGraph(entry.sourceCommit.graph || '*'))
      continue
    }
    prefixGraphs.push(
      entry.row.type === 'commit' ? entry.row.graph || '*' : entry.row.graph
    )
  }
  advanceTrackerThrough(prefixGraphs, tracker, prefixGraphs.length)

  return expanded.slice(start, start + visibleCount).map((entry) => {
    if (entry.kind === 'spacer') {
      const graph = buildSpacerGraph(entry.sourceCommit.graph || '*')
      return {
        type: 'graph',
        graph,
        laneSegments: renderGraphRowSegments(graph, tracker, { ascii: false }),
        spacer: true,
      }
    }

    const { row } = entry
    if (row.type === 'graph') {
      return {
        type: 'graph',
        graph: row.graph,
        laneSegments: renderGraphRowSegments(row.graph, tracker, { ascii: false }),
      }
    }

    const graph = row.graph || '*'
    const commitGlyph = commitGlyphFor(row)
    return {
      type: 'commit',
      commit: row,
      graph,
      laneSegments: renderGraphRowSegments(graph, tracker, { ascii: false, commitGlyph }),
      selected: isSelectedCommit(row, selected),
    }
  })
}

export type GetVisibleLogInkHistoryOptions = {
  /**
   * When true and we're in full-graph mode, inject a vertical-only
   * graph row after every commit row so consecutive commits have a
   * comfortable vertical rhythm. Off by default to keep tests and
   * non-rendering callers (filters, snapshots) on the legacy zero
   * padding.
   */
  fullGraphSpacing?: boolean
}

export function getVisibleLogInkHistory(
  state: LogInkState,
  visibleCount: number,
  options: GetVisibleLogInkHistoryOptions = {}
): VisibleLogInkHistory {
  const items = state.fullGraph && !state.filter
    ? toFullGraphItems(state, visibleCount, { withSpacers: Boolean(options.fullGraphSpacing) })
    : toCompactItems(state, visibleCount)

  return {
    graphWidth: graphWidth(items),
    items,
  }
}

export function formatInkRefLabels(refs: string[]): string {
  return refs.length ? ` ${refs.map((ref) => `[${ref}]`).join(' ')}` : ''
}

export function formatInkHistoryGraphRow(row: GitLogGraphRow, width: number): string {
  return row.graph.padEnd(width)
}
