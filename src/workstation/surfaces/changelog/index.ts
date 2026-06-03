/**
 * Changelog surface — full-screen view that renders LLM-generated
 * release notes for the current branch. Reached via `L` from history
 * or branches; rendered as a real surface (not an input prompt) so the
 * content gets proper scroll, editing, yank, and create-PR follow-ups.
 *
 * Replaces the input-prompt-in-sidebar implementation from #906 (PR
 * feedback: cramped, no useful navigation, hotkeys invisible).
 *
 * Display states:
 *   - loading : spinner + "generating changelog vs main…"
 *   - ready   : full text with scroll, header showing branch + base +
 *               cache age, footer hints driven by the keymap
 *   - error   : error message + "press r to retry"
 *
 * View-local bindings (also reflected in footer hints + help):
 *   - j/k          scroll line
 *   - pgup/pgdn    scroll page
 *   - y            yank to clipboard
 *   - E            open in $EDITOR (write-back updates view + cache)
 *   - c            create-PR seeded with this content
 *   - r            regenerate (force-refresh, skip cache)
 *   - </Esc        pop back to prior view
 *
 * Caching: state.changelogCache is keyed by branch name. Re-entering
 * the view for the same branch hits the cache (no LLM call); switching
 * branches naturally produces a fresh generation. `r` is the explicit
 * "I want fresh output right now" knob.
 */

import type * as ReactTypes from 'react'
import { truncateCells } from '../../chrome/text'
import type { SurfaceRenderContext } from '../../runtime/types'
import { focusBorderColor, panelTitle } from '../../runtime/utils'

/**
 * Pluralization-free relative-time string for cache age. Coarse on
 * purpose — exact seconds don't help, but "5 minutes ago" vs "2 hours
 * ago" tells the user whether the cached content might be stale.
 */
function formatCacheAge(generatedAt: number, now: number): string {
  const diffMs = Math.max(0, now - generatedAt)
  const sec = Math.floor(diffMs / 1000)
  if (sec < 5) return 'just now'
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  return `${day}d ago`
}

export function renderChangelogSurface(ctx: SurfaceRenderContext): ReactTypes.ReactElement {
  const { h, components, state, bodyRows, width, theme } = ctx
  const { Box, Text } = components
  const focused = state.focus === 'commits'
  const view = state.changelogView

  // Reserve rows for the header (1) + cache hint line (1) + 1 for
  // borders. Body fills the rest. Min of 4 so even ultra-short terminals
  // don't collapse to negative space.
  const listRows = Math.max(4, bodyRows - 3)
  const maxLineWidth = Math.max(20, width - 4)

  const headerLeft = view.branch
    ? `Changelog: ${view.branch}${view.baseLabel ? ` (${view.baseLabel})` : ''}`
    : 'Changelog'

  let headerRight = ''
  let lines: ReactTypes.ReactNode[]

  if (view.status === 'loading') {
    headerRight = 'generating…'
    lines = [
      h(Text, { key: 'changelog-loading', dimColor: true },
        `Generating changelog ${view.baseLabel ? `(${view.baseLabel})` : ''}…`),
      h(Text, { key: 'changelog-loading-hint', dimColor: true }, ''),
      h(Text, { key: 'changelog-loading-hint-2', dimColor: true },
        'Esc cancels and returns to the previous view.'),
    ]
  } else if (view.status === 'error') {
    headerRight = 'error'
    lines = [
      h(Text, { key: 'changelog-error', color: 'red' },
        `Changelog generation failed.`),
      h(Text, { key: 'changelog-error-msg', dimColor: true },
        view.error || 'No additional detail.'),
      h(Text, { key: 'changelog-error-hint', dimColor: true }, ''),
      h(Text, { key: 'changelog-error-retry', dimColor: true },
        'Press `r` to retry, `<` / Esc to go back.'),
    ]
  } else if (view.status === 'ready' && view.text) {
    const allLines = view.text.split('\n')
    const totalLines = allLines.length
    const scrollOffset = Math.min(view.scrollOffset, Math.max(0, totalLines - 1))
    const visible = allLines.slice(scrollOffset, scrollOffset + listRows)
    const cached = view.branch ? state.changelogCache[view.branch] : undefined
    const ageHint = cached ? formatCacheAge(cached.generatedAt, Date.now()) : 'just now'

    headerRight = `${scrollOffset + 1}–${Math.min(totalLines, scrollOffset + listRows)} / ${totalLines} · ${ageHint}`

    lines = visible.length === 0
      ? [h(Text, { key: 'changelog-empty', dimColor: true }, '(empty changelog)')]
      : visible.map((line, offset) => h(Text, {
        key: `changelog-line-${scrollOffset + offset}`,
        dimColor: false,
      }, truncateCells(line || ' ', maxLineWidth)))
  } else {
    // 'idle' — view was pushed but loading hasn't started yet. Should
    // be a single-frame transient; we render the same loading copy so
    // there's no jarring "empty" frame.
    headerRight = ''
    lines = [
      h(Text, { key: 'changelog-idle', dimColor: true }, 'Preparing changelog…'),
    ]
  }

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    flexShrink: 0,
    paddingX: 1,
    width,
  },
  h(Box, { justifyContent: 'space-between' },
    h(Text, { bold: true }, panelTitle(headerLeft, focused)),
    h(Text, { dimColor: true }, headerRight)
  ),
  ...lines)
}
