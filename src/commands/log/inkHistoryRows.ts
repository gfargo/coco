import { GitLogCommitRow, GitLogGraphRow, GitLogRow } from './data'
import { LogInkState } from './inkViewModel'

export type LogInkHistoryCommitItem = {
  type: 'commit'
  commit: GitLogCommitRow
  graph: string
  selected: boolean
}

export type LogInkHistoryGraphItem = {
  type: 'graph'
  graph: string
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

  return state.rows.slice(start, start + visibleCount).map((row) => {
    if (row.type === 'graph') {
      return {
        type: 'graph',
        graph: row.graph,
      }
    }

    return {
      type: 'commit',
      commit: row,
      graph: row.graph || '*',
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
