/**
 * Lane segment type + per-lane coloring for the Ink log TUI graph.
 *
 * The graph topology is computed from the commit DAG by `graphLayout.ts`
 * and rendered to glyphs by `graphOrtho.ts` (#1190). This module holds
 * the shared `LaneSegment` shape those produce and the theme-aware
 * palette that maps a lane id to a stable color.
 */
import { LogInkTheme } from './theme'

export type LaneSegment = {
  text: string
  laneId?: number
}

/**
 * Theme-aware lane palette. Capped at 5 muted hues that exclude the
 * semantic trio (red/green/yellow) so lanes don't compete with diff
 * additions, commit status, or warning signals (#1368). Most repos
 * peak at 3-4 simultaneous lanes; the modulo wraps cleanly for more.
 */
const DEFAULT_LANE_PALETTE: readonly string[] = [
  'cyan', 'magenta', 'blue', 'cyanBright', 'magentaBright',
]

const CATPPUCCIN_LANE_PALETTE: readonly string[] = [
  '#89b4fa', '#f5c2e7', '#cba6f7', '#94e2d5', '#b4befe',
]

const GRUVBOX_LANE_PALETTE: readonly string[] = [
  '#83a598', '#d3869b', '#8ec07c', '#d65d0e', '#458588',
]

export function getLanePalette(theme: LogInkTheme): readonly string[] {
  if (theme.noColor) {
    return []
  }

  const accent = theme.colors.accent
  if (accent === '#89b4fa') {
    return CATPPUCCIN_LANE_PALETTE
  }
  if (accent === '#83a598') {
    return GRUVBOX_LANE_PALETTE
  }
  return DEFAULT_LANE_PALETTE
}

export function getLaneColor(
  laneId: number | undefined,
  theme: LogInkTheme
): string | undefined {
  if (laneId === undefined) {
    return undefined
  }
  const palette = getLanePalette(theme)
  if (palette.length === 0) {
    return undefined
  }
  return palette[laneId % palette.length]
}
