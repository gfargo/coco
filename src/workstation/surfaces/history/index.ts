/**
 * History surface — the commit log view (the workstation's home
 * screen). Renders the commit list with optional graph lanes, a
 * synthetic "(+) new commit" row when the worktree is dirty, and a
 * server-side filter indicator when `path:` / `author:` prefixes are
 * active.
 *
 * Per-row actions (open diff, copy hash, cherry-pick, revert, reset,
 * rebase, etc.) are wired in inkInput.ts; this renderer is read-only.
 *
 * Extracted from `src/workstation/runtime/inkRuntime.ts` as part of phase 5a.5
 * of #890. The supporting helpers (`renderLaneSegmentSpans`,
 * `renderCommitHistoryRow`, `renderPendingCommitRow`,
 * `formatHistoryFetchArgs`) lived in inkRuntime.ts only to support
 * this surface; they migrate together.
 */

import type * as ReactTypes from 'react'
import { filterChippedRefs, getBranchTipChip } from '../../chrome/branchTip'
import { formatUpstreamAheadBanner } from '../../chrome/iconography'
import {
    getConventionalCommitColor,
    parseConventionalCommitPrefix,
} from '../../chrome/conventionalCommit'
import { formatCompactRelativeDate } from '../../chrome/dateFormat'
import { substituteGraphChars } from '../../chrome/graphChars'
import type { LaneSegment } from '../../chrome/graphLanes'
import { getLaneColor } from '../../chrome/graphLanes'
import {
    formatInkRefLabels,
    getVisibleLogInkHistory,
} from '../../chrome/historyRows'
import type { LogInkLayoutDensity } from '../../chrome/layout'
import {
    formatLogInkHistoryEmpty,
    formatLogInkLoading,
} from '../../chrome/surfaceStates'
import { cellWidth, truncateCells } from '../../chrome/text'
import type { LogInkTheme } from '../../chrome/theme'
import type { GitLogCommitRow } from '../../../git/logData'
import type {
    LogInkHistoryFetchArgs,
    LogInkState,
} from '../../../workstation/runtime/inkViewModel'
import type { LogInkComponents, LogInkContext, SurfaceRenderContext } from '../../runtime/types'
import { focusBorderColor, panelTitle } from '../../runtime/utils'
import { getRenderNow } from '../../chrome/snapshotMode'
import { pickSpinnerFrame } from '../../chrome/spinner'

/**
 * How the date column should render for a given density tier:
 *   - wide   → absolute `YYYY-MM-DD`
 *   - normal → compact relative form (`2d`, `3w`, `2mo`)
 *   - tight  → hidden entirely (column dropped)
 *   - rail   → caller picks `rowMode='stacked'`; this fn isn't consulted
 *
 * Compact mode (the user toggling away from the full graph) forces
 * the tight behavior regardless of density. Compact is the "scan
 * mode" — the date is the first thing the user is willing to drop in
 * exchange for more visible commits per screen.
 *
 * When `bucketed` is true the surface is rendering section dividers
 * (`── Today ──`) above commits, so the per-row date column would be
 * redundant. We drop it entirely and let the message column expand.
 */
function pickDateText(
  commit: GitLogCommitRow,
  density: LogInkLayoutDensity,
  fullGraph: boolean,
  bucketed: boolean,
  now: Date
): string {
  if (bucketed) return ''
  if (!fullGraph) return ''
  if (density === 'wide') return commit.date
  if (density === 'normal') return formatCompactRelativeDate(commit.date, now)
  return ''
}

/**
 * Maximum cells the chip body (between the brackets) is allowed to
 * occupy. Anything longer is truncated with an ellipsis so a
 * `[origin/claude/issues-prs-cache]` chip — 32 cells of chrome —
 * doesn't eat the whole subject column on a narrow terminal. Picked
 * empirically: 20 cells fits common branch shapes (`feat/foo`,
 * `claude/graph-fidelity`, `main`) without truncation.
 */
const BRANCH_CHIP_MAX_NAME_WIDTH = 20

/**
 * Render a pill-style chip for a branch tip — colored background
 * with the branch name reverse-printed inside, so the chip reads as
 * a distinct visual category (block) rather than colored text (which
 * collides with `docs:`/`refactor:`/`perf:` conventional-commit
 * prefixes that also use `info`). Current branch (HEAD -> X) uses
 * success-green; other branch tips use info-blue.
 *
 * Implementation: `inverse: true` + `color: <accent>` is the
 * portable way to render "colored background with terminal-default
 * foreground" — it adapts to dark vs light terminals without
 * hardcoding a black/white fg. Tags are never chipped; they stay in
 * the trailing ref list. The chip emits its own trailing space so
 * callers concatenate it directly into the row without a separator.
 *
 * Selection styling is opt-out: when the row is selected, the outer
 * `inverse: true` + selection background already covers everything,
 * and a second `inverse` on the chip would flip it back to plain. We
 * drop the pill styling for selected rows and let the row's own
 * inverse highlight carry through cleanly.
 *
 * Returns the rendered node alongside its cell width AND the chip
 * descriptor so the caller can pass it to `filterChippedRefs` and
 * avoid emitting the same branch a second time in the trailing list.
 */
