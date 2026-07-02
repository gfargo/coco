/**
 * Iconography helpers for the Ink TUI surfaces.
 *
 * Letters always carry the meaning; symbols enhance. Glyphs come from the
 * Geometric Shapes / Arrows blocks (high-compat Unicode, no emoji), and all
 * helpers degrade cleanly under `theme.ascii` and `theme.noColor`.
 */

import { LogInkTheme } from './theme'
import { LogInkSidebarTab } from '../../workstation/runtime/inkViewModel'

/* ----------------------------- P3.1 — branch ----------------------------- */

export type BranchDivergenceInput = {
  upstream?: string
  ahead: number
  behind: number
}

/**
 * Format a branch's relationship to its upstream.
 * - no upstream  → "no upstream"
 * - even         → "" (the boring default — keep the row tight; the row
 *   marker already encodes "synced")
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
    return ''
  }

  if (options.ascii) {
    return `+${branch.ahead}/-${branch.behind} ${branch.upstream}`
  }

  const parts: string[] = []
  if (branch.ahead > 0) parts.push(`↑${branch.ahead}`)
  if (branch.behind > 0) parts.push(`↓${branch.behind}`)

  return `${parts.join(' ')} ${branch.upstream}`
}

/**
 * Format a one-line banner for the history view announcing that the
 * current branch is behind (or diverged from) its upstream — work
 * the user can pull / fetch. Returns `undefined` when there's nothing
 * to surface (no upstream, fully synced, or ahead-only).
 *
 * Two variants, chosen by ahead-count:
 *
 *   - **Behind-only** (behind > 0, ahead === 0):
 *     `↓ N commits behind <upstream> · F fetch · U pull`
 *     Matches `git status` wording, compressed.
 *
 *   - **Diverged** (behind > 0, ahead > 0):
 *     `↑N ↓N diverged from <upstream> · F fetch · U pull --rebase`
 *     Reuses the `↑N ↓N` symbols from `formatBranchDivergence`.
 *     `--rebase` hint because fast-forward pull isn't possible with
 *     local work present.
 *
 * Why no "ahead-only" banner: the question this surface answers is
 * "what work do you have to PULL in?" — ahead-only means there's
 * nothing to pull. Push affordances live on the branches sidebar
 * where the cursor names a specific branch.
 *
 * Why no banner for synced / no-upstream / detached: same reason —
 * nothing inbound. Detached HEAD also has no `currentBranch`, so
 * callers passing `undefined` get `undefined` back automatically.
 *
 * ASCII fallback mirrors `formatBranchDivergence`: `v` for `↓`,
 * `+N/-N` for `↑N ↓N`, `.` for `·`.
 */
export type BranchUpstreamAheadInput = {
  upstream?: string
  ahead: number
  behind: number
}

export function formatUpstreamAheadBanner(
  branch: BranchUpstreamAheadInput | undefined,
  options: { ascii?: boolean } = {}
): string | undefined {
  if (!branch?.upstream || branch.behind <= 0) {
    return undefined
  }

  const sep = options.ascii ? '.' : '·'

  if (branch.ahead > 0) {
    // Diverged — local has work too, fast-forward pull is impossible.
    // Suggest pull --rebase as the cleaner-history default; users who
    // prefer merge can do that themselves.
    const symbols = options.ascii
      ? `+${branch.ahead} -${branch.behind}`
      : `↑${branch.ahead} ↓${branch.behind}`
    return `${symbols} diverged from ${branch.upstream} ${sep} F fetch ${sep} U pull --rebase`
  }

  // Behind-only — fast-forward pull works.
  const arrow = options.ascii ? 'v' : '↓'
  const noun = branch.behind === 1 ? 'commit' : 'commits'
  return `${arrow} ${branch.behind} ${noun} behind ${branch.upstream} ${sep} F fetch ${sep} U pull`
}

export type BranchRowMarkerInput = {
  current: boolean
  upstream?: string
  ahead?: number
  behind?: number
}

/**
 * Single-cell marker shown to the left of a branch name in lists.
 *
 * - `*` — current branch (regardless of remote state)
 * - `◌` — no upstream
 * - `≡` — has upstream + synced (ahead === 0 && behind === 0)
 * - `↓` — has upstream + behind only (needs pull)
 * - `↑` — has upstream + ahead only (needs push)
 * - `⇅` — has upstream + diverged (both ahead and behind; needs pull --rebase)
 * - ` ` — fallback / no info
 *
 * Behind / ahead / diverged were collapsed into a single `↕` glyph
 * in earlier versions — but the user can't tell at a glance whether a
 * branch needs a pull, a push, or a fetch+rebase. Splitting the three
 * cases gives the sidebar real visual differentiation. Color (applied
 * by the consumer via the returned `kind` field) reinforces it:
 * warning yellow for "needs pull" (behind / diverged), info blue for
 * "needs push" (ahead), muted for "nothing to do" (synced / no-upstream),
 * success green + bold for "here" (head).
 *
 * Returns `{ glyph, kind }`. Consumers use `glyph` for layout and
 * `kind` to pick a colour from their theme.
 *
 * ASCII fallbacks (legible without box-drawing / arrow glyphs):
 *   `?` no-upstream, `=` synced, `v` behind, `^` ahead, `~` diverged.
 */
