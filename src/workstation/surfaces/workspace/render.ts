import type { WorkspaceRepoSummary } from '../../../git/workspaceData'
import { truncateCells, truncatePathCells } from '../../chrome/text'
import {
  workspaceTabLabel,
  WORKSPACE_TABS,
  type WorkspaceTab,
} from './filter'
import {
  workspaceSortLabel,
  type WorkspaceSortMode,
} from './sort'
import { selectVisibleRepos, type WorkspaceState } from './state'

/**
 * Pure render layer for the workspace surface (#880). Each helper
 * returns a structural model (rows, cells, label/dim flags) rather
 * than React/Ink elements so the runtime layer can map these models
 * into `<Text>` nodes and unit tests can assert against plain data.
 */

export type WorkspaceListColumn = {
  /** Right-padded text — already truncated to the column width. */
  text: string
  /** True for the column that should grow on screen (the name). */
  primary?: boolean
  /** Hint for the renderer: `'dim'` for muted, `'warn'` for behind/dirty. */
  tone?: 'default' | 'dim' | 'warn' | 'ok'
}

export type WorkspaceListRow = {
  repo: WorkspaceRepoSummary
  cursor: boolean
  columns: WorkspaceListColumn[]
}

export type WorkspaceSidebarTabRow = {
  tab: WorkspaceTab
  label: string
  active: boolean
  /** True when this tab is unavailable (e.g. PRs without gh auth). */
  disabled: boolean
}

const NAME_WIDTH = 28
const BRANCH_WIDTH = 22
const STATUS_WIDTH = 14
const DATE_WIDTH = 11
const PATH_WIDTH = 40

function formatStatusCell(repo: WorkspaceRepoSummary, ghAuthenticated?: boolean, prCount?: number): WorkspaceListColumn {
  const tokens: string[] = []
  if (repo.dirty > 0) {
    tokens.push(`●${repo.dirty}`)
  }
  if (repo.ahead > 0) {
    tokens.push(`↑${repo.ahead}`)
  }
  if (repo.behind > 0) {
    tokens.push(`↓${repo.behind}`)
  }
  if (ghAuthenticated && typeof prCount === 'number' && prCount > 0) {
    tokens.push(`pr${prCount}`)
  }
  const text = tokens.length === 0 ? '·' : tokens.join(' ')
  const tone: WorkspaceListColumn['tone'] = repo.behind > 0 || repo.dirty > 0 ? 'warn' : 'dim'
  return { text: truncateCells(text, STATUS_WIDTH), tone }
}

function formatDateCell(repo: WorkspaceRepoSummary): WorkspaceListColumn {
  const date = repo.lastCommit?.date
  if (!date) {
    return { text: truncateCells('—', DATE_WIDTH), tone: 'dim' }
  }
  // Trim ISO date to YYYY-MM-DD — full precision is noise in the row.
  return { text: truncateCells(date.slice(0, 10), DATE_WIDTH), tone: 'dim' }
}

export function buildWorkspaceListRows(state: WorkspaceState): WorkspaceListRow[] {
  const visible = selectVisibleRepos(state)
  return visible.map((repo, index) => {
    const cursor = index === state.selectedIndex
    const nameTone: WorkspaceListColumn['tone'] = repo.error ? 'warn' : 'default'
    const name: WorkspaceListColumn = {
      text: truncateCells(repo.name, NAME_WIDTH),
      primary: true,
      tone: nameTone,
    }
    const branch: WorkspaceListColumn = {
      text: truncateCells(repo.branch ?? '—', BRANCH_WIDTH),
      tone: repo.branch ? 'default' : 'dim',
    }
    const status = formatStatusCell(repo, state.ghAuthenticated, state.pullRequestCounts[repo.path])
    const date = formatDateCell(repo)
    const path: WorkspaceListColumn = {
      text: truncatePathCells(repo.path, PATH_WIDTH),
      tone: 'dim',
    }
    return {
      repo,
      cursor,
      columns: [name, branch, status, date, path],
    }
  })
}

