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
 * Theme-aware lane palette. Default uses bright ANSI named colors that
 * render reliably on 16-color terminals; catppuccin / gruvbox lift
 * accent hues from their respective palettes so the graph stays
 * coherent with the surrounding chrome.
 *
 * Selecting 8 colors gives enough variety to distinguish lanes in
 * practice (most repos peak at 3-4 simultaneous lanes); the modulo
 * lookup wraps cleanly for the rare case of more.
 */
const DEFAULT_LANE_PALETTE: readonly string[] = [
  'cyan', 'magenta', 'yellow', 'green', 'blue', 'red', 'cyanBright', 'magentaBright',
]

const CATPPUCCIN_LANE_PALETTE: readonly string[] = [
  '#89b4fa', '#f5c2e7', '#f9e2af', '#a6e3a1', '#cba6f7', '#fab387', '#94e2d5', '#f5e0dc',
]

const GRUVBOX_LANE_PALETTE: readonly string[] = [
  '#83a598', '#d3869b', '#fabd2f', '#b8bb26', '#d65d0e', '#fb4934', '#8ec07c', '#fe8019',
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
