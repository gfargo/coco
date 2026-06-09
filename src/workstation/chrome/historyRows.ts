import { GitLogCommitRow, GitLogGraphRow, GitLogRow } from '../../commands/log/data'
import { getDateBucket } from './dateBucket'
import {
  DEFAULT_COMMIT_GLYPH,
  HEAD_COMMIT_GLYPH,
  MERGE_COMMIT_GLYPH,
} from './graphChars'
import { LaneSegment } from './graphLanes'
import { computeGraphLayout, GraphLayout } from './graphLayout'
import {
  renderCommitRowSegments,
  renderRowGraphAscii,
  renderTransitionRowSegments,
} from './graphOrtho'
import { LogInkState } from '../../workstation/runtime/inkViewModel'

/**
 * Pick the commit glyph based on parent count + HEAD-ness so the
 * renderer can flag merges and the current head visually. HEAD wins
 * over merge when both apply (HEAD on a merge commit) — the ◉ ring
 * is the more salient signal and the user can still see the merge
 * via the lane topology.
 */
export function commitGlyphFor(commit: GitLogCommitRow): string {
  if (isHeadCommit(commit)) {
    return HEAD_COMMIT_GLYPH
  }
  if (commit.parents.length > 1) {
    return MERGE_COMMIT_GLYPH
  }
  return DEFAULT_COMMIT_GLYPH
}

function isHeadCommit(commit: GitLogCommitRow): boolean {
  return commit.refs.some((ref) => ref === 'HEAD' || ref.startsWith('HEAD ->'))
}

export type LogInkHistoryCommitItem = {
  type: 'commit'
  commit: GitLogCommitRow
  graph: string
  /**
   * Lane-colored segments for the rendered graph prefix. Only attached
   * in full graph mode; compact mode renders a single `*` per commit so
   * lane tracking is not meaningful and segments stay undefined.
   */
  laneSegments?: LaneSegment[]
  selected: boolean
}

export type LogInkHistoryGraphItem = {
  type: 'graph'
  graph: string
  laneSegments?: LaneSegment[]
  /**
   * True for the synthetic vertical-only rows we inject between two
   * commits to give linear-history stretches a comfortable rhythm,
   * false (or undefined) for git's own topology rows (`|/` close,
   * `|\` fork). The renderer uses this to keep spacers at full lane
   * brightness — they read as "this is the same lane, continuing" —
   * while topology rows stay dimmed as scaffolding that should
   * recede behind the commits they connect.
   */
  spacer?: boolean
}

/**
 * Section divider injected between commits when their date bucket
 * changes. Renderer paints this as a dim horizontal rule with the
 * label inline (`── Today ───────`) so the user gets temporal
 * orientation without a per-row date column.
 *
 * Does not participate in lane tracking, selection, or scroll
 * anchoring — it's a pure presentation row. `graph` is empty so the
 * existing `graphWidth` calc doesn't widen the lane column.
 */
export type LogInkHistoryBucketHeaderItem = {
  type: 'bucket-header'
  graph: '' // satisfies the LogInkHistoryItem.graph contract
  /** Human label rendered into the divider (`Today`, `April 2026`). */
  label: string
  /**
   * Always undefined — bucket headers have no graph topology to
   * track. Declared so callers can read `item.laneSegments` across
   * the union without TypeScript needing a discriminator narrow on
   * every access; the runtime check `item.type === 'bucket-header'`
   * still works when callers want to branch on it.
   */
  laneSegments?: undefined
}

export type LogInkHistoryItem =
  | LogInkHistoryCommitItem
  | LogInkHistoryGraphItem
  | LogInkHistoryBucketHeaderItem

export type VisibleLogInkHistory = {
  graphWidth: number
  items: LogInkHistoryItem[]
}

function clampWindowStart(index: number, count: number, visibleCount: number): number {
  return Math.max(0, Math.min(index - Math.floor(visibleCount / 2), Math.max(0, count - visibleCount)))
}

function commitKey(commit: GitLogCommitRow): string {
  return commit.hash || commit.shortHash
}

function graphWidth(items: LogInkHistoryItem[]): number {
  return Math.max(1, ...items.map((item) => item.graph.length))
}

