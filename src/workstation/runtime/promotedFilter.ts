/**
 * Filter helpers shared across "promoted" surfaces (branches, tags,
 * reflog, bisect, stash, worktrees). Each of those views supports
 * the same filter-mode UX:
 *
 *   - typing a filter narrows the visible row set,
 *   - the live filter input renders as a single accent-colored line
 *     above the list as a discoverability cue,
 *   - filter matching is case-insensitive and substring-based.
 *
 * Extracted from `src/workstation/runtime/inkRuntime.ts` so per-surface
 * modules can implement that contract without copy-pasting the
 * predicate or the affordance.
 */

import type * as ReactTypes from 'react'
import type { LogInkState } from '../../workstation/runtime/inkViewModel'
import type { LogInkTheme } from '../chrome/theme'
import type { LogInkComponents } from './types'

/**
 * Case-insensitive substring match across multiple haystacks. Returns
 * true (no-op) when the filter is empty so callers can treat a blank
 * filter as "show everything" without short-circuiting.
 */
export function matchesPromotedFilter(haystacks: string[], filter: string): boolean {
  if (!filter.trim()) {
    return true
  }
  const needle = filter.toLowerCase()
  return haystacks.some((value) => value.toLowerCase().includes(needle))
}

/**
 * Render the live filter input affordance for a promoted surface.
 * Emits an empty array when filter mode is off so callers can spread
 * the result inline without conditional fan-out.
 */
export function renderPromotedFilterAffordance(
  h: typeof ReactTypes.createElement,
  Text: LogInkComponents['Text'],
  state: LogInkState,
  theme: LogInkTheme
): ReactTypes.ReactElement[] {
  if (!state.filterMode) {
    return []
  }
  const accent = theme.noColor ? undefined : theme.colors.accent
  return [
    h(Text, { key: 'promoted-filter-input', color: accent }, `filter: ${state.filter}_`),
  ]
}