// Exported for unit / snapshot testing in branchTipChipRender.test.ts.
// The function isn't part of the public surface of this module — the
// rest of the file is internal — but the chip-rendering logic is
// dense enough that structural snapshot tests pay for themselves.
export function renderBranchTipChip(
  h: typeof ReactTypes.createElement,
  Text: LogInkComponents['Text'],
  commit: GitLogCommitRow,
  theme: LogInkTheme,
  key: string,
  selected: boolean,
  remoteNames: string[] | undefined
): {
  node: ReactTypes.ReactElement | null
  width: number
  chip: ReturnType<typeof getBranchTipChip>
} {
  const chip = getBranchTipChip(commit.refs, remoteNames)
  if (!chip) return { node: null, width: 0, chip }

  const truncated = truncateCells(chip.name, BRANCH_CHIP_MAX_NAME_WIDTH)
  // Inner pill body is `name`; the trailing space sits OUTSIDE the
  // colored block so the bg doesn't bleed into the message column.
  // The brackets are gone — the colored block is its own visual
  // affordance and the brackets would add 2 cells of chrome that
  // duplicate the affordance.
  const body = ` ${truncated} `

  // Selected row OR noColor mode → drop pill styling. Selected rows
  // get the row-level inverse highlight; noColor terminals fall
  // back to bracketed text so the chip still parses visually.
  if (selected || theme.noColor) {
    const fallbackLabel = `[${truncated}] `
    return {
      node: h(Text, { key, bold: chip.isHead }, fallbackLabel),
      width: cellWidth(fallbackLabel),
      chip,
    }
  }

  // Three-way colour assignment matches `BranchTipChipKind`:
  //
  //   - HEAD  → success (the user's current branch — bright green)
  //   - local → info    (other local branches — calm blue)
  //   - remote → muted  (remote-tracking refs like origin/main —
  //                      a pure fact, not a warning; dim so it doesn't
  //                      compete with semantic warning uses of yellow)
  //
  // Prior to #1368 remote chips used `warning`, which overloaded
  // yellow with non-actionable information. Muted keeps the chip
  // visibly distinct from local blue without the "pay attention" cue.
  const accent =
    chip.kind === 'head'
      ? theme.colors.success
      : chip.kind === 'remote'
        ? theme.colors.muted
        : theme.colors.info
  return {
    node: h(Text, {},
      h(Text, { key, inverse: true, color: accent, bold: chip.isHead }, body),
      h(Text, { key: `${key}-pad` }, ' '),
    ),
    width: cellWidth(body) + 1,
    chip,
  }
}

export function formatHistoryFetchArgs(args: LogInkHistoryFetchArgs): string {
  const parts: string[] = []
  if (args.author) parts.push(`--author=${args.author}`)
  if (args.path) parts.push(`-- ${args.path}`)
  // #1361 — pickaxe (S:) and grep-diff (G:) were missing here, so an
  // active server-side filter of either kind fell through to the
  // 'none' fallback below, misleading the user into thinking no
  // filter was applied.
  if (args.pickaxe) parts.push(`-S${args.pickaxe}`)
  if (args.grep) parts.push(`-G${args.grep}`)
  return parts.join(' ') || 'none'
}

/**
 * Render a commit subject with the conventional-commit prefix
 * (`feat:`, `fix(scope)!:`, …) painted in a type-specific color so
 * the eye can bucket commits by type while scanning.
 *
 * Truncation lives at the message level above this helper — the
 * caller has already shortened `text` to the available room. We just
 * split on the parsed prefix length and emit two spans. If the
 * shortened text is too narrow to include the full prefix (e.g. a
 * tight panel that cut into `feat`), we fall back to a single plain
 * span so the partial prefix doesn't read as a malformed colored
 * fragment.
 *
 * Returns the spans flat so the caller can splat them into the row's
 * outer Text alongside other segments without an extra wrapper.
 */
function renderTypedSubject(
  h: typeof ReactTypes.createElement,
  Text: LogInkComponents['Text'],
  text: string,
  theme: LogInkTheme,
  key: string,
  suppressColor: boolean = false
): ReactTypes.ReactElement[] {
  const parsed = parseConventionalCommitPrefix(text)
  if (!parsed) {
    return [h(Text, { key: `${key}-msg` }, text)]
  }
  if (text.length < parsed.prefix.length) {
    return [h(Text, { key: `${key}-msg` }, text)]
  }
  // When the row is selected (inverted), suppress the type color so
  // text inherits the dark inverted foreground and stays readable.
  const color = suppressColor ? undefined : getConventionalCommitColor(parsed, theme)
  return [
    h(Text, { key: `${key}-type`, color, bold: parsed.breaking }, parsed.prefix),
    h(Text, { key: `${key}-rest` }, text.slice(parsed.prefix.length)),
  ]
}

