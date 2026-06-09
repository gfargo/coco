/**
 * Pure visual helpers shared across workstation render code.
 *
 * Extracted from `src/workstation/runtime/inkRuntime.ts` so per-surface modules
 * can render with the same color / glyph rules without re-importing the
 * orchestration file. None of these helpers touch React, Ink, or git —
 * they take state/theme inputs and return strings or style props.
 */

import type { GitCommitDetail } from '../../commands/log/data'
import type { LogInkSidebarTab } from '../../workstation/runtime/inkViewModel'
import type { ProviderRepository } from '../../git/providerData'
import { buildProviderUrl } from '../../git/providerData'
import type { LogInkTheme } from '../chrome/theme'

/**
 * Short-form commit hash for one-line displays. Returns `<none>` when
 * the hash is missing so the column never collapses to whitespace.
 */
export function compactHash(hash: string | undefined): string {
  return hash ? hash.slice(0, 7) : '<none>'
}

/**
 * Pick the border color for a focusable panel. Honors `NO_COLOR` /
 * monochrome by returning undefined so the terminal default takes
 * over without shifting layout.
 */
export function focusBorderColor(
  theme: LogInkTheme,
  focused: boolean
): string | undefined {
  if (theme.noColor) {
    return undefined
  }

  return focused ? theme.colors.focusBorder : theme.colors.border
}

/**
 * Append a focus indicator (` *`) to a panel's title when it owns the
 * focus. Used in panel headers so keyboard focus is visible without
 * relying on color alone.
 */
export function panelTitle(title: string, focused: boolean): string {
  return focused ? `${title} *` : title
}

/**
 * Map a unified-diff line to the props passed to an Ink `<Text>` so the
 * standard +/-/@@ prefixes render in their conventional colors. File
 * headers (`+++`, `---`, `diff --git`, `index`) get a softer treatment so
 * they don't compete with the actual hunk content.
 *
 * `theme.noColor` collapses everything to dim/normal so we stay readable
 * under `NO_COLOR` and the `monochrome` preset.
 */
export function diffLineProps(
  line: string,
  theme: LogInkTheme
): { color?: string; dimColor?: boolean } {
  if (theme.noColor) {
    return { dimColor: line.startsWith(' ') || line.startsWith('diff ') || line.startsWith('index ') }
  }

  if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('+++') || line.startsWith('---')) {
    return { dimColor: true }
  }
  if (line.startsWith('@@')) {
    return { color: theme.colors.accent }
  }
  if (line.startsWith('+')) {
    return { color: theme.colors.gitAdded }
  }
  if (line.startsWith('-')) {
    return { color: theme.colors.gitDeleted }
  }

  return {}
}

/**
 * Pick a theme color for a single name-status code (`A`, `M`, `D`,
 * `R100`, etc.) so the inspector and commit-diff file list render with
 * familiar git colors at a glance. Letters stay in the line so the
 * meaning survives `NO_COLOR`.
 */
export function statusCodeColor(status: string, theme: LogInkTheme): string | undefined {
  if (theme.noColor) {
    return undefined
  }

  const head = status.charAt(0)
  switch (head) {
    case 'A':
      return theme.colors.gitAdded
    case 'D':
      return theme.colors.gitDeleted
    case 'U':
      return theme.colors.danger
    case 'M':
    case 'T':
      return theme.colors.gitModified
    case 'R':
    case 'C':
      return theme.colors.accent
    default:
      return undefined
  }
}

/**
 * Format the additions/deletions stats column for a commit's changed
 * file list. Binary files render as `bin`; missing stats collapse to
 * empty so the column doesn't show meaningless `+0/-0`.
 */
export function formatChangedFileStats(file: GitCommitDetail['files'][number]): string {
  if (file.binary) {
    return 'bin'
  }
  if (file.additions === undefined && file.deletions === undefined) {
    return ''
  }
  return `+${file.additions || 0}/-${file.deletions || 0}`
}

/**
 * Build a commit URL for the given hash. Returns undefined when no
 * provider is detected so callers can render plain text without
 * branching on the result.
 */
export function buildCommitUrl(
  repository: ProviderRepository | undefined,
  hash: string
): string | undefined {
  if (!repository) return undefined
  return buildProviderUrl(repository, { type: 'commit', commit: hash })
}

/**
 * Build a branch URL for a ref name. Strips the `HEAD -> ` and `tag: `
 * prefixes git decoration uses. For everything else we treat the ref as
 * a branch — GitHub's `/tree/<ref>` resolves both branches and tags.
 */
export function buildRefUrl(
  repository: ProviderRepository | undefined,
  ref: string
): string | undefined {
  if (!repository) return undefined
  const stripped = ref.replace(/^HEAD -> /, '').replace(/^tag: /, '').trim()
  if (!stripped) return undefined
  return buildProviderUrl(repository, { type: 'branch', branch: stripped })
}

/**
 * User-facing label for a sidebar tab. Drives both the sidebar header
 * and breadcrumb / palette descriptions so the wording stays consistent.
 */
export function sidebarTabLabel(tab: LogInkSidebarTab): string {
  switch (tab) {
    case 'status':
      return 'Status'
    case 'branches':
      return 'Branches'
    case 'tags':
      return 'Tags'
    case 'stashes':
      return 'Stashes'
    case 'worktrees':
      return 'Worktrees'
    default:
      return tab
  }
}
