import { GitLogCommitRow, GitLogGraphRow, GitLogRow } from './data'
import {
  LaneSegment,
  advanceTrackerThrough,
  createLaneTrackerState,
  renderGraphRowSegments,
} from './inkGraphLanes'
import { LogInkState } from './inkViewModel'

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
    selected: start + offset === state.selectedIndex,
  }))
}

function isSelectedCommit(row: GitLogRow, selected: GitLogCommitRow | undefined): boolean {
  return row.type === 'commit' && selected ? commitKey(row) === commitKey(selected) : false
}

function toFullGraphItems(state: LogInkState, visibleCount: number): LogInkHistoryItem[] {
  const selected = state.filteredCommits[state.selectedIndex]
  const selectedRowIndex = state.rows.findIndex((row) => isSelectedCommit(row, selected))
  const start = clampWindowStart(
    selectedRowIndex >= 0 ? selectedRowIndex : 0,
    state.rows.length,
    visibleCount
  )

  // Lane tracking is order-dependent — fast-forward the tracker through
  // every row above the visible window so lane ids stay stable as the
  // user scrolls. Without this, scrolling would re-color lanes from a
  // fresh tracker each time.
  const tracker = createLaneTrackerState()
  const allGraphs = state.rows.map((row) => (row.type === 'commit' ? row.graph || '*' : row.graph))
  advanceTrackerThrough(allGraphs, tracker, start)

  return state.rows.slice(start, start + visibleCount).map((row) => {
    if (row.type === 'graph') {
      return {
        type: 'graph',
        graph: row.graph,
        laneSegments: renderGraphRowSegments(row.graph, tracker, { ascii: false }),
      }
    }

    const graph = row.graph || '*'
    return {
      type: 'commit',
      commit: row,
      graph,
      laneSegments: renderGraphRowSegments(graph, tracker, { ascii: false }),
      selected: isSelectedCommit(row, selected),
    }
  })
}

export function getVisibleLogInkHistory(
  state: LogInkState,
  visibleCount: number
): VisibleLogInkHistory {
  const items = state.fullGraph && !state.filter
    ? toFullGraphItems(state, visibleCount)
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
