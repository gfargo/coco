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

/**
 * Responsive column widths for the workspace row list.
 *
 * Columns in display order, paired with a minimum cell width and a
 * growth weight. The cursor caret + per-cell separators are reserved
 * by the layout helper, so the budget passed in here is purely the
 * cell-content width.
 *
 * Drop priority on a narrow terminal: path → date → status → branch.
 * Name always stays.
 */
export type WorkspaceColumnKey = 'name' | 'branch' | 'status' | 'date' | 'subject' | 'path'

type ColumnSpec = {
  key: WorkspaceColumnKey
  min: number
  weight: number
  max?: number
}

const COLUMN_SPECS: ColumnSpec[] = [
  { key: 'name', min: 14, weight: 3, max: 36 },
  { key: 'branch', min: 12, weight: 2, max: 28 },
  { key: 'status', min: 8, weight: 1, max: 16 },
  { key: 'date', min: 10, weight: 0, max: 10 },
  // Subject grows aggressively at the expense of path so wide
  // terminals get a meaningful "what changed" line per row.
  { key: 'subject', min: 18, weight: 4, max: 60 },
  { key: 'path', min: 18, weight: 1 },
]

/** Inter-cell gap reserved by the layout helper. */
const COLUMN_GAP = 1
/** Width of the cursor caret prefix ("› " or "  "). */
const CURSOR_WIDTH = 2

export type WorkspaceColumnWidths = Partial<Record<WorkspaceColumnKey, number>>

/**
 * Resolve per-column widths from a body budget. Drops columns from
 * the tail when the budget can't fit their minimums; what survives
 * gets a share of the remaining slack proportional to each spec's
 * weight, capped at the column's `max`.
 */
export function assignWorkspaceColumnWidths(budget: number): WorkspaceColumnWidths {
  const usable = Math.max(0, budget - CURSOR_WIDTH)
  const kept: ColumnSpec[] = [...COLUMN_SPECS]
  while (kept.length > 0) {
    const minTotal = kept.reduce((acc, spec) => acc + spec.min, 0)
    const gapTotal = Math.max(0, kept.length - 1) * COLUMN_GAP
    if (minTotal + gapTotal <= usable) {
      break
    }
    kept.pop()
  }
  if (kept.length === 0) {
    return {}
  }
  const minTotal = kept.reduce((acc, spec) => acc + spec.min, 0)
  const gapTotal = Math.max(0, kept.length - 1) * COLUMN_GAP
  let slack = Math.max(0, usable - minTotal - gapTotal)
  const totalWeight = kept.reduce((acc, spec) => acc + spec.weight, 0) || 1
  const widths: WorkspaceColumnWidths = {}
  // First pass: distribute slack proportionally to weight, respecting
  // per-column max caps.
  for (const spec of kept) {
    const share = Math.floor((slack * spec.weight) / totalWeight)
    const targetMax = spec.max ?? Number.POSITIVE_INFINITY
    const grown = Math.min(spec.min + share, targetMax)
    widths[spec.key] = grown
  }
  // Second pass: any unspent slack (due to caps or rounding) tries to
  // land on the first uncapped column, otherwise drops on the floor.
  const used = Object.values(widths).reduce((acc, val) => acc + (val ?? 0), 0)
  slack = usable - used - gapTotal
  if (slack > 0) {
    for (const spec of kept) {
      const max = spec.max ?? Number.POSITIVE_INFINITY
      const current = widths[spec.key] ?? spec.min
      if (current < max) {
        const grow = Math.min(slack, max - current)
        widths[spec.key] = current + grow
        slack -= grow
        if (slack <= 0) {
          break
        }
      }
    }
  }
  return widths
}

function formatStatusCell(
  repo: WorkspaceRepoSummary,
  width: number,
  ghAuthenticated?: boolean,
  prCount?: number
): WorkspaceListColumn {
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
  return { text: truncateCells(text, width), tone }
}

function formatDateCell(repo: WorkspaceRepoSummary, width: number): WorkspaceListColumn {
  const date = repo.lastCommit?.date
  if (!date) {
    return { text: truncateCells('—', width), tone: 'dim' }
  }
  // Trim ISO date to YYYY-MM-DD — full precision is noise in the row.
  return { text: truncateCells(date.slice(0, 10), width), tone: 'dim' }
}

export type BuildWorkspaceListRowsOptions = {
  /** Available row width (before cursor + separators). Default 120. */
  width?: number
}

const DEFAULT_ROW_WIDTH = 120

export function buildWorkspaceListRows(
  state: WorkspaceState,
  options: BuildWorkspaceListRowsOptions = {}
): WorkspaceListRow[] {
  const visible = selectVisibleRepos(state)
  const widths = assignWorkspaceColumnWidths(options.width ?? DEFAULT_ROW_WIDTH)
  return visible.map((repo, index) => {
    const cursor = index === state.selectedIndex
    const nameTone: WorkspaceListColumn['tone'] = repo.error ? 'warn' : 'default'
    const columns: WorkspaceListColumn[] = []
    if (widths.name !== undefined) {
      columns.push({
        text: truncateCells(repo.name, widths.name),
        primary: true,
        tone: nameTone,
      })
    }
    if (widths.branch !== undefined) {
      columns.push({
        text: truncateCells(repo.branch ?? '—', widths.branch),
        tone: repo.branch ? 'default' : 'dim',
      })
    }
    if (widths.status !== undefined) {
      columns.push(
        formatStatusCell(repo, widths.status, state.ghAuthenticated, state.pullRequestCounts[repo.path])
      )
    }
    if (widths.date !== undefined) {
      columns.push(formatDateCell(repo, widths.date))
    }
    if (widths.subject !== undefined) {
      const subject = repo.lastCommit?.subject ?? '—'
      columns.push({
        text: truncateCells(subject, widths.subject),
        tone: repo.lastCommit?.subject ? 'default' : 'dim',
      })
    }
    if (widths.path !== undefined) {
      columns.push({
        text: truncatePathCells(repo.path, widths.path),
        tone: 'dim',
      })
    }
    return { repo, cursor, columns }
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

const LIST_HINT = 'j/k move · enter open · tab tab · s sort · / filter · r refresh · a add · d remove · ? help · q quit'
const FILTER_HINT = 'type filter · enter to apply · esc to clear'
const ADD_REPO_HINT = 'type path · tab to complete · enter to add · esc to cancel'
const CONFIRM_DELETE_HINT = 'press y to remove · any other key to cancel'

function hintFor(focus: WorkspaceState['focus']): string {
  switch (focus) {
    case 'filter':
      return FILTER_HINT
    case 'add-repo':
      return ADD_REPO_HINT
    case 'confirm-delete':
      return CONFIRM_DELETE_HINT
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
    { keys: 'd', description: 'Remove the cursored repo from the known-repos store (y-confirm)' },
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