/**
 * Render `LaneSegment[]` as a flat list of Text spans, one per lane
 * (#791 stage 2). Each segment paints in its lane's palette color so
 * the eye can follow a branch column-by-column; segments without a
 * lane id (spaces, padding, decorations) fall back to the muted graph
 * color so they visually recede.
 *
 * Final padding is appended as its own span so callers do not need to
 * pre-pad the graph string before computing lane segments.
 */
function renderLaneSegmentSpans(
  h: typeof ReactTypes.createElement,
  Text: LogInkComponents['Text'],
  segments: LaneSegment[],
  theme: LogInkTheme,
  padTo: number,
  keyPrefix: string,
  options: { suppressColor?: boolean } = {}
): ReactTypes.ReactElement[] {
  const muted = theme.noColor ? undefined : theme.colors.muted
  const elements: ReactTypes.ReactElement[] = []
  let totalLen = 0

  segments.forEach((seg, idx) => {
    // Lane coloring WITHOUT bold — content (messages, semantic colors)
    // should outweigh topology (#1368 item 2). Non-lane decoration
    // (spaces, standalone diagonals) stays in the muted color so it
    // recedes on its own.
    const hasLane = seg.laneId !== undefined
    const laneColor = options.suppressColor ? undefined : (getLaneColor(seg.laneId, theme) ?? muted)
    elements.push(h(Text, {
      key: `${keyPrefix}-${idx}`,
      color: laneColor,
      dimColor: theme.noColor && !hasLane,
    }, seg.text))
    totalLen += seg.text.length
  })

  if (padTo > totalLen) {
    elements.push(h(Text, { key: `${keyPrefix}-pad` }, ' '.repeat(padTo - totalLen)))
  }

  return elements
}

/**
 * Render a single commit row with each segment in its own colored span.
 * Graph chars render in `theme.colors.muted` so the topology visually
 * recedes; shortHash takes the accent so the eye lands on the commit
 * identifier first; date is dimmed; message is normal; ref labels
 * (`[HEAD -> main]`) trail in accent. Selection styling is applied at
 * the outer span via `backgroundColor` / `inverse` so the highlight
 * fills the whole row regardless of inner-span coloring.
 *
 * Truncation is per-segment so the variable-length message field gets
 * the leftover budget after fixed segments are accounted for.
 */
