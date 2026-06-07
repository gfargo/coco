/**
 * Lane tracking + per-lane coloring for the Ink log TUI graph (#791
 * stage 2).
 *
 * `git log --graph` emits topology in 2-char patterns where every even
 * position is a lane column (`*`, `|`, ` `) and every odd position is
 * a spacer that may carry a connector (`\`, `/`, `_`). To color graph
 * chars by which logical lane they belong to, we walk the rows
 * left-to-right tracking which lane id occupies each column and apply
 * git's emission rules:
 *
 *   - `|\` (fork): the spacer spawns a new lane id at column +1 below.
 *   - `|/` (converge): the spacer absorbs the lane at column +1 into
 *     this column; the absorbed lane disappears in the next row.
 *   - `*` is treated like `|` for lane purposes (a commit lives on a
 *     lane and connects through the row).
 *
 * Lane ids are stable across rows for the same column unless one of
 * the transition patterns above fires. Other shifts (multi-step `_`
 * crossings, octopus merges) degrade gracefully — uncovered chars
 * just fall back to `undefined` lane id, so they render in the muted
 * graph color rather than a wrong lane color.
 *
 * The segment builder collapses adjacent characters with the same
 * lane id into one `LaneSegment` so the renderer emits one Text span
 * per visually-distinct color region instead of per-char.
 */
import { ASCII_TO_UNICODE_MAP, DEFAULT_COMMIT_GLYPH, SubstituteGraphCharsOptions } from './graphChars'
import { LogInkTheme } from './theme'

export type LaneTrackerState = {
  columnLanes: Map<number, number>
  nextLaneId: number
}

export function createLaneTrackerState(): LaneTrackerState {
  return { columnLanes: new Map(), nextLaneId: 0 }
}

export type LaneSegment = {
  text: string
  laneId?: number
}

/**
 * Walk a single graph row left-to-right, mutating the tracker so the
 * next row sees the updated column → lane id map. Returns lane
 * segments ready for the renderer. When `options.ascii` is true the
 * tracker is left untouched and the row is emitted as a single
 * lane-less segment so legacy terminals get raw ASCII output with no
 * coloring.
 */
export function renderGraphRowSegments(
  graph: string,
  tracker: LaneTrackerState,
  options: SubstituteGraphCharsOptions
): LaneSegment[] {
  if (options.ascii) {
    return [{ text: graph, laneId: undefined }]
  }

  const commitGlyph = options.commitGlyph ?? DEFAULT_COMMIT_GLYPH
  const segments: LaneSegment[] = []

  const push = (text: string, laneId: number | undefined) => {
    const last = segments[segments.length - 1]
    if (last && last.laneId === laneId) {
      last.text += text
    } else {
      segments.push({ text, laneId })
    }
  }

  let i = 0
  while (i < graph.length) {
    const c = graph[i]
    const next = i + 1 < graph.length ? graph[i + 1] : ''
    const col = i >> 1
    const isSpacer = (i & 1) === 1

    if (c === ' ') {
      push(' ', undefined)
      i += 1
      continue
    }

    if (!isSpacer && (c === '|' || c === '*')) {
      if (!tracker.columnLanes.has(col)) {
        tracker.columnLanes.set(col, tracker.nextLaneId++)
      }
      const laneId = tracker.columnLanes.get(col)
      const glyph = c === '|' ? '│' : commitGlyph

      // Fork (`|\`) / converge (`|/`): the lane on THIS column carries
      // straight down (`│`, or the commit glyph) and the spacer holds a
      // diagonal that bridges to the adjacent lane. Diagonals — not
      // corner glyphs — because git's lanes sit on a 2-column pitch and a
      // single `╲`/`╱` spans exactly that step, keeping the line
      // continuous into the commit above/below (see graphChars header).
      if (next === '\\') {
        const newLaneId = tracker.nextLaneId++
        tracker.columnLanes.set(col + 1, newLaneId)
        push(c === '|' ? '│' : commitGlyph, laneId)
        push('╲', newLaneId)
        i += 2
        continue
      }

      if (next === '/') {
        const absorbedLaneId = tracker.columnLanes.get(col + 1)
        push(c === '|' ? '│' : commitGlyph, laneId)
        push('╱', absorbedLaneId)
        tracker.columnLanes.delete(col + 1)
        i += 2
        continue
      }

      push(glyph, laneId)
      i += 1
      continue
    }

    // Non-lane chars (standalone `\`, `/`, `_`, decorations) — substitute
    // 1-to-1 and leave the lane id undefined so they render in the muted
    // fallback color.
    push(ASCII_TO_UNICODE_MAP[c] ?? c, undefined)
    i += 1
  }

  return segments
}

/**
 * Run the tracker over `count` rows starting from `state.rows[0]` so
 * downstream callers can resume tracking from a specific window
 * without re-scanning. Used by `getVisibleLogInkHistory` to keep lane
 * ids stable across scrolling — without this, each scroll would
 * re-color lanes from a fresh tracker.
 */
export function advanceTrackerThrough(
  graphs: string[],
  tracker: LaneTrackerState,
  count: number
): void {
  for (let i = 0; i < count && i < graphs.length; i++) {
    renderGraphRowSegments(graphs[i], tracker, { ascii: false })
  }
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