export type BranchRowMarkerKind =
  | 'head'
  | 'no-upstream'
  | 'synced'
  | 'behind'
  | 'ahead'
  | 'diverged'

export type BranchRowMarker = {
  glyph: string
  kind: BranchRowMarkerKind
}

export function branchRowMarker(
  branch: BranchRowMarkerInput,
  options: { ascii?: boolean } = {}
): BranchRowMarker {
  if (branch.current) {
    return { glyph: '*', kind: 'head' }
  }

  if (!branch.upstream) {
    return { glyph: options.ascii ? '?' : '◌', kind: 'no-upstream' }
  }

  const ahead = branch.ahead ?? 0
  const behind = branch.behind ?? 0

  if (ahead === 0 && behind === 0) {
    return { glyph: options.ascii ? '=' : '≡', kind: 'synced' }
  }

  if (ahead > 0 && behind > 0) {
    return { glyph: options.ascii ? '~' : '⇅', kind: 'diverged' }
  }

  if (behind > 0) {
    return { glyph: options.ascii ? 'v' : '↓', kind: 'behind' }
  }

  // ahead > 0 (the only remaining case after the guards above)
  return { glyph: options.ascii ? '^' : '↑', kind: 'ahead' }
}

/**
 * Theme-aware colour picker for a `BranchRowMarker.kind`.
 *
 * Reuses the existing chip / banner colour semantic so the workstation
 * speaks one visual language across history (chips, "behind upstream"
 * banner) and the branches list:
 *
 *   - `head`        → success green (matches HEAD chip)
 *   - `behind`      → warning yellow (matches "behind upstream" banner)
 *   - `diverged`    → warning yellow (same: action needed inbound)
 *   - `ahead`       → info blue (you have work to push)
 *   - `synced`      → undefined (neutral; inherit row's existing dim)
 *   - `no-upstream` → undefined (neutral; same)
 *
 * Returns `undefined` under `noColor` / `ascii` for the muted cases so
 * the row renderer skips the colour wrap entirely; the glyph alone
 * carries the meaning.
 */
export function getBranchRowMarkerColor(
  kind: BranchRowMarkerKind,
  theme: LogInkTheme
): string | undefined {
  if (theme.noColor) return undefined

  switch (kind) {
    case 'head':
      return theme.colors.success
    case 'behind':
    case 'diverged':
      return theme.colors.warning
    case 'ahead':
      return theme.colors.info
    case 'synced':
    case 'no-upstream':
      return undefined
    default:
      return undefined
  }
}

/**
 * Compact, human-friendly relative timestamp for the branch row.
 * Inputs:
 * - `iso` — committer-date in `YYYY-MM-DD` form (as produced by
 *   `for-each-ref` with `committerdate:short`).
 * - `now` — reference instant; pass it explicitly so callers can pin it
 *   for deterministic tests.
 *
 * Outputs (rounded toward the nearest unit):
 * - `today`, `1d ago`, `2d ago` … up to 13d
 * - `2w ago` … up to 8w
 * - `2mo ago` … up to 12mo
 * - `2y ago` for older
 * - `''` for malformed inputs (caller renders nothing).
 *
 * "in the future" inputs (clock skew, bad data) collapse to `today`.
 */
export function formatBranchLastTouched(iso: string | undefined, now: Date): string {
  if (!iso) return ''
  // Tolerate either `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM:SS…` ISO strings.
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!match) return ''

  const year = Number.parseInt(match[1], 10)
  const month = Number.parseInt(match[2], 10)
  const day = Number.parseInt(match[3], 10)
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return ''

  // Compare at day granularity in UTC so a branch touched "yesterday"
  // never reads "today" depending on the operator's timezone.
  const branchUtc = Date.UTC(year, month - 1, day)
  const nowUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const diffMs = nowUtc - branchUtc
  const oneDay = 24 * 60 * 60 * 1000
  const days = Math.floor(diffMs / oneDay)

  if (days <= 0) return 'today'
  if (days < 14) return `${days}d ago`

  const weeks = Math.floor(days / 7)
  if (weeks < 9) return `${weeks}w ago`

  // Gate on days, not the rounded month count: days 360-364 floor to
  // 12 "months" but 0 years, which used to render as a nonsense `0y`.
  const months = Math.floor(days / 30)
  if (days < 365) return `${months}mo ago`

  const years = Math.floor(days / 365)
  return `${years}y ago`
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