function renderCommitHistoryRow(
  h: typeof ReactTypes.createElement,
  Text: LogInkComponents['Text'],
  commit: GitLogCommitRow,
  graph: string,
  graphWidth: number,
  selected: boolean,
  theme: LogInkTheme,
  index: number,
  panelWidth: number,
  density: LogInkLayoutDensity,
  fullGraph: boolean,
  bucketed: boolean,
  now: Date,
  laneSegments?: LaneSegment[],
  isRecent: boolean = false,
  remoteNames?: string[]
): ReactTypes.ReactElement {
  // Total cells available to the row content. Earlier revisions used a
  // hardcoded 140 here, which let row content overflow whenever the
  // panel was narrower than that — Ink would wrap onto a second visual
  // line and the next commit's graph indicator landed against the wrap
  // continuation rather than its own commit (#830). Subtracting 4
  // accounts for the panel's left + right border + 1-cell padding.
  const totalWidth = Math.max(20, panelWidth - 4)
  const dateText = pickDateText(commit, density, fullGraph, bucketed, now)
  const dateSegmentWidth = dateText ? dateText.length + 1 : 0
  // Branch chip prefix — only renders in full-graph mode so compact
  // (scan) mode stays minimal. Chip occupies cells immediately after
  // the shortHash and before the message; truncation math reserves
  // its width before sizing the message column. Trailing refs filter
  // out whatever the chip already shows so the row doesn't print
  // `[main] feat: x [HEAD -> main]` with the same info on both ends.
  const chip = fullGraph
    ? renderBranchTipChip(h, Text, commit, theme, `${commit.hash}-${index}-chip`, selected, remoteNames)
    : { node: null, width: 0, chip: undefined }
  const refs = formatInkRefLabels(filterChippedRefs(commit.refs, chip.chip, remoteNames))
  // The "just landed" marker prepends 2 cells (`▎ ` / `* `) — the
  // stacked variant budgets it via recentMarkerWidth, and omitting it
  // here made marked rows wrap for ~5s after every commit (#1390).
  const recentMarkerWidth = isRecent ? 2 : 0
  const fixedWidth =
    graphWidth + 1 + commit.shortHash.length + 1 + dateSegmentWidth + chip.width + recentMarkerWidth
  // Refs trail the message and shrink first when the row is narrow:
  // the user can always see the full ref list in the inspector, so
  // the headline subject keeps priority over decoration.
  const refsRoom = Math.max(0, totalWidth - fixedWidth - 8)
  const refsTrunc = refs ? truncateCells(refs, refsRoom) : ''
  const messageRoom = Math.max(8, totalWidth - fixedWidth - cellWidth(refsTrunc))
  const message = truncateCells(commit.message, messageRoom)

  const selectedBg = selected && !theme.noColor ? theme.colors.selection : undefined
  // Don't use inverse — it makes child colors unreadable. Instead, set a
  // background on the row AND an explicit, contrast-guaranteed foreground
  // (`selectionForeground`, derived from the selection bg) on the outer
  // span. Suppressing each child's own color to `undefined` then lets it
  // inherit that readable foreground — so the whole selected row stays
  // legible regardless of the user's terminal default foreground, which
  // is what the old "rely on the default fg" approach got wrong.
  const selectedFg = selected && !theme.noColor ? theme.colors.selectionForeground : undefined
  const accent = selected ? undefined : (theme.noColor ? undefined : theme.colors.accent)
  const muted = selected ? undefined : (theme.noColor ? undefined : theme.colors.muted)

  // Lane-colored graph spans when full graph mode + non-ASCII rendering
  // is in play; otherwise fall back to the legacy single-muted span so
  // compact mode and legacy terminals stay visually unchanged.
  const graphChildren = laneSegments && !theme.ascii
    ? renderLaneSegmentSpans(h, Text, laneSegments, theme, graphWidth, `c${index}`, { suppressColor: selected })
    : [h(Text, { color: muted, dimColor: !selected && theme.noColor },
        substituteGraphChars(graph.padEnd(graphWidth), { ascii: theme.ascii }))]

  return h(Text, {
    key: `${commit.hash}-${index}`,
    backgroundColor: selectedBg,
    color: selectedFg,
  },
  ...graphChildren,
  ' ',
  // "Just landed" marker — a single thick vertical bar in the
  // accent color before the short hash. Fades when the runtime
  // clears state.recentCommitHashes (~5s after the operation).
  // ASCII fallback uses `*` since terminals without unicode can't
  // render `▎`.
  isRecent
    ? h(Text, {
        color: theme.noColor ? undefined : theme.colors.accent,
        bold: true,
      }, theme.ascii ? '* ' : '▎ ')
    : null,
  h(Text, {
    color: accent,
    // Bold both selected AND just-landed commits — the marker is
    // the primary cue but boldness makes the row read as "this is
    // worth looking at" even without color.
    bold: selected || isRecent,
  }, commit.shortHash),
  ' ',
  // Date column drops out entirely at `tight` density — no spacer
  // either, so the message column slides left into the freed cells.
  dateText
    ? h(Text, { key: `${commit.hash}-${index}-date`, dimColor: !selected }, dateText, ' ')
    : null,
  // Branch chip prefix (full-graph mode only) lands right before the
  // message so the eye reads "branch · subject" as a unit.
  chip.node,
  ...renderTypedSubject(h, Text, message, theme, `${commit.hash}-${index}-subj`, selected),
  refsTrunc ? h(Text, { color: accent }, refsTrunc) : null)
}

/**
 * Stacked variant used at `rowMode='stacked'` (rail tier). Each
 * commit takes two lines so the message never has to share its row
 * with the date / refs / hash on a sub-90-cell terminal:
 *   line 1: graph · shortHash · subject
 *   line 2: dim padding · date · refs
 *
 * Selection styling lives on the line-1 outer span; the secondary
 * line stays dim regardless of selection so it doesn't pull the eye
 * away from the subject.
 */
