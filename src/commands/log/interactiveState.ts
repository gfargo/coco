import { GitLogCommitRow, GitLogRow, getCommitRows } from './data'

export type LogTuiState = {
  rows: GitLogRow[]
  commits: GitLogCommitRow[]
  filteredCommits: GitLogCommitRow[]
  selectedIndex: number
  filter: string
  filterMode: boolean
  fullGraph: boolean
  showHelp: boolean
}

export type LogTuiAction =
  | { type: 'move'; delta: number }
  | { type: 'page'; delta: number }
  | { type: 'setFilter'; value: string }
  | { type: 'appendFilter'; value: string }
  | { type: 'backspaceFilter' }
  | { type: 'clearFilter' }
  | { type: 'toggleFilterMode' }
  | { type: 'toggleGraph' }
  | { type: 'toggleHelp' }

function matchesFilter(commit: GitLogCommitRow, filter: string): boolean {
  const value = filter.trim().toLowerCase()

  if (!value) {
    return true
  }

  return [
    commit.shortHash,
    commit.hash,
    commit.date,
    commit.author,
    commit.message,
    ...commit.refs,
  ].some((field) => field.toLowerCase().includes(value))
}

function filterCommits(commits: GitLogCommitRow[], filter: string): GitLogCommitRow[] {
  return commits.filter((commit) => matchesFilter(commit, filter))
}

function clampIndex(index: number, length: number): number {
  if (length === 0) {
    return 0
  }

  return Math.max(0, Math.min(index, length - 1))
}

function withFilter(state: LogTuiState, filter: string): LogTuiState {
  const filteredCommits = filterCommits(state.commits, filter)

  return {
    ...state,
    filter,
    filteredCommits,
    selectedIndex: clampIndex(state.selectedIndex, filteredCommits.length),
  }
}

export function createLogTuiState(rows: GitLogRow[]): LogTuiState {
  const commits = getCommitRows(rows)

  return {
    rows,
    commits,
    filteredCommits: commits,
    selectedIndex: 0,
    filter: '',
    filterMode: false,
    fullGraph: false,
    showHelp: true,
  }
}

export function getSelectedCommit(state: LogTuiState): GitLogCommitRow | undefined {
  return state.filteredCommits[state.selectedIndex]
}

export function applyLogTuiAction(state: LogTuiState, action: LogTuiAction): LogTuiState {
  switch (action.type) {
    case 'move':
      return {
        ...state,
        selectedIndex: clampIndex(state.selectedIndex + action.delta, state.filteredCommits.length),
      }
    case 'page':
      return {
        ...state,
        selectedIndex: clampIndex(state.selectedIndex + action.delta, state.filteredCommits.length),
      }
    case 'setFilter':
      return withFilter(state, action.value)
    case 'appendFilter':
      return withFilter(state, `${state.filter}${action.value}`)
    case 'backspaceFilter':
      return withFilter(state, state.filter.slice(0, -1))
    case 'clearFilter':
      return withFilter({
        ...state,
        filterMode: false,
      }, '')
    case 'toggleFilterMode':
      return {
        ...state,
        filterMode: !state.filterMode,
      }
    case 'toggleGraph':
      return {
        ...state,
        fullGraph: !state.fullGraph,
      }
    case 'toggleHelp':
      return {
        ...state,
        showHelp: !state.showHelp,
      }
    default:
      return state
  }
}
