import { GitLogCommitRow, GitLogRow, getCommitRows } from './data'

export type LogInkFocus = 'sidebar' | 'commits' | 'detail'

export type LogInkSidebarTab = 'status' | 'branches' | 'tags' | 'stashes' | 'worktrees'

export type LogInkState = {
  rows: GitLogRow[]
  commits: GitLogCommitRow[]
  filteredCommits: GitLogCommitRow[]
  selectedIndex: number
  filter: string
  filterMode: boolean
  fullGraph: boolean
  showHelp: boolean
  showCommandPalette: boolean
  focus: LogInkFocus
  sidebarTab: LogInkSidebarTab
  statusMessage?: string
}

export type LogInkAction =
  | { type: 'appendFilter'; value: string }
  | { type: 'backspaceFilter' }
  | { type: 'clearFilter' }
  | { type: 'focusNext' }
  | { type: 'focusPrevious' }
  | { type: 'move'; delta: number }
  | { type: 'nextSidebarTab' }
  | { type: 'page'; delta: number }
  | { type: 'previousSidebarTab' }
  | { type: 'setFilter'; value: string }
  | { type: 'setFocus'; value: LogInkFocus }
  | { type: 'setSidebarTab'; value: LogInkSidebarTab }
  | { type: 'setStatus'; value?: string }
  | { type: 'toggleFilterMode' }
  | { type: 'toggleGraph' }
  | { type: 'toggleHelp' }
  | { type: 'toggleCommandPalette' }

const FOCUS_ORDER: LogInkFocus[] = ['sidebar', 'commits', 'detail']
const SIDEBAR_TABS: LogInkSidebarTab[] = ['status', 'branches', 'tags', 'stashes', 'worktrees']

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

function cycleValue<T>(values: T[], current: T, delta: number): T {
  const currentIndex = Math.max(0, values.indexOf(current))
  const nextIndex = (currentIndex + delta + values.length) % values.length

  return values[nextIndex]
}

function withFilter(state: LogInkState, filter: string): LogInkState {
  const filteredCommits = filterCommits(state.commits, filter)

  return {
    ...state,
    filter,
    filteredCommits,
    selectedIndex: clampIndex(state.selectedIndex, filteredCommits.length),
  }
}

export function getLogInkSidebarTabs(): LogInkSidebarTab[] {
  return [...SIDEBAR_TABS]
}

export function createLogInkState(rows: GitLogRow[]): LogInkState {
  const commits = getCommitRows(rows)

  return {
    rows,
    commits,
    filteredCommits: commits,
    selectedIndex: 0,
    filter: '',
    filterMode: false,
    fullGraph: false,
    showHelp: false,
    showCommandPalette: false,
    focus: 'commits',
    sidebarTab: 'status',
  }
}

export function getSelectedInkCommit(state: LogInkState): GitLogCommitRow | undefined {
  return state.filteredCommits[state.selectedIndex]
}

export function applyLogInkAction(state: LogInkState, action: LogInkAction): LogInkState {
  switch (action.type) {
    case 'appendFilter':
      return withFilter(state, `${state.filter}${action.value}`)
    case 'backspaceFilter':
      return withFilter(state, state.filter.slice(0, -1))
    case 'clearFilter':
      return withFilter({
        ...state,
        filterMode: false,
      }, '')
    case 'focusNext':
      return {
        ...state,
        focus: cycleValue(FOCUS_ORDER, state.focus, 1),
      }
    case 'focusPrevious':
      return {
        ...state,
        focus: cycleValue(FOCUS_ORDER, state.focus, -1),
      }
    case 'move':
      return {
        ...state,
        selectedIndex: clampIndex(state.selectedIndex + action.delta, state.filteredCommits.length),
      }
    case 'nextSidebarTab':
      return {
        ...state,
        sidebarTab: cycleValue(SIDEBAR_TABS, state.sidebarTab, 1),
      }
    case 'page':
      return {
        ...state,
        selectedIndex: clampIndex(state.selectedIndex + action.delta, state.filteredCommits.length),
      }
    case 'previousSidebarTab':
      return {
        ...state,
        sidebarTab: cycleValue(SIDEBAR_TABS, state.sidebarTab, -1),
      }
    case 'setFilter':
      return withFilter(state, action.value)
    case 'setFocus':
      return {
        ...state,
        focus: action.value,
      }
    case 'setSidebarTab':
      return {
        ...state,
        sidebarTab: action.value,
      }
    case 'setStatus':
      return {
        ...state,
        statusMessage: action.value,
      }
    case 'toggleFilterMode':
      return {
        ...state,
        filterMode: !state.filterMode,
        showCommandPalette: false,
        showHelp: false,
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
        showCommandPalette: false,
      }
    case 'toggleCommandPalette':
      return {
        ...state,
        showCommandPalette: !state.showCommandPalette,
        showHelp: false,
      }
    default:
      return state
  }
}