function renderStackedCommitHistoryRow(
  h: typeof ReactTypes.createElement,
  Text: LogInkComponents['Text'],
  Box: LogInkComponents['Box'],
  commit: GitLogCommitRow,
  graph: string,
  graphWidth: number,
  selected: boolean,
  theme: LogInkTheme,
  index: number,
  panelWidth: number,
  fullGraph: boolean,
  now: Date,
  laneSegments?: LaneSegment[],
  isRecent: boolean = false,
  remoteNames?: string[],
  bucketed: boolean = false,
): ReactTypes.ReactElement {
  const totalWidth = Math.max(20, panelWidth - 4)
  // Suppress child colors on selected rows so each span inherits the
  // contrast-guaranteed `selectionForeground` set on the line-1 span,
  // keeping the selected row readable against the selection bg.
  const accent = selected ? undefined : (theme.noColor ? undefined : theme.colors.accent)
  const muted = selected ? undefined : (theme.noColor ? undefined : theme.colors.muted)
  const selectedBg = selected && !theme.noColor ? theme.colors.selection : undefined
  const selectedFg = selected && !theme.noColor ? theme.colors.selectionForeground : undefined

  // Line 1 — subject row. Mostly mirrors the single-line layout but
  // skips the date and refs so the message has the whole tail to
  // itself. Branch chip rides between the hash and the subject the
  // same way as the single-line variant, but only in full-graph mode.
  const recentMarkerWidth = isRecent ? 2 : 0
  const chip = fullGraph
    ? renderBranchTipChip(h, Text, commit, theme, `${commit.hash}-${index}-stk-chip`, selected, remoteNames)
    : { node: null, width: 0, chip: undefined }
  const lineOneFixed =
    graphWidth + 1 + commit.shortHash.length + 1 + recentMarkerWidth + chip.width
  const subject = truncateCells(commit.message, Math.max(8, totalWidth - lineOneFixed))

  const graphChildren = laneSegments && !theme.ascii
    ? renderLaneSegmentSpans(h, Text, laneSegments, theme, graphWidth, `cs${index}`, { suppressColor: selected })
    : [h(Text, { color: muted, dimColor: !selected && theme.noColor },
        substituteGraphChars(graph.padEnd(graphWidth), { ascii: theme.ascii }))]

  const lineOne = h(Text, {
    key: `${commit.hash}-${index}-l1`,
    backgroundColor: selectedBg,
    color: selectedFg,
  },
  ...graphChildren,
  ' ',
  isRecent
    ? h(Text, { color: accent, bold: true }, theme.ascii ? '* ' : '▎ ')
    : null,
  h(Text, { color: accent, bold: selected || isRecent }, commit.shortHash),
  ' ',
  chip.node,
  ...renderTypedSubject(h, Text, subject, theme, `${commit.hash}-${index}-stk-subj`, selected))

  // Line 2 — metadata row, padded to align with the start of the
  // shortHash on line 1 so the eye still groups them as one commit.
  // Selection background does not extend here so we don't get a thick
  // double-row highlight on a tight terminal. Trailing refs are
  // filtered against the chip so we don't repeat the branch tip both
  // as a leading chip and a trailing label.
  const indent = ' '.repeat(graphWidth + 1)
  const refs = formatInkRefLabels(filterChippedRefs(commit.refs, chip.chip, remoteNames))
  // When bucketing is active, the bucket header already conveys the
  // timeframe — a per-row date is redundant. If the commit also has
  // no refs, line 2 would only show "1d" / "3d" (or a bare `·`),
  // which at rail widths makes the whole list read as double-spaced
  // noise. Collapse to a single-line row in that case so the graph
  // is dense and readable on tiny terminals (#1421).
  if (bucketed && !refs) {
    return h(Box, {
      key: `${commit.hash}-${index}-stack`,
      flexDirection: 'column',
    }, lineOne)
  }

  const dateText = bucketed && refs ? '' : formatCompactRelativeDate(commit.date, now)
  const metaRoom = Math.max(8, totalWidth - indent.length - (dateText ? dateText.length + 1 : 0))
  const refsTrunc = refs ? truncateCells(refs, metaRoom) : ''
  // If both pieces are empty (date unparseable + no refs), show a
  // bullet so the row's structure still reads as two-line and the
  // user doesn't think they hit a render bug.
  const metaContent = dateText || refsTrunc
    ? [
        dateText ? h(Text, { key: `${commit.hash}-${index}-l2-date` }, dateText) : null,
        dateText && refsTrunc ? h(Text, { key: `${commit.hash}-${index}-l2-sep` }, ' ') : null,
        refsTrunc ? h(Text, { key: `${commit.hash}-${index}-l2-refs` }, refsTrunc) : null,
      ].filter(Boolean)
    : [h(Text, { key: `${commit.hash}-${index}-l2-empty` }, '·')]

  const lineTwo = h(Text, {
    key: `${commit.hash}-${index}-l2`,
    dimColor: true,
  }, indent, ...metaContent)

  return h(Box, {
    key: `${commit.hash}-${index}-stack`,
    flexDirection: 'column',
  }, lineOne, lineTwo)
}

/**
 * Render the synthetic "(+) new commit" affordance shown above the real
 * commit list when the worktree is dirty. Pressing up at `selectedIndex 0`
 * focuses this row; pressing Enter pushes the status view so the user can
 * stage / commit.
 */
