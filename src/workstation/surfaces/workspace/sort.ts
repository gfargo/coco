import type { WorkspaceRepoSummary } from '../../../git/workspaceData'

/**
 * Sort modes for the workspace surface (#880). Cycle order is
 * intentional: most users want recency first ("which repos have I
 * touched recently"), name second ("alphabetical for memory"),
 * dirty third ("what needs commits before EOD"). Each subsequent tap
 * of the sort key advances along this cycle.
 */
export const WORKSPACE_SORT_MODES = ['recency', 'name', 'dirty'] as const

export type WorkspaceSortMode = (typeof WORKSPACE_SORT_MODES)[number]

const SORT_LABELS: Record<WorkspaceSortMode, string> = {
  recency: 'Recent',
  name: 'Name',
  dirty: 'Dirty',
}

export function nextWorkspaceSortMode(current: WorkspaceSortMode): WorkspaceSortMode {
  const idx = WORKSPACE_SORT_MODES.indexOf(current)
  return WORKSPACE_SORT_MODES[(idx + 1) % WORKSPACE_SORT_MODES.length]
}

export function workspaceSortLabel(mode: WorkspaceSortMode): string {
  return SORT_LABELS[mode]
}

function nameComparator(a: WorkspaceRepoSummary, b: WorkspaceRepoSummary): number {
  return a.name.localeCompare(b.name)
}

function recencyComparator(a: WorkspaceRepoSummary, b: WorkspaceRepoSummary): number {
  const aDate = a.lastCommit?.date ?? ''
  const bDate = b.lastCommit?.date ?? ''
  // Newer first — string compare on ISO-8601 dates is correct ordering.
  if (aDate === bDate) {
    return nameComparator(a, b)
  }
  return aDate < bDate ? 1 : -1
}

function dirtyComparator(a: WorkspaceRepoSummary, b: WorkspaceRepoSummary): number {
  if (a.dirty === b.dirty) {
    return recencyComparator(a, b)
  }
  return b.dirty - a.dirty
}

/**
 * Stable sort: never mutates the input. The caller passes the array
 * straight from state, the reducer slices into the result.
 */
export function sortWorkspaceRepos(
  repos: ReadonlyArray<WorkspaceRepoSummary>,
  mode: WorkspaceSortMode
): WorkspaceRepoSummary[] {
  const copy = [...repos]
  switch (mode) {
    case 'name':
      copy.sort(nameComparator)
      break
    case 'dirty':
      copy.sort(dirtyComparator)
      break
    case 'recency':
    default:
      copy.sort(recencyComparator)
      break
  }
  return copy
}