function makeCompactCommitItem(
  commit: GitLogCommitRow,
  selected: boolean
): LogInkHistoryCommitItem {
  return {
    type: 'commit',
    commit,
    graph: '*',
    // Compact mode skips lane tracking (no topology to color) but still
    // wants the merge / HEAD glyph so the user can spot them at a
    // glance. Lane id stays undefined so the segment renders muted —
    // matching the legacy compact appearance, just with a richer glyph.
    laneSegments: [{ text: commitGlyphFor(commit), laneId: undefined }],
    selected,
  }
}

function bucketHeaderItem(label: string): LogInkHistoryBucketHeaderItem {
  return { type: 'bucket-header', graph: '', label }
}

function toCompactItems(
  state: LogInkState,
  visibleCount: number,
  bucketingNow: Date | undefined
): LogInkHistoryItem[] {
  const start = clampWindowStart(state.selectedIndex, state.filteredCommits.length, visibleCount)
  const slice = state.filteredCommits.slice(start, start + visibleCount)

  if (!bucketingNow) {
    return slice.map((commit, offset) =>
      makeCompactCommitItem(commit, start + offset === state.selectedIndex)
    )
  }

  // With bucketing on: emit a sticky header above the first visible
  // commit and an additional header each time the bucket changes. The
  // header occupies one row from the visibleCount budget every time
  // it fires, so the visible commit count drops slightly in exchange
  // for always-on temporal orientation.
  const items: LogInkHistoryItem[] = []
  let prevBucket: string | undefined = undefined
  for (let offset = 0; offset < slice.length && items.length < visibleCount; offset += 1) {
    const commit = slice[offset]
    const bucket = getDateBucket(commit.date, bucketingNow)
    if (bucket.key !== prevBucket) {
      items.push(bucketHeaderItem(bucket.label))
      prevBucket = bucket.key
      if (items.length >= visibleCount) break
    }
    items.push(
      makeCompactCommitItem(commit, start + offset === state.selectedIndex)
    )
  }
  return items
}

function isSelectedCommit(row: GitLogRow, selected: GitLogCommitRow | undefined): boolean {
  return row.type === 'commit' && selected ? commitKey(row) === commitKey(selected) : false
}

/**
 * Lane layout is a pure function of the ordered commit list, so cache it
 * by the array's identity — recomputed only when the commit list itself
 * changes (a data load), never on a scroll or selection move.
 */
const layoutCache = new WeakMap<readonly GitLogCommitRow[], GraphLayout>()

function getGraphLayout(commits: GitLogCommitRow[]): GraphLayout {
  const cached = layoutCache.get(commits)
  if (cached) return cached
  const layout = computeGraphLayout(commits)
  layoutCache.set(commits, layout)
  return layout
}

/**
 * One row in the expanded full-graph list. `commit` and `transition`
 * index into the layout (and the commit list) in lockstep; bucket
 * headers are pure presentation rows.
 */
type ExpandedRow =
  | { kind: 'commit'; index: number }
  | { kind: 'transition'; index: number }
  | { kind: 'bucket-header'; label: string }

/**
 * Find the most recent bucket header at or above `start` so a slice
 * that begins mid-bucket can still surface its section label (the
 * "sticky header" behavior). Returns the label to prepend, or
 * `undefined` when none is needed.
 */
function findStickyBucketLabel(expanded: ExpandedRow[], start: number): string | undefined {
  if (start < expanded.length && expanded[start].kind === 'bucket-header') return undefined
  for (let i = start - 1; i >= 0; i -= 1) {
    const entry = expanded[i]
    if (entry.kind === 'bucket-header') return entry.label
  }
  return undefined
}