function renderPendingCommitRow(
  h: typeof ReactTypes.createElement,
  Text: LogInkComponents['Text'],
  worktree: NonNullable<LogInkContext['worktree']>,
  selected: boolean,
  theme: LogInkTheme,
  panelWidth: number
): ReactTypes.ReactElement {
  const parts: string[] = []
  if (worktree.stagedCount) {
    parts.push(`${worktree.stagedCount} staged`)
  }
  if (worktree.unstagedCount) {
    parts.push(`${worktree.unstagedCount} unstaged`)
  }
  if (worktree.untrackedCount) {
    parts.push(`${worktree.untrackedCount} untracked`)
  }
  const summary = parts.length ? parts.join(' · ') : 'pending changes'
  const label = `${theme.ascii ? '[+]' : '(+)'} New commit · ${summary}`

  return h(Text, {
    key: 'pending-commit-row',
    bold: true,
    // On selection, swap to the contrast-guaranteed foreground so the
    // accent label doesn't wash out against the selection bar.
    color: selected && !theme.noColor
      ? theme.colors.selectionForeground
      : (theme.noColor ? undefined : theme.colors.accent),
    backgroundColor: selected && !theme.noColor ? theme.colors.selection : undefined,
  }, truncateCells(label, Math.max(20, panelWidth - 4)))
}

/**
 * Full-panel loader shown over the history surface while a remote
 * operation (fetch / pull / push) is in flight. Same bordered frame
 * and `Commits` title row as the real panel so the swap in/out is
 * seamless: a centered spinner + label + a travelling arrow track
 * give the user an unmistakable "we're talking to the remote" beat in
 * place of a frozen, soon-to-abruptly-repaint commit list.
 */
function renderRemoteOpLoader(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  width: number,
  bodyRows: number,
  theme: LogInkTheme,
  focused: boolean,
  spinnerFrame: number
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const op = state.remoteOp
  if (!op) {
    return h(Box, { width })
  }
  const spinner = pickSpinnerFrame(spinnerFrame)
  // Directional glyph hints which way the bits are flowing.
  const glyph = op.kind === 'push' ? '↑' : op.kind === 'pull' ? '↓' : '↕'
  // A single glyph "travels" along a dotted track each tick so the
  // motion reads even on terminals that render braille spinners poorly.
  const trackWidth = 9
  const pos = Math.max(0, spinnerFrame) % trackWidth
  const track = Array.from({ length: trackWidth }, (_, i) => (i === pos ? glyph : '·')).join(' ')
  const accent = theme.noColor ? undefined : theme.colors.accent
  const innerHeight = Math.max(3, bodyRows - 2)

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    flexShrink: 0,
    paddingX: 1,
    width,
  },
  h(Box, { justifyContent: 'space-between' },
    h(Text, { bold: true }, panelTitle('Commits', focused)),
    h(Text, { dimColor: true }, `${op.kind} in progress`)
  ),
  h(Box, {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: innerHeight,
  },
    h(Text, { color: accent, bold: true }, `${spinner}  ${op.label}`),
    h(Text, undefined, ''),
    h(Text, { color: accent }, track),
    h(Text, undefined, ''),
    h(Text, { dimColor: true }, 'Talking to the remote — history refreshes automatically.')))
}