export function buildWorkspaceSidebar(state: WorkspaceState): WorkspaceSidebarTabRow[] {
  return WORKSPACE_TABS.map((tab) => {
    const disabled = tab === 'pull-requests' && state.ghAuthenticated === false
    return {
      tab,
      label: workspaceTabLabel(tab),
      active: state.tab === tab,
      disabled,
    }
  })
}

export type WorkspaceHeaderModel = {
  appLabel: string
  scannedAt?: string
  rootsLabel: string
  repoCount: number
  visibleCount: number
  sortLabel: string
  loading: boolean
  filter?: string
}

export function buildWorkspaceHeader(
  state: WorkspaceState,
  options: { appLabel?: string } = {}
): WorkspaceHeaderModel {
  return {
    appLabel: options.appLabel ?? 'coco workspace',
    scannedAt: state.overview.scannedAt,
    rootsLabel: state.roots.join(', '),
    repoCount: state.overview.repos.length,
    visibleCount: selectVisibleRepos(state).length,
    sortLabel: workspaceSortLabel(state.sortMode),
    loading: state.loading,
    filter: state.filter || undefined,
  }
}

export type WorkspaceFooterModel = {
  hint: string
  status?: string
  filterMode: boolean
}

const LIST_HINT = 'j/k move · enter open · tab tab · s sort · / filter · r refresh · a add · q quit'
const FILTER_HINT = 'type filter · enter to apply · esc to clear'
const ADD_REPO_HINT = 'type path · tab to complete · enter to add · esc to cancel'

function hintFor(focus: WorkspaceState['focus']): string {
  switch (focus) {
    case 'filter':
      return FILTER_HINT
    case 'add-repo':
      return ADD_REPO_HINT
    case 'list':
    default:
      return LIST_HINT
  }
}

export function buildWorkspaceFooter(state: WorkspaceState): WorkspaceFooterModel {
  return {
    hint: hintFor(state.focus),
    status: state.status,
    filterMode: state.focus === 'filter',
  }
}

export function describeSortModesForLegend(): Record<WorkspaceSortMode, string> {
  return {
    recency: 'Most-recent commit first',
    name: 'Alphabetical',
    dirty: 'Most working-tree changes first',
  }
}

export type WorkspaceHelpRow = {
  keys: string
  description: string
}

/**
 * Keymap legend rendered by the help overlay (`?`). Sectionless flat
 * list so the overlay stays short — every binding fits in one screen
 * even on a 24-row terminal.
 */
export function buildWorkspaceHelpRows(): WorkspaceHelpRow[] {
  return [
    { keys: 'j / ↓', description: 'Move cursor down' },
    { keys: 'k / ↑', description: 'Move cursor up' },
    { keys: 'g / G', description: 'Jump to top / bottom' },
    { keys: 'enter', description: 'Drill into the cursored repo (coco ui)' },
    { keys: 'tab / shift-tab', description: 'Cycle sidebar tab forward / backward' },
    { keys: 'h / l', description: 'Cycle sidebar tab (Vim-style)' },
    { keys: 's', description: 'Cycle sort mode (recency → name → dirty)' },
    { keys: '/', description: 'Filter the list by name or branch' },
    { keys: 'r', description: 'Refresh discovery' },
    { keys: 'a', description: 'Add a repo via path prompt (tab-completes)' },
    { keys: '?', description: 'Toggle this help overlay' },
    { keys: 'esc', description: 'Clear filter or close overlay' },
    { keys: 'q', description: 'Quit the workspace surface' },
  ]
}

export type WorkspaceOnboardingModel = {
  show: boolean
  /** Short hint shown on first run when discovery returns no repos. */
  emptyHint?: string
  /** Short hint shown on first run when discovery returned repos. */
  populatedHint?: string
}

export function buildWorkspaceOnboarding(state: WorkspaceState): WorkspaceOnboardingModel {
  if (!state.showOnboarding) {
    return { show: false }
  }
  const empty = state.overview.repos.length === 0
  return {
    show: true,
    emptyHint: empty
      ? 'No repos found. Press `a` to add one by path, or set workspace.roots in your config.'
      : undefined,
    populatedHint: empty
      ? undefined
      : 'Press `enter` to open a repo · `?` for the full keymap · `a` to add a repo by path.',
  }
}