function toFullGraphItems(
  state: LogInkState,
  visibleCount: number,
  options: { withSpacers: boolean; bucketingNow: Date | undefined } = {
    withSpacers: false,
    bucketingNow: undefined,
  }
): LogInkHistoryItem[] {
  const commits = state.commits
  if (commits.length === 0) return []

  // Compute the whole layout up front (cached). Doing it globally — not
  // per visible window — means a lane's column and color are identical
  // no matter where the scroll sits, and the transition edges of the
  // last visible commit still point correctly at commits below the
  // window. This replaces the old per-render lane-tracker fast-forward.
  const layout = getGraphLayout(commits)
  const selected = state.filteredCommits[state.selectedIndex]
  const { withSpacers, bucketingNow } = options

  // Expand to (optional bucket header) + commit + (optional transition)
  // per commit across the full list, so windowing is a simple slice.
  const expanded: ExpandedRow[] = []
  let prevBucket: string | undefined
  for (let i = 0; i < commits.length; i += 1) {
    if (bucketingNow) {
      const bucket = getDateBucket(commits[i].date, bucketingNow)
      if (bucket.key !== prevBucket) {
        expanded.push({ kind: 'bucket-header', label: bucket.label })
        prevBucket = bucket.key
      }
    }
    expanded.push({ kind: 'commit', index: i })
    // The transition row carries this commit's topology (fork / merge /
    // continuation) down to the next commit and doubles as the linear
    // spacer. Off only for non-rendering callers (filters, tests) that
    // want commit rows alone.
    if (withSpacers) expanded.push({ kind: 'transition', index: i })
  }

  const selectedExpandedIndex = expanded.findIndex(
    (entry) => entry.kind === 'commit' && isSelectedCommit(commits[entry.index], selected)
  )
  const start = clampWindowStart(
    selectedExpandedIndex >= 0 ? selectedExpandedIndex : 0,
    expanded.length,
    visibleCount
  )

  // Sticky header — prepend the active bucket label when the slice
  // starts partway into a bucket; costs one row from the budget.
  const stickyLabel = bucketingNow ? findStickyBucketLabel(expanded, start) : undefined
  const sliceCount = stickyLabel ? visibleCount - 1 : visibleCount
  const sliced = expanded.slice(start, start + sliceCount)
  const finalEntries: ExpandedRow[] = stickyLabel
    ? [{ kind: 'bucket-header', label: stickyLabel }, ...sliced]
    : sliced

  return finalEntries.map((entry) => {
    if (entry.kind === 'bucket-header') {
      return bucketHeaderItem(entry.label)
    }
    const row = layout.rows[entry.index]
    if (entry.kind === 'transition') {
      return {
        type: 'graph',
        graph: renderRowGraphAscii(row, 'transition'),
        laneSegments: renderTransitionRowSegments(row),
        spacer: true,
      }
    }
    const commit = commits[entry.index]
    return {
      type: 'commit',
      commit,
      graph: renderRowGraphAscii(row, 'commit'),
      laneSegments: renderCommitRowSegments(row, commitGlyphFor(commit)),
      selected: isSelectedCommit(commit, selected),
    }
  })
}

export type GetVisibleLogInkHistoryOptions = {
  /**
   * When true and we're in full-graph mode, inject a vertical-only
   * graph row after every commit row so consecutive commits have a
   * comfortable vertical rhythm. Off by default to keep tests and
   * non-rendering callers (filters, snapshots) on the legacy zero
   * padding.
   */
  fullGraphSpacing?: boolean
  /**
   * When set, insert `bucket-header` items between commits whose
   * date buckets differ, so the surface can render section dividers
   * (`── Today ──`, `── April 2026 ──`) in place of a per-row date
   * column. The reference `Date` is the "now" used to bucket each
   * commit — callers pin it for deterministic tests; the runtime
   * passes `new Date()`. Bucketing is suppressed when a search
   * filter is active since the result set is no longer chronological.
   */
  dateBucketingNow?: Date
}

export function getVisibleLogInkHistory(
  state: LogInkState,
  visibleCount: number,
  options: GetVisibleLogInkHistoryOptions = {}
): VisibleLogInkHistory {
  // Bucketing only makes sense for chronologically ordered output —
  // an active search filter shuffles commits by relevance, so the
  // adjacent-bucket invariant breaks down and the divider would
  // read as noise.
  const bucketingNow = state.filter ? undefined : options.dateBucketingNow
  const items = state.fullGraph && !state.filter
    ? toFullGraphItems(state, visibleCount, {
        withSpacers: Boolean(options.fullGraphSpacing),
        bucketingNow,
      })
    : toCompactItems(state, visibleCount, bucketingNow)

  return {
    graphWidth: graphWidth(items),
    items,
  }
}

export function formatInkRefLabels(refs: string[]): string {
  return refs.length ? ` ${refs.map((ref) => `[${ref}]`).join(' ')}` : ''
}

export function formatInkHistoryGraphRow(row: GitLogGraphRow, width: number): string {
  return row.graph.padEnd(width)
}
