import { GitLogCommitRow, GitLogRow, getCommitRows } from '../../git/logData'

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
