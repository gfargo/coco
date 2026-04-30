import { GitLogCommitRow, GitLogRow, getCommitRows } from './data'

export type LogInkFocus = 'sidebar' | 'commits' | 'detail'

export type LogInkSidebarTab = 'status' | 'branches' | 'tags' | 'stashes' | 'worktrees'

export type LogInkState = {
  rows: GitLogRow[]
  commits: GitLogCommitRow[]
  filteredCommits: GitLogCommitRow[]
  selectedIndex: number
  selectedFileIndex: number
  diffPreviewOffset: number
  filter: string
  filterMode: boolean
  fullGraph: boolean
  showHelp: boolean
  showCommandPalette: boolean
  workflowActionId?: string
  pendingConfirmationId?: string
  pendingKey?: string
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
  | { type: 'moveDetailFile'; delta: number; fileCount: number }
  | { type: 'moveToBottom' }
  | { type: 'moveToTop' }
  | { type: 'nextSidebarTab' }
  | { type: 'page'; delta: number }
  | { type: 'pageDetailPreview'; delta: number; previewLineCount: number }
  | { type: 'previousSidebarTab' }
  | { type: 'setFilter'; value: string }
  | { type: 'setFocus'; value: LogInkFocus }
  | { type: 'setPendingKey'; value?: string }
  | { type: 'setSidebarTab'; value: LogInkSidebarTab }
  | { type: 'setStatus'; value?: string }
  | { type: 'setWorkflowAction'; value?: string }
  | { type: 'setPendingConfirmation'; value?: string }
  | { type: 'toggleFilterMode' }
  | { type: 'toggleGraph' }
  | { type: 'toggleHelp' }
  | { type: 'toggleCommandPalette' }

const FOCUS_ORDER: LogInkFocus[] = ['sidebar', 'commits', 'detail']
const SIDEBAR_TABS: LogInkSidebarTab[] = ['status', 'branches', 'tags', 'stashes', 'worktrees']

function searchableFields(commit: GitLogCommitRow): string[] {
  return [
    commit.shortHash,
    commit.hash,
    commit.date,
    commit.author,
    commit.message,
    ...commit.refs,
  ]
}

function scoreField(field: string, term: string): number | undefined {
  const value = field.toLowerCase()
  const normalized = term.toLowerCase()

  if (!normalized) {
    return 0
  }

  if (value === normalized) {
    return 1000
  }

  if (value.startsWith(normalized)) {
    return 800 - Math.min(value.length - normalized.length, 200)
  }

  const substringIndex = value.indexOf(normalized)

  if (substringIndex >= 0) {
    return 600 - Math.min(substringIndex, 200)
  }

  let searchIndex = 0
  let distance = 0

  for (const character of normalized) {
    const nextIndex = value.indexOf(character, searchIndex)

    if (nextIndex < 0) {
      return undefined
    }

    distance += nextIndex - searchIndex
    searchIndex = nextIndex + 1
  }

  return 300 - Math.min(distance, 200)
}

export function scoreLogInkCommitFilter(commit: GitLogCommitRow, filter: string): number | undefined {
  const terms = filter.trim().split(/\s+/).filter(Boolean)

  if (terms.length === 0) {
    return 0
  }

  const fields = searchableFields(commit)
  let score = 0

  for (const term of terms) {
    const bestFieldScore = fields.reduce<number | undefined>((best, field) => {
      const fieldScore = scoreField(field, term)

      if (fieldScore === undefined) {
        return best
      }

      return best === undefined ? fieldScore : Math.max(best, fieldScore)
    }, undefined)

    if (bestFieldScore === undefined) {
      return undefined
    }

    score += bestFieldScore
  }

  return score
}

function filterCommits(commits: GitLogCommitRow[], filter: string): GitLogCommitRow[] {
  return commits
    .map((commit, index) => ({
      commit,
      index,
      score: scoreLogInkCommitFilter(commit, filter),
    }))
    .filter((entry): entry is { commit: GitLogCommitRow; index: number; score: number } =>
      entry.score !== undefined
    )
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.commit)
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
    selectedFileIndex: 0,
    diffPreviewOffset: 0,
    pendingKey: undefined,
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
    selectedFileIndex: 0,
    diffPreviewOffset: 0,
    filter: '',
    filterMode: false,
    fullGraph: false,
    showHelp: false,
    showCommandPalette: false,
    workflowActionId: undefined,
    pendingConfirmationId: undefined,
    pendingKey: undefined,
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
        pendingKey: undefined,
      }
    case 'focusPrevious':
      return {
        ...state,
        focus: cycleValue(FOCUS_ORDER, state.focus, -1),
        pendingKey: undefined,
      }
    case 'move':
      return {
        ...state,
        selectedIndex: clampIndex(state.selectedIndex + action.delta, state.filteredCommits.length),
        selectedFileIndex: 0,
        diffPreviewOffset: 0,
        pendingKey: undefined,
      }
    case 'moveDetailFile':
      return {
        ...state,
        selectedFileIndex: clampIndex(state.selectedFileIndex + action.delta, action.fileCount),
        diffPreviewOffset: 0,
        pendingKey: undefined,
      }
    case 'moveToBottom':
      return {
        ...state,
        selectedIndex: clampIndex(state.filteredCommits.length - 1, state.filteredCommits.length),
        selectedFileIndex: 0,
        diffPreviewOffset: 0,
        pendingKey: undefined,
      }
    case 'moveToTop':
      return {
        ...state,
        selectedIndex: 0,
        selectedFileIndex: 0,
        diffPreviewOffset: 0,
        pendingKey: undefined,
      }
    case 'nextSidebarTab':
      return {
        ...state,
        sidebarTab: cycleValue(SIDEBAR_TABS, state.sidebarTab, 1),
        pendingKey: undefined,
      }
    case 'page':
      return {
        ...state,
        selectedIndex: clampIndex(state.selectedIndex + action.delta, state.filteredCommits.length),
        selectedFileIndex: 0,
        diffPreviewOffset: 0,
        pendingKey: undefined,
      }
    case 'pageDetailPreview':
      return {
        ...state,
        diffPreviewOffset: clampIndex(
          state.diffPreviewOffset + action.delta,
          action.previewLineCount
        ),
        pendingKey: undefined,
      }
    case 'previousSidebarTab':
      return {
        ...state,
        sidebarTab: cycleValue(SIDEBAR_TABS, state.sidebarTab, -1),
        pendingKey: undefined,
      }
    case 'setFilter':
      return withFilter(state, action.value)
    case 'setFocus':
      return {
        ...state,
        focus: action.value,
        pendingKey: undefined,
      }
    case 'setPendingKey':
      return {
        ...state,
        pendingKey: action.value,
      }
    case 'setSidebarTab':
      return {
        ...state,
        sidebarTab: action.value,
        focus: 'sidebar',
        pendingKey: undefined,
      }
    case 'setStatus':
      return {
        ...state,
        statusMessage: action.value,
        pendingKey: undefined,
      }
    case 'setWorkflowAction':
      return {
        ...state,
        workflowActionId: action.value,
        pendingConfirmationId: undefined,
        pendingKey: undefined,
      }
    case 'setPendingConfirmation':
      return {
        ...state,
        pendingConfirmationId: action.value,
        workflowActionId: action.value ? undefined : state.workflowActionId,
        pendingKey: undefined,
      }
    case 'toggleFilterMode':
      return {
        ...state,
        filterMode: !state.filterMode,
        showCommandPalette: false,
        showHelp: false,
        pendingKey: undefined,
      }
    case 'toggleGraph':
      return {
        ...state,
        fullGraph: !state.fullGraph,
        pendingKey: undefined,
      }
    case 'toggleHelp':
      return {
        ...state,
        showHelp: !state.showHelp,
        showCommandPalette: false,
        pendingKey: undefined,
      }
    case 'toggleCommandPalette':
      return {
        ...state,
        showCommandPalette: !state.showCommandPalette,
        showHelp: false,
        pendingKey: undefined,
      }
    default:
      return state
  }
}
