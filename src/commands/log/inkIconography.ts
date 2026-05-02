/**
 * Iconography helpers for the Ink TUI surfaces.
 *
 * Letters always carry the meaning; symbols enhance. Glyphs come from the
 * Geometric Shapes / Arrows blocks (high-compat Unicode, no emoji), and all
 * helpers degrade cleanly under `theme.ascii` and `theme.noColor`.
 */

import { LogInkTheme } from './inkTheme'
import { LogInkSidebarTab } from './inkViewModel'

/* ----------------------------- P3.1 — branch ----------------------------- */

export type BranchDivergenceInput = {
  upstream?: string
  ahead: number
  behind: number
}

/**
 * Format a branch's relationship to its upstream.
 * - no upstream  → "no upstream"
 * - even         → "even with <upstream>"
 * - divergent    → "↑<ahead> ↓<behind> <upstream>" (only the non-zero side
 *   is rendered so the line stays tight). ASCII mode falls back to the
 *   legacy `+N/-N` form.
 */
export function formatBranchDivergence(
  branch: BranchDivergenceInput,
  options: { ascii?: boolean } = {}
): string {
  if (!branch.upstream) {
    return 'no upstream'
  }

  if (branch.ahead === 0 && branch.behind === 0) {
    return `even with ${branch.upstream}`
  }

  if (options.ascii) {
    return `+${branch.ahead}/-${branch.behind} ${branch.upstream}`
  }

  const parts: string[] = []
  if (branch.ahead > 0) parts.push(`↑${branch.ahead}`)
  if (branch.behind > 0) parts.push(`↓${branch.behind}`)

  return `${parts.join(' ')} ${branch.upstream}`
}

export type BranchRowMarkerInput = {
  current: boolean
  upstream?: string
}

/**
 * Single-cell marker shown to the left of a branch name in lists.
 * `*` = current, `◌` = no upstream (detached from a remote), space otherwise.
 */
export function branchRowMarker(
  branch: BranchRowMarkerInput,
  options: { ascii?: boolean } = {}
): string {
  if (branch.current) return '*'
  if (!branch.upstream) return options.ascii ? '?' : '◌'
  return ' '
}

/* ------------------------------ P3.2 — PR ------------------------------- */

export type PullRequestStateInput = {
  state: string
  isDraft: boolean
}

export type PullRequestStateGlyph = {
  glyph: string
  color: string | undefined
  dim: boolean
}

/**
 * Pick the glyph + color for a PR state badge.
 * Returns an empty glyph under ASCII mode so the textual state (OPEN /
 * MERGED / DRAFT / CLOSED) carries the meaning alone.
 */
export function getPullRequestStateGlyph(
  pr: PullRequestStateInput,
  theme: LogInkTheme
): PullRequestStateGlyph {
  if (theme.ascii) {
    return { glyph: '', color: undefined, dim: false }
  }

  if (pr.isDraft) {
    return { glyph: '◇', color: undefined, dim: true }
  }

  switch (pr.state.toUpperCase()) {
    case 'OPEN':
      return { glyph: '◉', color: theme.colors.success, dim: false }
    case 'MERGED':
      return { glyph: '●', color: theme.noColor ? undefined : 'magenta', dim: false }
    case 'CLOSED':
      return { glyph: '×', color: theme.colors.danger, dim: false }
    default:
      return { glyph: '·', color: undefined, dim: true }
  }
}

/* --------------------------- P3.3 — stage dot --------------------------- */

export type StageStatusState = 'staged' | 'unstaged' | 'untracked'

/**
 * Color for the leading dot in a status row. `undefined` means "skip the
 * dot" — under noColor or ascii mode the dot carries no information so the
 * raw porcelain codes (M / ?? / etc.) and the textual state carry meaning
 * alone.
 */
export function getStageStatusDotColor(
  state: StageStatusState,
  theme: LogInkTheme
): string | undefined {
  if (theme.noColor || theme.ascii) return undefined

  switch (state) {
    case 'unstaged':
      return theme.colors.danger
    case 'staged':
      return theme.colors.warning
    case 'untracked':
      return theme.colors.muted
    default:
      return undefined
  }
}

export const STAGE_STATUS_DOT = '●'

/* ------------------------- P3.4 — sidebar counts ------------------------ */

export type SidebarTabCountContext = {
  worktree?: { files: unknown[] }
  branches?: { localBranches: unknown[] }
  tags?: { tags: unknown[] }
  stashes?: { stashes: unknown[] }
  worktreeList?: { worktrees: unknown[] }
}

/**
 * Count to show next to a sidebar tab name, or `undefined` when the
 * underlying data has not loaded yet (so the label renders without a `(N)`
 * rather than a misleading `(0)`).
 */
export function sidebarTabCount(
  tab: LogInkSidebarTab,
  context: SidebarTabCountContext
): number | undefined {
  switch (tab) {
    case 'status':
      return context.worktree?.files.length
    case 'branches':
      return context.branches?.localBranches.length
    case 'tags':
      return context.tags?.tags.length
    case 'stashes':
      return context.stashes?.stashes.length
    case 'worktrees':
      return context.worktreeList?.worktrees.length
    default:
      return undefined
  }
}
