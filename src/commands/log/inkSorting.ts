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

import { BranchRef } from './branchData'
import { GitTagRef } from './tagData'

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
  const copy = branches.slice()
  switch (mode) {
    case 'name':
      return copy.sort((a, b) => a.shortName.localeCompare(b.shortName))
    case 'recent':
      // ISO-shaped dates compare byte-for-byte; descending so the freshest
      // branch sits at the top.
      return copy.sort((a, b) => (b.date || '').localeCompare(a.date || '') ||
        a.shortName.localeCompare(b.shortName))
    case 'ahead':
      // ahead-first; ties broken by behind, then by name. Keeps "this branch
      // has unmerged work" in the user's first scroll.
      return copy.sort((a, b) => b.ahead - a.ahead || b.behind - a.behind ||
        a.shortName.localeCompare(b.shortName))
    default:
      return copy
  }
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
