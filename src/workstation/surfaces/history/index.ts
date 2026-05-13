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
 * Extracted from `src/commands/log/inkRuntime.ts` as part of phase 5a.5
 * of #890. The supporting helpers (`renderLaneSegmentSpans`,
 * `renderCommitHistoryRow`, `renderPendingCommitRow`,
 * `formatHistoryFetchArgs`) lived in inkRuntime.ts only to support
 * this surface; they migrate together.
 */

import type * as ReactTypes from 'react'
import { substituteGraphChars } from '../../chrome/graphChars'
import type { LaneSegment } from '../../chrome/graphLanes'
import { getLaneColor } from '../../chrome/graphLanes'
import {
  formatInkRefLabels,
  getVisibleLogInkHistory,
} from '../../chrome/historyRows'
import {
  formatLogInkHistoryEmpty,
  formatLogInkLoading,
} from '../../chrome/surfaceStates'
import { cellWidth, truncateCells } from '../../chrome/text'
import type { LogInkTheme } from '../../chrome/theme'
import type { GitLogCommitRow } from '../../../commands/log/data'
import type {
  LogInkHistoryFetchArgs,
  LogInkState,
} from '../../../commands/log/inkViewModel'
import type { LogInkComponents, LogInkContext } from '../../runtime/types'
import { focusBorderColor, panelTitle } from '../../runtime/utils'

function formatHistoryFetchArgs(args: LogInkHistoryFetchArgs): string {
  const parts: string[] = []
  if (args.author) parts.push(`--author=${args.author}`)
  if (args.path) parts.push(`-- ${args.path}`)
  return parts.join(' ') || 'none'
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
  options: { forceDim?: boolean } = {}
): ReactTypes.ReactElement[] {
  const muted = theme.noColor ? undefined : theme.colors.muted
  const elements: ReactTypes.ReactElement[] = []
  let totalLen = 0

  segments.forEach((seg, idx) => {
    const laneColor = getLaneColor(seg.laneId, theme)
    elements.push(h(Text, {
      key: `${keyPrefix}-${idx}`,
      color: laneColor ?? muted,
      // Ink does not cascade dimColor from a parent Text to children,
      // so the caller's "this whole row should fade" intent has to
      // travel here as an explicit flag (#831). Used for graph-only
      // lane-closure rows, where the lane colors otherwise compete
      // for attention with the commits they connect.
      dimColor: options.forceDim || (theme.noColor && seg.laneId === undefined),
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
  laneSegments?: LaneSegment[],
  isRecent: boolean = false
): ReactTypes.ReactElement {
  const refs = formatInkRefLabels(commit.refs)
  // Total cells available to the row content. Earlier revisions used a
  // hardcoded 140 here, which let row content overflow whenever the
  // panel was narrower than that — Ink would wrap onto a second visual
  // line and the next commit's graph indicator landed against the wrap
  // continuation rather than its own commit (#830). Subtracting 4
  // accounts for the panel's left + right border + 1-cell padding.
  const totalWidth = Math.max(20, panelWidth - 4)
  const fixedWidth = graphWidth + 1 + commit.shortHash.length + 1 + commit.date.length + 1
  // Refs trail the message and shrink first when the row is narrow:
  // the user can always see the full ref list in the inspector, so
  // the headline subject keeps priority over decoration.
  const refsRoom = Math.max(0, totalWidth - fixedWidth - 8)
  const refsTrunc = refs ? truncateCells(refs, refsRoom) : ''
  const messageRoom = Math.max(8, totalWidth - fixedWidth - cellWidth(refsTrunc))
  const message = truncateCells(commit.message, messageRoom)

  const selectedBg = selected && !theme.noColor ? theme.colors.selection : undefined
  const accent = theme.noColor ? undefined : theme.colors.accent
  const muted = theme.noColor ? undefined : theme.colors.muted

  // Lane-colored graph spans when full graph mode + non-ASCII rendering
  // is in play; otherwise fall back to the legacy single-muted span so
  // compact mode and legacy terminals stay visually unchanged.
  const graphChildren = laneSegments && !theme.ascii
    ? renderLaneSegmentSpans(h, Text, laneSegments, theme, graphWidth, `c${index}`)
    : [h(Text, { color: muted, dimColor: theme.noColor },
        substituteGraphChars(graph.padEnd(graphWidth), { ascii: theme.ascii }))]

  return h(Text, {
    key: `${commit.hash}-${index}`,
    backgroundColor: selectedBg,
    inverse: selected,
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
  h(Text, { dimColor: true }, commit.date),
  ' ',
  h(Text, undefined, message),
  refsTrunc ? h(Text, { color: accent }, refsTrunc) : null)
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
  theme: LogInkTheme
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
    color: theme.noColor ? undefined : theme.colors.accent,
    inverse: selected,
    backgroundColor: selected && !theme.noColor ? theme.colors.selection : undefined,
  }, truncateCells(label, 140))
}

export function renderHistoryPanel(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  context: LogInkContext,
  bodyRows: number,
  width: number,
  theme: LogInkTheme,
  hasMoreCommits: boolean,
  loadingMoreCommits: boolean
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const focused = state.focus === 'commits'
  const worktree = context.worktree
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
  const listRows = Math.max(3, bodyRows - (showPendingRow ? 5 : 4))
  const visible = getVisibleLogInkHistory(state, listRows)
  const loadState = loadingMoreCommits
    ? 'loading older commits'
    : hasMoreCommits
      ? 'more below'
      : 'loaded'
  const title = `${state.filteredCommits.length}/${state.commits.length} commits`
  const graphMode = state.fullGraph ? 'full graph' : 'compact graph'

  const pendingRowSelected = showPendingRow && Boolean(state.pendingCommitFocused) && focused
  // Real-commit selection is suppressed while the cursor is on the pending
  // row so the visible cursor only renders in one place at a time.
  const realSelectionSuppressed = state.pendingCommitFocused

  const pendingNode = showPendingRow
    ? renderPendingCommitRow(h, Text, worktree!, pendingRowSelected, theme)
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
    h(Text, { dimColor: true }, `${title} | ${graphMode} | ${loadState}`)
  ),
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
      if (item.type === 'graph') {
        // Graph-only rows are git's lane-closure scaffolding (`|/`,
        // `|\`, etc.) — they're real topology but visually they look
        // like blank rows that the user might wonder if they
        // accidentally skipped a commit on (#831). Render dim-on-dim
        // so they retreat as connectors rather than competing with
        // commit rows for the eye's attention.
        if (item.laneSegments && !theme.ascii) {
          return h(Text, { key: `graph-${index}-${item.graph}`, dimColor: true },
            ...renderLaneSegmentSpans(
              h, Text, item.laneSegments, theme, visible.graphWidth, `g${index}`,
              { forceDim: true }
            ))
        }
        return h(Text, {
          key: `graph-${index}-${item.graph}`,
          color: theme.noColor ? undefined : theme.colors.muted,
          dimColor: true,
        }, truncateCells(substituteGraphChars(
          item.graph.padEnd(visible.graphWidth),
          { ascii: theme.ascii }
        ), Math.max(8, width - 4)))
      }

      return renderCommitHistoryRow(
        h, Text, item.commit, item.graph, visible.graphWidth,
        Boolean(item.selected) && !realSelectionSuppressed, theme, index,
        width, item.laneSegments,
        recentCommitsSet.has(item.commit.hash)
      )
    }))
}
