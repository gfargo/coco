/**
 * Sort modes for the promoted views (P4.2).
 *
 * Pure: takes existing context entries + the active mode, returns a sorted
 * copy. Tested in isolation; the runtime just calls these helpers.
 *
 * Display label uses `▼` (U+25BC) under truecolor / UTF-8 and falls back to
 * `v` under ASCII. Letters (`recent` / `name` / `ahead`) carry meaning;
 * shape enhances.
 */

import { BranchRef } from '../../git/branchData'
import { GitTagRef } from '../../git/tagData'

/* ------------------------------- branches ------------------------------- */

export type BranchSortMode = 'name' | 'recent' | 'ahead'

export const BRANCH_SORT_MODES: BranchSortMode[] = ['name', 'recent', 'ahead']

export const DEFAULT_BRANCH_SORT_MODE: BranchSortMode = 'name'

export function cycleBranchSort(mode: BranchSortMode): BranchSortMode {
  const index = BRANCH_SORT_MODES.indexOf(mode)
  if (index < 0) return BRANCH_SORT_MODES[0]
  return BRANCH_SORT_MODES[(index + 1) % BRANCH_SORT_MODES.length]
}

export function sortBranches<T extends BranchRef>(branches: T[], mode: BranchSortMode): T[] {
  // Pin the current branch at index 0 regardless of sort mode (#806
  // follow-up). Lands the user's cursor on the active branch by
  // default and keeps the most-relevant row glued to the top of the
  // list as they cycle sorts.
  const current = branches.find((entry) => entry.current)
  const rest = branches.filter((entry) => !entry.current)
  const sortedRest = rest.slice()
  switch (mode) {
    case 'name':
      sortedRest.sort((a, b) => a.shortName.localeCompare(b.shortName))
      break
    case 'recent':
      // ISO-shaped dates compare byte-for-byte; descending so the freshest
      // branch sits at the top.
      sortedRest.sort((a, b) => (b.date || '').localeCompare(a.date || '') ||
        a.shortName.localeCompare(b.shortName))
      break
    case 'ahead':
      // ahead-first; ties broken by behind, then by name. Keeps "this branch
      // has unmerged work" in the user's first scroll.
      sortedRest.sort((a, b) => b.ahead - a.ahead || b.behind - a.behind ||
        a.shortName.localeCompare(b.shortName))
      break
  }
  return current ? [current, ...sortedRest] : sortedRest
}

/* --------------------------------- tags --------------------------------- */

export type TagSortMode = 'name' | 'recent'

export const TAG_SORT_MODES: TagSortMode[] = ['recent', 'name']

export const DEFAULT_TAG_SORT_MODE: TagSortMode = 'recent'

export function cycleTagSort(mode: TagSortMode): TagSortMode {
  const index = TAG_SORT_MODES.indexOf(mode)
  if (index < 0) return TAG_SORT_MODES[0]
  return TAG_SORT_MODES[(index + 1) % TAG_SORT_MODES.length]
}

export function sortTags<T extends GitTagRef>(tags: T[], mode: TagSortMode): T[] {
  const copy = tags.slice()
  switch (mode) {
    case 'name':
      return copy.sort((a, b) => a.name.localeCompare(b.name))
    case 'recent':
      return copy.sort((a, b) => (b.date || '').localeCompare(a.date || '') ||
        a.name.localeCompare(b.name))
    default:
      return copy
  }
}

/* ---------------------------- header indicator -------------------------- */

export function formatSortIndicator(mode: string, options: { ascii?: boolean } = {}): string {
  return `${options.ascii ? 'v' : '▼'} ${mode}`
}