export function renderHistoryPanel(
  ctx: SurfaceRenderContext,
  hasMoreCommits: boolean,
  loadingMoreCommits: boolean,
  density: LogInkLayoutDensity,
  rowMode: 'single' | 'stacked',
  dateBucketingEnabled: boolean = false,
  now: Date = getRenderNow(),
  spinnerFrame: number = 0
): ReactTypes.ReactElement {
  const { h, components, state, context, bodyRows, width, theme } = ctx
  const { Box, Text } = components
  const focused = state.focus === 'commits'

  // Remote op in flight (fetch / pull / push) → swap the commit list
  // for a centered, animated loader. Keeping the same bordered panel
  // (same width, same title row) means that when the op completes and
  // `remoteOp` clears, the fresh rows paint in place without the panel
  // jumping — smoothing over the "frozen list → sudden repaint" feel.
  if (state.remoteOp) {
    return renderRemoteOpLoader(h, components, state, width, bodyRows, theme, focused, spinnerFrame)
  }
  const worktree = context.worktree
  // Distinct remote names seen across the repo's remote-tracking
  // branches — `['origin']` for a typical fork, `['origin', 'upstream']`
  // when the user has both. Used to classify branch-tip chips so a
  // slashed local branch like `feat/x` doesn't get mis-coloured as
  // remote. When branch data hasn't loaded yet, `undefined` makes the
  // chip helper fall back to the legacy slash-based heuristic.
  const remoteNames = context.branches?.remoteBranches
    ? Array.from(
        new Set(
          context.branches.remoteBranches
            .map((branch) => branch.remote)
            .filter((remote): remote is string => Boolean(remote))
        )
      )
    : undefined
  // Set of just-landed commit hashes for the "new commit" marker.
  // Populated for ~5s after a split-apply or other commit-creating
  // operation; auto-cleared by the runtime so it doesn't linger.
  const recentCommitsSet = new Set(state.recentCommitHashes?.hashes || [])
  const worktreeDirty = Boolean(
    worktree && (worktree.stagedCount + worktree.unstagedCount + worktree.untrackedCount) > 0
  )
  // The synthetic "(+) new commit" row only appears when the worktree is
  // dirty AND the visible window is anchored at the top of the list — i.e.
  // the first real commit (selectedIndex 0) is in view. Scroll past that
  // and the row slides off naturally; the user can `gg` to bring it back.
  const showPendingRow = worktreeDirty &&
    !state.filter &&
    state.selectedIndex === 0
  // Stacked rows take two terminal lines each, so the visible item
  // budget is halved before the pending-row / chrome subtraction.
  // Full-graph mode injects a spacer row after every commit for
  // comfortable rhythm — the data-layer items still count 1 per row,
  // so the listRows budget passes straight through; the spacer rows
  // just consume some of that budget instead of additional commits.
  // Date bucketing is the new way the surface communicates "when" —
  // headers replace the per-row date column whenever the result set
  // is chronological (no active filter) AND the user has bucketing
  // enabled in `logTui.dateBucketing`. The filter check is the second
  // guardrail: even with bucketing enabled, an active search filter
  // shuffles commits by relevance so the adjacent-bucket invariant
  // breaks down and the dividers would read as noise.
  // Stacked rows already cost two terminal lines, so the per-commit
  // transition row (comfortable rhythm on wide layouts) pushed each commit
  // to ~3 lines at rail widths — the list read as mostly air. Rail mode
  // keeps the lane rails on commit rows but skips the dedicated topology
  // line between them.
  const fullGraphSpacing = state.fullGraph && !state.filter && rowMode !== 'stacked'
  const dateBucketingNow = !dateBucketingEnabled || state.filter ? undefined : now
  // Hoisted so the row budget can count the banner (#1392) — it used
  // to be computed inline in the return, invisible to chromeRows.
  const currentBranchRef = context.branches?.localBranches.find((branch) => branch.current)
  const upstreamBanner = formatUpstreamAheadBanner(currentBranchRef, { ascii: theme.ascii })
  // Conditional single-line chrome must be budgeted (#1392): with the
  // upstream-ahead banner and the path:/author: fetch indicator both
  // showing, the panel grew past its box and pushed the footer down.
  const chromeRows = (showPendingRow ? 5 : 4)
    + (upstreamBanner ? 1 : 0)
    + (state.historyFetchArgs ? 1 : 0)
  // Stacked rows normally take two terminal lines each, so the item
  // budget is the line budget halved. But when bucketing is active,
  // commits without refs collapse to a single line (#1421) — only
  // branch-tip / tagged commits keep the metadata row. In practice
  // ~80-90% of visible commits carry no refs, so the effective lines
  // per item is much closer to 1 than 2. A divisor of 1.4 fills the
  // panel densely while leaving headroom for the occasional 2-line
  // row and the bucket headers (1 line each). Without bucketing the
  // old /2 ratio applies (every row is two lines). Safe direction:
  // under-fill never overflows.
  const stackedDivisor = dateBucketingNow ? 1.4 : 2
  const listRows = rowMode === 'stacked'
    ? Math.max(2, Math.floor((bodyRows - chromeRows) / stackedDivisor))
    : Math.max(3, bodyRows - chromeRows)
  const visible = getVisibleLogInkHistory(state, listRows, { fullGraphSpacing, dateBucketingNow })
  const loadState = loadingMoreCommits
    ? 'Loading older commits…'
    : hasMoreCommits
      ? 'more below'
      : undefined
  // Only show the fraction when a filter is active or rows were trimmed
  const title = state.filteredCommits.length < state.commits.length
    ? `${state.filteredCommits.length}/${state.commits.length}`
    : `${state.commits.length} commits`
  // Show graph mode only when compact (the exception state worth noting)
  const graphMode = state.fullGraph ? undefined : 'compact'
  // #1361 — surface an active cherry-pick range anchor in the header,
  // same chip convention as the branches/stash surfaces. Deliberately
  // NOT a per-row highlight in the graph (row rendering here is
  // considerably more involved — graph lines, stacked mode, date
  // bucketing — and the status-line feedback on `v` + the confirm
  // panel's target line already tell the user what's spanned).
  const rangeLabel = state.selection?.view === 'history' && state.selection.anchorId
    ? 'range: v..cursor'
    : undefined

  const pendingRowSelected = showPendingRow && Boolean(state.pendingCommitFocused) && focused
  // Real-commit selection is suppressed while the cursor is on the pending
  // row so the visible cursor only renders in one place at a time.
  const realSelectionSuppressed = state.pendingCommitFocused

  const pendingNode = showPendingRow
    ? renderPendingCommitRow(h, Text, worktree!, pendingRowSelected, theme, width)
    : null

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    flexShrink: 0,
    paddingX: 1,
    width,
  },
  h(Box, { justifyContent: 'space-between' },
    h(Text, { bold: true }, panelTitle('Commits', focused)),
    h(Text, { dimColor: true }, [title, rangeLabel, graphMode, loadState].filter(Boolean).join(' · '))
  ),
  // Upstream-ahead banner. Surfaces "the remote has work you don't"
  // for the current branch — distinct from the chip work in 0.52.0
  // which colours remote refs IN the row set. On a behind branch the
  // upstream commits aren't reachable from local HEAD, so the chips
  // alone can't signal "fetch / pull needed." This single line does.
  //
  // Two wording variants (behind-only vs diverged) live in the
  // helper; render is identical aside from the formatted string.
  // Warning yellow = same semantic as the remote-tracking chip kind.
  ...(upstreamBanner
    ? [h(Text, {
      key: 'upstream-ahead-banner',
      color: theme.noColor ? undefined : theme.colors.warning,
    }, upstreamBanner)]
    : []),
  // Server-side filter indicator (#776). Only rendered when the user
  // has an active path:/author: prefix; clears when they Ctrl+U.
  ...(state.historyFetchArgs
    ? [h(Text, { key: 'history-fetch-indicator', dimColor: true },
        `filter: ${formatHistoryFetchArgs(state.historyFetchArgs)}  (ctrl+u in / to clear)`)]
    : []),
  ...(pendingNode ? [pendingNode] : []),
  visible.items.length === 0
    ? h(Text, { dimColor: true }, state.bootLoading
        ? formatLogInkLoading({ resource: 'commits' })
        : formatLogInkHistoryEmpty({
          filter: state.filter,
          totalCommits: state.commits.length,
        }))
    : visible.items.map((item, index) => {
      if (item.type === 'bucket-header') {
        // Section divider — `── Today ────────────`. The label is
        // bold to anchor the eye, the surrounding rule is dim so
        // the divider reads as chrome rather than competing with
        // commit content. Rule fills the panel's interior width
        // (minus border + padding); the label rides inside it.
        const contentWidth = Math.max(10, width - 4)
        const labelCells = cellWidth(item.label) + 2 // pad the label with surrounding spaces
        const ruleAfter = Math.max(0, contentWidth - 3 - labelCells)
        return h(Text, {
          key: `bucket-${index}-${item.label}`,
          dimColor: true,
        },
          h(Text, undefined, '── '),
          h(Text, { bold: true }, item.label),
          h(Text, undefined, ' '),
          h(Text, undefined, '─'.repeat(ruleAfter)),
        )
      }

      if (item.type === 'graph') {
        // Graph-only rows — git's fork/close junctions plus the
        // synthetic spacers we inject between linear commits. Both just
        // carry lanes between commits, so they render at the same lane
        // weight as the commit rows; `renderLaneSegmentSpans` bolds the
        // tracked lanes and mutes the non-lane decoration per-segment,
        // so the row no longer needs a blanket dim (which used to make a
        // lane flicker dim every time it crossed a junction — #831).
        if (item.laneSegments && !theme.ascii) {
          return h(Text, {
            key: `graph-${index}-${item.graph}`,
          },
            ...renderLaneSegmentSpans(
              h, Text, item.laneSegments, theme, visible.graphWidth, `g${index}`
            ))
        }
        // Legacy / ASCII fallback (no lane segments): the trunk has no
        // per-lane color, so dim the synthetic spacers a touch less than
        // git's own connectors to preserve the old vertical rhythm.
        return h(Text, {
          key: `graph-${index}-${item.graph}`,
          color: theme.noColor ? undefined : theme.colors.muted,
          dimColor: item.spacer !== true,
        }, truncateCells(substituteGraphChars(
          item.graph.padEnd(visible.graphWidth),
          { ascii: theme.ascii }
        ), Math.max(8, width - 4)))
      }

      if (rowMode === 'stacked') {
        return renderStackedCommitHistoryRow(
          h, Text, Box, item.commit, item.graph, visible.graphWidth,
          Boolean(item.selected) && !realSelectionSuppressed, theme, index,
          width, state.fullGraph, now, item.laneSegments,
          recentCommitsSet.has(item.commit.hash),
          remoteNames,
          Boolean(dateBucketingNow)
        )
      }
      return renderCommitHistoryRow(
        h, Text, item.commit, item.graph, visible.graphWidth,
        Boolean(item.selected) && !realSelectionSuppressed, theme, index,
        width, density, state.fullGraph, Boolean(dateBucketingNow), now,
        item.laneSegments,
        recentCommitsSet.has(item.commit.hash),
        remoteNames
      )
    }))
}
