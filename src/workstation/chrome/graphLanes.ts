/**
 * Lane segment type + per-lane coloring for the Ink log TUI graph.
 *
 * The graph topology is computed from the commit DAG by `graphLayout.ts`
 * and rendered to glyphs by `graphOrtho.ts` (#1190). This module holds
 * the shared `LaneSegment` shape those produce and the theme-aware
 * palette that maps a lane id to a stable color.
 */
import { adjustHexLightness } from './colorSupport'
import { LogInkTheme, LogInkThemeColors } from './theme'

export type LaneSegment = {
  text: string
  laneId?: number
}

/**
 * ANSI-named fallback for the `default` preset (and any hex preset
 * downgraded to it on a 16-color terminal, see `theme.ts`'s truecolor
 * downgrade). Capped at 5 muted hues that exclude the semantic trio
 * (red/green/yellow) so lanes don't compete with diff additions, commit
 * status, or warning signals (#1368). Most repos peak at 3-4 simultaneous
 * lanes; the modulo wraps cleanly for more.
 */
const DEFAULT_LANE_PALETTE: readonly string[] = [
  'cyan', 'magenta', 'blue', 'cyanBright', 'magentaBright',
]

/**
 * Tokens a preset can use to opt out of derivation and pin its own lane
 * hues (as catppuccin/gruvbox do) — checked in order, non-empty wins.
 */
const EXPLICIT_LANE_TOKENS = ['graphLane1', 'graphLane2', 'graphLane3', 'graphLane4', 'graphLane5'] as const

/**
 * Non-semantic, cool-toned tokens every hex preset defines, used as the
 * seed hues for derived lanes. Deliberately excludes `success`/`warning`
 * (removed from the lane palette by #1529/#1368 so lanes don't compete
 * with diff/status colors) and `danger`/`muted` (reserved meanings).
 */
const LANE_SEED_TOKENS = ['accent', 'focusBorder', 'info'] as const

const LIGHTNESS_DELTAS = [0.22, -0.18, 0.4, -0.36] as const

/**
 * Derive up to 5 lane hues from a preset's own non-semantic tokens, for
 * the ~125 hex presets that don't define explicit `graphLane*` tokens.
 * Falls back to `undefined` when the preset has no hex seed hues at all
 * (ANSI-named themes), so the caller can use `DEFAULT_LANE_PALETTE`.
 */
function deriveLanePalette(colors: LogInkThemeColors): readonly string[] | undefined {
  const bases: string[] = []
  for (const token of LANE_SEED_TOKENS) {
    const value = colors[token]
    if (value && /^#[0-9a-f]{6}$/i.test(value) && value !== colors.muted && !bases.includes(value)) {
      bases.push(value)
    }
  }
  if (bases.length === 0) {
    return undefined
  }

  const palette: string[] = [...bases]
  for (let i = 0; palette.length < 5; i++) {
    const base = bases[i % bases.length]!
    const delta = LIGHTNESS_DELTAS[i % LIGHTNESS_DELTAS.length]!
    const variant = adjustHexLightness(base, delta)
    if (variant && !palette.includes(variant)) {
      palette.push(variant)
    }
  }
  return palette.slice(0, 5)
}

export function getLanePalette(theme: LogInkTheme): readonly string[] {
  if (theme.noColor) {
    return []
  }

  const explicit = EXPLICIT_LANE_TOKENS
    .map((token) => theme.colors[token])
    .filter((value): value is string => Boolean(value))
  if (explicit.length > 0) {
    return explicit
  }

  return deriveLanePalette(theme.colors) ?? DEFAULT_LANE_PALETTE
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
