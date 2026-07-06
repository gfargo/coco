/**
 * Detail / inspector / preview surface family.
 *
 * Renders the right-side detail pane content. The `renderDetailPanel`
 * dispatcher (still in `inkRuntime.ts`) routes to the right exported
 * renderer in this module based on which view is active and what kind
 * of selection is in scope:
 *
 *   - history view, normal flow         → renderHistoryInspector
 *   - history view, pending commit row  → renderComposeContextPanel
 *   - status view                       → renderCommitPanel
 *   - compose view                      → renderComposeContextPanel
 *   - diff view, commit-sourced         → renderCommitDiffDetail
 *   - diff view, worktree/compare/stash → renderCommitPanel
 *   - branches view                     → renderBranchPreviewPanel
 *   - tags view                         → renderTagPreviewPanel
 *   - stash view                        → renderStashPreviewPanel
 *
 * The internal helpers (`renderInspectorActionsSection`,
 * `renderInspectorRefs`, `renderCommitFileList`, `renderPreviewPanel`)
 * are not exported — they're shared between the exported renderers
 * above. Same pattern as the history surface in 5a.5.
 *
 * Extracted from `src/workstation/runtime/inkRuntime.ts` as part of phase 5a.6
 * of #890. No behavior change.
 */

import type * as ReactTypes from 'react'
import type { LogInkContextStatus } from '../../chrome/context'
import { isLogInkContextKeyLoading } from '../../chrome/context'
import { formatHyperlink } from '../../chrome/hyperlinks'
import { clampListWindowStart } from '../../chrome/layout'
import { forgeNouns } from '../../chrome/forgeNouns'
import type {
  InspectorAction,
  InspectorActionContext,
} from '../../chrome/inspectorActions'
import { getInspectorActions } from '../../chrome/inspectorActions'
import type { PreviewLine } from '../../chrome/previewPane'
import {
  formatBranchPreview,
  formatIssueTriagePreview,
  formatPullRequestTriagePreview,
  formatStashPreview,
  formatTagPreview,
} from '../../chrome/previewPane'
import { formatLogInkLoading } from '../../chrome/surfaceStates'
import type { LfsAttributeStatus } from '../../../git/lfsAttributes'
import { isPathLfsTracked } from '../../../git/lfsAttributes'
import type { SubmoduleEntry, SubmoduleOverview } from '../../../git/submoduleData'
import { findSubmoduleByPath } from '../../../git/submoduleData'
import { cellWidth, truncateCells, truncatePathCells, wrapCells } from '../../chrome/text'
import type { LogInkTheme } from '../../chrome/theme'
import type {
  GitCommitDetail,
  GitCommitFilePreview,
} from '../../../commands/log/data'
import type { LogInkState } from '../../../workstation/runtime/inkViewModel'
import { getSelectedInkCommit } from '../../../workstation/runtime/inkViewModel'
import type { ProviderRepository } from '../../../git/providerData'
import { matchesPromotedFilter } from '../../runtime/promotedFilter'
import { sortBranches, sortTags } from '../../chrome/sorting'
import type { LogInkComponents, LogInkContext } from '../../runtime/types'
import {
  buildCommitUrl,
  buildRefUrl,
  compactHash,
  focusBorderColor,
  formatChangedFileStats,
  panelTitle,
  statusCodeColor,
} from '../../runtime/utils'

/**
 * Render the trailing "Actions:" section that surfaces which keystrokes
 * apply to whatever the inspector is focused on. Keys are colored with
 * `theme.colors.accent` so they pop as the actionable element. Destructive
 * actions get the danger color plus a `[!]` marker so they don't blend
 * into the cherry-pick / yank rows.
 *
 * Truncates labels when the inspector is narrow (down to the 26-cell
 * minimum from `getLogInkLayout`) so an overflowing label never wraps and
 * collides with the next row.
 */

/**
 * Format the file-count portion of the inspector stats line. Pluralize
 * "files" only when the count is not 1 so `1 file +12/-22` reads
 * naturally instead of `1 files`.
 */
function formatCommitStatLine(stats: { filesChanged: number; insertions: number; deletions: number }): string {
  const label = stats.filesChanged === 1 ? 'file' : 'files'
  return `${stats.filesChanged} ${label}  +${stats.insertions}/-${stats.deletions}`
}

function renderInspectorActionsSection(
  h: typeof ReactTypes.createElement,
  Text: LogInkComponents['Text'],
  context: InspectorActionContext,
  width: number,
  theme: LogInkTheme,
  options: { cursorIndex?: number; cursorActive?: boolean } = {}
): ReactTypes.ReactElement[] {
  const actions = getInspectorActions(context)
  if (!actions.length) return []

  // Width budget for each row: subtract padding + " " gutter, the key
  // column (left-padded to 5 cells so labels align), the "  " gap
  // between key and label, and the optional "  [!]" suffix (5 cells).
  const KEY_COLUMN = 5
  const GAP = '  '
  const DESTRUCTIVE_SUFFIX = '  [!]'
  const labelBudget = Math.max(
    4,
    width - 4 /* border + padX */ - KEY_COLUMN - GAP.length - DESTRUCTIVE_SUFFIX.length
  )

  const cursorIndex = options.cursorIndex ?? 0
  const cursorActive = options.cursorActive ?? false

  const nodes: ReactTypes.ReactElement[] = [
    h(Text, { key: 'actions-spacer' }, ''),
    h(Text, { key: 'actions-title' }, cursorActive ? '[Actions]' : 'Actions:'),
    ...actions.map((action: InspectorAction, index) => {
      const isSelected = cursorActive && index === cursorIndex
      // On the selected row, swap every span to the contrast-guaranteed
      // selection foreground so the key glyph / destructive marker don't
      // wash out against the selection bar; the row is already highlighted,
      // and the label text still conveys which actions are destructive.
      const selectedFg = isSelected && !theme.noColor ? theme.colors.selectionForeground : undefined
      const keyCell = action.key.padEnd(KEY_COLUMN)
      const label = truncateCells(action.label, labelBudget, { ascii: theme.ascii })
      const children: Array<string | ReactTypes.ReactElement> = [
        h(Text, {
          key: `actions-${index}-key`,
          color: selectedFg ?? (action.destructive ? theme.colors.danger : theme.colors.accent),
        }, keyCell),
        GAP,
        label,
      ]
      if (action.destructive) {
        children.push(h(Text, {
          key: `actions-${index}-mark`,
          color: selectedFg ?? theme.colors.danger,
          dimColor: false,
        }, DESTRUCTIVE_SUFFIX))
      }
      return h(Text, {
        key: `actions-${index}`,
        backgroundColor: isSelected && !theme.noColor ? theme.colors.selection : undefined,
        color: selectedFg,
      }, ...children)
    }),
  ]

  return nodes
}

/**
 * Render `refs` as a comma-separated sequence of <Text> fragments, each
 * wrapped in OSC 8 (no-op when the terminal can't render hyperlinks).
 */
function renderInspectorRefs(
  h: typeof ReactTypes.createElement,
  Text: LogInkComponents['Text'],
  refs: string[],
  repository: ProviderRepository | undefined,
  budget: number
): ReactTypes.ReactElement[] {
  // Cell-budgeted (#1390): the refs line was the ONE inspector header
  // line without truncation, and a branch-tip commit
  // (`HEAD -> main, origin/main, origin/HEAD`) wrapped the narrow
  // inspector 2-3 lines — pushing the file list past the panel — every
  // time the cursor rested on it. Refs are OSC-8 hyperlink spans, so
  // we budget whole refs (with a "+N more" overflow marker) rather
  // than slicing through escape sequences.
  const MORE_RESERVE = 8
  const out: ReactTypes.ReactElement[] = []
  let used = 0
  for (let index = 0; index < refs.length; index += 1) {
    const ref = refs[index]
    const isLast = index === refs.length - 1
    const reserve = isLast ? 0 : MORE_RESERVE
    if (index > 0 && used + 2 + cellWidth(ref) + reserve > budget) {
      out.push(h(Text, { key: 'ref-more' }, ` +${refs.length - index} more`))
      break
    }
    if (index > 0) {
      out.push(h(Text, { key: `ref-sep-${index}` }, ', '))
      used += 2
    }
    const room = budget - used - reserve
    if (cellWidth(ref) > room) {
      out.push(h(Text, { key: `ref-${index}` }, truncateCells(ref, Math.max(4, room))))
      if (!isLast) {
        out.push(h(Text, { key: 'ref-more' }, ` +${refs.length - index - 1} more`))
      }
      break
    }
    out.push(h(Text, { key: `ref-${index}` }, formatHyperlink(ref, buildRefUrl(repository, ref))))
    used += cellWidth(ref)
  }
  return out
}

/**
 * Compose a `<prefix><path><suffix>` line where the path gets smart
 * middle-elision truncation if needed, while the fixed prefix/suffix
 * decorations stay intact. Falls back to plain whole-line truncation
 * when the suffix decorations consume too much of the budget for the
 * path-aware variant to leave a meaningful filename.
 *
 * The filename is the row's identity, so it outranks the suffix: when
 * there isn't room for both, the suffix (stats, `[LFS]`, rename note)
 * is dropped first rather than letting the filename get mangled down
 * to `dat...` while the stats survive intact (#1366).
 *
 * Used by the changed-files list AND the compose-context staged /
 * unstaged sections so all three places elide identically — same
 * floor (8 cells), same fallback shape.
 */
function smartPathLabel(prefix: string, path: string, suffix: string, totalBudget: number): string {
  const prefixWidth = cellWidth(prefix)
  const suffixWidth = cellWidth(suffix)
  const filenameWidth = cellWidth(path.slice(path.lastIndexOf('/') + 1))
  const keepSuffix = suffixWidth === 0 || totalBudget - prefixWidth - suffixWidth >= filenameWidth
  const effectiveSuffix = keepSuffix ? suffix : ''

  const pathBudget = totalBudget - prefixWidth - cellWidth(effectiveSuffix)
  if (pathBudget >= 8) {
    return `${prefix}${truncatePathCells(path, pathBudget)}${effectiveSuffix}`
  }
  return truncateCells(`${prefix}${path}${effectiveSuffix}`, totalBudget)
}

/**
 * Render a list of changed files with status-code colors and stats. Used
 * by both the history inspector and the commit-diff detail panel so the
 * two surfaces stay visually consistent.
 *
 * `focused` only controls whether the cursor row is inverse-highlighted —
 * keys j/k and Enter dispatch via the input handler regardless.
 */
function renderCommitFileList(
  h: typeof ReactTypes.createElement,
  Text: LogInkComponents['Text'],
  files: GitCommitDetail['files'],
  selectedIndex: number,
  focused: boolean,
  maxRows: number,
  width: number,
  theme: LogInkTheme,
  lfsStatus?: LfsAttributeStatus
): ReactTypes.ReactElement[] {
  if (!files.length) {
    return [h(Text, { key: 'commit-file-list-empty', dimColor: true }, 'No changed files found.')]
  }

  const clamped = Math.max(0, Math.min(selectedIndex, files.length - 1))
  // Missed adoption site of the #1340 clamp (#1394): centering without
  // the lower bound under-filled the window when the cursor sat near
  // the last file.
  const startIndex = clampListWindowStart(clamped, files.length, maxRows)
  const visible = files.slice(startIndex, startIndex + maxRows)

  return visible.map((file, offset) => {
    const index = startIndex + offset
    const isSelected = index === clamped
    const cursor = isSelected ? '>' : ' '
    const stats = formatChangedFileStats(file)
    const renamed = file.oldPath ? ` (was ${file.oldPath})` : ''
    const statusCode = file.status.padEnd(3)
    // #884 — append an "LFS" badge when the file is LFS-tracked.
    // Surface-level signal: complements the patch-content rewrite
    // in `lfsPointer.ts` so even rename / mode-only rows are
    // flagged.
    const lfsBadge = lfsStatus && isPathLfsTracked(lfsStatus, file.path) ? ' [LFS]' : ''

    // Smart path truncation via `smartPathLabel`: keeps the cursor +
    // status-code prefix and the stats/badge suffix intact, gives
    // the path's remaining width budget to middle-elision so the
    // filename survives instead of getting blunt-truncated off the
    // end (the issue users hit when inspector paths read like
    // `src/commands/log/da...`).
    const labelPrefix = `${cursor} ${statusCode} `
    const labelSuffix = `${renamed}${lfsBadge}${stats ? `  ${stats}` : ''}`
    const label = smartPathLabel(labelPrefix, file.path, labelSuffix, width - 4)

    return h(Text, {
      key: `commit-file-${index}`,
      color: statusCodeColor(file.status, theme),

      bold: isSelected,
    }, label)
  })
}

function renderPreviewPanel(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  title: string,
  lines: PreviewLine[],
  width: number,
  theme: LogInkTheme,
  focused: boolean
): ReactTypes.ReactElement {
  const { Box, Text } = components
  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    width,
    paddingX: 1,
  },
  h(Text, { bold: true }, panelTitle(title, focused)),
  ...lines.map((line, index) => {
    const isHeading = line.emphasis === 'heading' && index > 0
    return h(Text, {
      key: `preview-${index}`,
      bold: isHeading,
      dimColor: line.emphasis === 'dim',
    }, truncateCells(line.text, width - 4, { ascii: theme.ascii }))
  }))
}

/**
 * Submodule info block (#884). When the cursored file is a
 * registered submodule, append a short metadata block to the
 * inspector so the user sees what they're looking at:
 *
 *   Submodule: vendor/lib
 *     pinned:    1234567a  (modified)
 *     tracking:  main
 *     remote:    git@github.com:org/lib.git
 *
 * Returns an empty array when the cursored file isn't a submodule
 * or the loader hasn't populated the overview yet — the inspector
 * falls back to its existing rendering.
 */
function renderSubmoduleInspectorBlock(
  h: typeof ReactTypes.createElement,
  Text: LogInkComponents['Text'],
  width: number,
  cursoredFilePath: string | undefined,
  submodules: SubmoduleOverview | undefined,
): ReactTypes.ReactElement[] {
  if (!cursoredFilePath || !submodules?.hasSubmodules) return []
  const entry = findSubmoduleByPath(submodules, cursoredFilePath)
  if (!entry) return []
  return renderSubmoduleEntryLines(h, Text, width, entry)
}

export function renderSubmoduleEntryLines(
  h: typeof ReactTypes.createElement,
  Text: LogInkComponents['Text'],
  width: number,
  entry: SubmoduleEntry,
): ReactTypes.ReactElement[] {
  const flagLabel = entry.flag === 'clean' ? ''
    : entry.flag === 'modified' ? '  (modified)'
      : entry.flag === 'uninitialized' ? '  (uninitialized)'
        : '  (conflicted)'
  const sha = entry.pinnedSha ? entry.pinnedSha.slice(0, 8) : '<unknown>'
  return [
    h(Text, { key: 'submodule-spacer' }, ''),
    h(Text, { key: 'submodule-header', bold: true },
      truncateCells(`Submodule: ${entry.name}`, width - 4)),
    h(Text, { key: 'submodule-pinned', dimColor: true },
      truncateCells(`  pinned:    ${sha}${flagLabel}`, width - 4)),
    ...(entry.trackingBranch
      ? [h(Text, { key: 'submodule-tracking', dimColor: true },
        truncateCells(`  tracking:  ${entry.trackingBranch}`, width - 4))]
      : []),
    ...(entry.url
      ? [h(Text, { key: 'submodule-url', dimColor: true },
        truncateCells(`  remote:    ${entry.url}`, width - 4))]
      : []),
  ]
}

/**
 * Condensed at-rest body for `renderHistoryInspector` (#1366): the
 * subject (wrapped, max 2 lines), `hash · date`, the stats line, and
 * one dim hint — nothing else. Refs, the file list, the submodule
 * block, and the actions section are reserved for when the inspector
 * is focused and has the width (36-60 cells) to show them without
 * truncating every line.
 */
function renderInspectorAtRest(
  h: typeof ReactTypes.createElement,
  Text: LogInkComponents['Text'],
  detail: GitCommitDetail,
  width: number,
  theme: LogInkTheme
): ReactTypes.ReactElement[] {
  const innerWidth = width - 4
  const subjectLines = wrapCells(detail.message, innerWidth).slice(0, 2)
  const metaLine = `${compactHash(detail.hash)} · ${detail.date}`
  const statLine = formatCommitStatLine(detail.stats)

  return [
    ...subjectLines.map((line, index) => h(Text, {
      key: `at-rest-subject-${index}`,
    }, truncateCells(line, innerWidth, { ascii: theme.ascii }))),
    h(Text, { key: 'at-rest-meta', dimColor: true },
      truncateCells(metaLine, innerWidth, { ascii: theme.ascii })),
    h(Text, { key: 'at-rest-stats', dimColor: true },
      truncateCells(statLine, innerWidth, { ascii: theme.ascii })),
    h(Text, { key: 'at-rest-hint', dimColor: true },
      truncateCells('tab → inspect', innerWidth, { ascii: theme.ascii })),
  ]
}

export function renderHistoryInspector(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  context: LogInkContext,
  _contextStatus: LogInkContextStatus,
  detail: GitCommitDetail | undefined,
  loading: boolean,
  _filePreview: GitCommitFilePreview | undefined,
  _filePreviewLoading: boolean,
  width: number,
  tabbed: boolean,
  theme: LogInkTheme,
  focused: boolean
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const selected = getSelectedInkCommit(state)

  if (!detail) {
    const fallbackLines = selected
      ? [selected.message, '', loading ? 'Loading commit details...' : 'Commit details unavailable.']
      : ['No commit selected — j/k to browse history.']
    return h(Box, {
      borderColor: focusBorderColor(theme, focused),
      borderStyle: theme.borderStyle,
      flexDirection: 'column',
      width,
      paddingX: 1,
    },
    h(Text, { bold: true }, panelTitle('Inspector', focused)),
    ...fallbackLines.map((line, index) => h(Text, {
      key: `detail-${index}`,
      dimColor: index > 1,
    }, truncateCells(line, width - 4, { ascii: theme.ascii }))),
    ...(focused
      ? renderInspectorActionsSection(h, Text, 'history-commit', width, theme, {
        cursorIndex: state.inspectorActionIndex,
        cursorActive: state.inspectorTab === 'actions',
      })
      : []))
  }

  // Degrade by omission (#1366): at rest (unfocused), the inspector
  // column is only 20-32 cells — too narrow to show refs, the file
  // list, and the actions section without truncating nearly every
  // line into confetti. Show a condensed 4-line summary instead and
  // defer the full detail to when the inspector is focused (36-60
  // cells), where the tabbed/tall logic below already handles it.
  if (!focused) {
    return h(Box, {
      borderColor: focusBorderColor(theme, focused),
      borderStyle: theme.borderStyle,
      flexDirection: 'column',
      width,
      paddingX: 1,
    },
    h(Text, { bold: true }, panelTitle('Inspector', focused)),
    ...renderInspectorAtRest(h, Text, detail, width, theme))
  }

  const statLine = formatCommitStatLine(detail.stats)
  // P5.1 — link the commit hash and each ref out to GitHub when we know
  // the remote. OSC 8 escapes embed inline; supportsHyperlinks() decides
  // whether to wrap or fall through to plain text.
  const repository = context.provider?.repository
  const commitLink = formatHyperlink(
    compactHash(detail.hash),
    buildCommitUrl(repository, detail.hash)
  )
  const refNodes = detail.refs.length
    // 'Refs:   ' prefix = 8 cells; the rest of the interior is the budget.
    ? renderInspectorRefs(h, Text, detail.refs, repository, Math.max(8, width - 4 - 8))
    : null

  // Inspector reorder (PR — drop duplicative Workflows trailer):
  //  1. Commit message (the headline of what you're looking at)
  //  2. Metadata (hash / author / date / refs / stats)
  //  3. Body preview (up to 8 lines now that the trailer is gone)
  //  4. Changed files list (cursored entry highlights)
  //  5. Actions cheat-sheet (per-entity keystrokes; destructive marked)
  // The Workflows: trailer that used to repeat the repo / branch /
  // status from the top header and left sidebar is intentionally gone.
  const headerNodes: ReactTypes.ReactElement[] = [
    h(Text, { key: 'detail-msg' }, truncateCells(detail.message, width - 4, { ascii: theme.ascii })),
    h(Text, { key: 'detail-spacer-1' }, ''),
    h(Text, { key: 'detail-commit', dimColor: true }, 'Commit: ', commitLink),
    h(Text, { key: 'detail-author', dimColor: true }, truncateCells(`Author: ${detail.author}`, width - 4, { ascii: theme.ascii })),
    h(Text, { key: 'detail-date', dimColor: true }, truncateCells(`Date:   ${detail.date}`, width - 4, { ascii: theme.ascii })),
    refNodes
      ? h(Text, { key: 'detail-refs', dimColor: true }, 'Refs:   ', ...refNodes)
      : h(Text, { key: 'detail-refs', dimColor: true }, 'Refs:   none'),
    h(Text, { key: 'detail-stat', dimColor: true }, truncateCells(`Stats:  ${statLine}`, width - 4, { ascii: theme.ascii })),
    h(Text, { key: 'detail-spacer-2' }, ''),
    ...(detail.body ? detail.body.split('\n').slice(0, 8) : ['No commit body.']).map((line, index) =>
      h(Text, {
        key: `detail-body-${index}`,
        dimColor: true,
      }, truncateCells(line, width - 4, { ascii: theme.ascii }))
    ),
    h(Text, { key: 'detail-spacer-3' }, ''),
    h(Text, { key: 'detail-files-title' }, 'Changed files:'),
  ]

  // Single-cursor invariant: the file list owns the cursor when the
  // inspector tab is active; the actions list owns it when the actions
  // tab is active. Pass `focused` only for the matching tab so users
  // never see two simultaneous selection highlights inside the panel.
  const fileListFocused = focused && state.inspectorTab === 'inspector'
  const fileListMaxRows = Math.max(4, Math.min(detail.files.length, 10))
  const fileListNodes = renderCommitFileList(
    h, Text, detail.files, state.selectedFileIndex, fileListFocused, fileListMaxRows, width, theme, context.lfs
  )
  // #884 — submodule info block. Renders when the cursored file is a
  // registered submodule; otherwise empty so the inspector keeps its
  // existing layout.
  const cursoredFilePath = detail.files[
    Math.max(0, Math.min(state.selectedFileIndex, detail.files.length - 1))
  ]?.path
  const submoduleBlockNodes = renderSubmoduleInspectorBlock(
    h, Text, width, cursoredFilePath, context.submodules
  )

  // Tab indicator. Renders in BOTH tabbed (short-terminal) mode and
  // tall-stacked mode so the user can always see which tab the cursor
  // owns and learn the `[/]` toggle. Without this on tall terminals,
  // the actions list looked like a static cheat-sheet — there was no
  // visible signal that the cursor could move into it.
  //
  // Spacing between tab labels comes from the labels' own padding
  // (the active label is bracketed `[Inspector]` while the inactive
  // one is space-padded ` Inspector `, so adjacency reads cleanly).
  // Earlier revisions stuck a raw `' '` between the Text children to
  // pad them visually — that crashes Ink at first paint with
  // "Text string ' ' must be rendered inside <Text> component"
  // because Box only accepts component children, never bare strings.
  const activeTab = state.inspectorTab
  // The two tab labels are fixed-width (bracketed vs space-padded reads
  // the same length either way); the trailing hint is the only part
  // that can be dropped, so only show it when it actually fits — the
  // at-rest inspector column (~20-32 cells) is narrower than
  // labels + hint combined and this row isn't otherwise truncated.
  const tabLabelsWidth = cellWidth('[Inspector]') + cellWidth('[Actions]')
  const tabHint = '  · ←/→ switch'
  const showTabHint = focused && (width - 4 - tabLabelsWidth) >= cellWidth(tabHint)
  const tabHeader = h(Box, { key: 'inspector-tabs', flexDirection: 'row' },
    h(Text, {
      bold: activeTab === 'inspector',
      dimColor: activeTab !== 'inspector',
    }, activeTab === 'inspector' ? '[Inspector]' : ' Inspector '),
    h(Text, {
      bold: activeTab === 'actions',
      dimColor: activeTab !== 'actions',
    }, activeTab === 'actions' ? '[Actions]' : ' Actions '),
    ...(showTabHint
      ? [h(Text, { key: 'inspector-tabs-hint', dimColor: true }, tabHint)]
      : []))

  // Tabbed mode (short terminals): render only the active tab's
  // content under the tab header.
  if (tabbed) {
    return h(Box, {
      borderColor: focusBorderColor(theme, focused),
      borderStyle: theme.borderStyle,
      flexDirection: 'column',
      width,
      paddingX: 1,
    },
    h(Text, { bold: true }, panelTitle('Inspector', focused)),
    tabHeader,
    h(Text, { key: 'inspector-tabs-spacer' }, ''),
    ...(activeTab === 'inspector'
      ? [...headerNodes, ...fileListNodes, ...submoduleBlockNodes]
      : renderInspectorActionsSection(h, Text, 'history-commit', width, theme, {
          cursorIndex: state.inspectorActionIndex,
          cursorActive: focused,
        })))
  }

  // Tall mode: stack both sections so the user can read everything at
  // once, but show the tab header so the active section (and the
  // `[/]` switch affordance) is visible.
  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    width,
    paddingX: 1,
  },
  h(Text, { bold: true }, panelTitle('Inspector', focused)),
  tabHeader,
  h(Text, { key: 'inspector-tabs-spacer' }, ''),
  ...headerNodes,
  ...fileListNodes,
  ...submoduleBlockNodes,
  ...renderInspectorActionsSection(h, Text, 'history-commit', width, theme, {
    cursorIndex: state.inspectorActionIndex,
    cursorActive: focused && state.inspectorTab === 'actions',
  }))
}

export function renderCommitDiffDetail(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  detail: GitCommitDetail | undefined,
  loading: boolean,
  width: number,
  theme: LogInkTheme,
  focused: boolean
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const selected = getSelectedInkCommit(state)

  if (!detail) {
    const fallbackLines = selected
      ? [selected.message, '', loading ? 'Loading commit details...' : 'Commit details unavailable.']
      : ['No commit selected — j/k to browse history.']
    return h(Box, {
      borderColor: focusBorderColor(theme, focused),
      borderStyle: theme.borderStyle,
      flexDirection: 'column',
      width,
      paddingX: 1,
    },
    h(Text, { bold: true }, panelTitle('Commit', focused)),
    ...fallbackLines.map((line, index) => h(Text, {
      key: `commit-diff-${index}`,
      dimColor: index > 1,
    }, truncateCells(line, width - 4, { ascii: theme.ascii }))))
  }

  const statLine = formatCommitStatLine(detail.stats)
  const headerLines = [
    detail.message,
    '',
    `${compactHash(detail.hash)}  ${detail.date}  ${detail.author}`,
    detail.refs.length ? `Refs: ${detail.refs.join(', ')}` : 'Refs: none',
    statLine,
    '',
  ]
  const bodyLines = detail.body ? detail.body.split('\n').slice(0, 5) : []
  const filesHeader = ['Files:']
  const fileListMaxRows = Math.max(4, Math.min(detail.files.length, 12))
  const fileListNodes = renderCommitFileList(
    h, Text, detail.files, state.selectedFileIndex, focused, fileListMaxRows, width, theme
  )
  const hint = focused
    ? 'j/k pick file · enter swaps the center diff'
    : 'tab focuses the file list'

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    width,
    paddingX: 1,
  },
  h(Text, { bold: true }, panelTitle('Commit', focused)),
  ...headerLines.map((line, index) => h(Text, {
    key: `commit-diff-header-${index}`,
    bold: index === 0,
    dimColor: index > 0 && index < headerLines.length - 1,
  }, truncateCells(line, width - 4, { ascii: theme.ascii }))),
  ...bodyLines.map((line, index) => h(Text, {
    key: `commit-diff-body-${index}`,
    dimColor: true,
  }, truncateCells(line, width - 4, { ascii: theme.ascii }))),
  ...(bodyLines.length ? [h(Text, { key: 'commit-diff-body-spacer' }, '')] : []),
  ...filesHeader.map((line, index) => h(Text, {
    key: `commit-diff-files-${index}`,
    bold: true,
  }, truncateCells(line, width - 4, { ascii: theme.ascii }))),
  ...fileListNodes,
  h(Text, undefined, ''),
  h(Text, { dimColor: true }, truncateCells(hint, width - 4, { ascii: theme.ascii })))
}

export function renderComposeContextPanel(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  context: LogInkContext,
  contextStatus: LogInkContextStatus,
  width: number,
  theme: LogInkTheme,
  focused: boolean
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const worktree = context.worktree
  const compose = state.commitCompose
  const loadingWorktree = isLogInkContextKeyLoading(contextStatus, 'worktree')
  const summary = loadingWorktree
    ? 'Worktree status loading'
    : worktree
      ? `${worktree.stagedCount} staged · ${worktree.unstagedCount} unstaged · ${worktree.untrackedCount} untracked`
      : 'No worktree information yet'
  const stagedFiles = (worktree?.files || [])
    .filter((file) => file.indexStatus !== ' ' && file.indexStatus !== '?')
    .slice(0, 12)
  const unstagedFiles = (worktree?.files || [])
    .filter((file) => file.worktreeStatus !== ' ' && file.indexStatus !== '?')
    .slice(0, 6)

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    width,
    paddingX: 1,
  },
  h(Text, { bold: true }, panelTitle('Worktree', focused)),
  h(Text, { dimColor: true }, truncateCells(summary, width - 4, { ascii: theme.ascii })),
  h(Text, undefined, ''),
  ...(compose.loading
    ? [h(Text, {
      key: 'compose-context-loading',
      bold: true,
      color: theme.noColor ? undefined : theme.colors.accent,
    }, truncateCells(theme.ascii ? '[...] AI draft in progress' : '⏳ AI draft in progress', width - 4, { ascii: theme.ascii }))]
    : []),
  ...(stagedFiles.length
    ? [
      // Section header carries the total count to match the status
      // surface's "▾ Staged (n)" treatment (#840). The visible
      // file list is sliced at 12 rows; using `worktree.stagedCount`
      // (the total) avoids a misleading "Staged (12)" label when
      // there are actually more staged files below the slice.
      h(Text, { key: 'compose-context-staged-title', bold: true },
        `Staged (${worktree?.stagedCount ?? stagedFiles.length})`),
      ...stagedFiles.map((file, index) => h(Text, {
        key: `compose-context-staged-${index}`,
        color: theme.noColor ? undefined : theme.colors.gitAdded,
      }, smartPathLabel(`  ${file.indexStatus} `, file.path, '', width - 4))),
      h(Text, { key: 'compose-context-staged-spacer' }, ''),
    ]
    : []),
  ...(unstagedFiles.length
    ? [
      h(Text, { key: 'compose-context-unstaged-title', bold: true },
        `Unstaged (${worktree?.unstagedCount ?? unstagedFiles.length})`),
      ...unstagedFiles.map((file, index) => h(Text, {
        key: `compose-context-unstaged-${index}`,
        color: theme.noColor ? undefined : theme.colors.gitModified,
      }, smartPathLabel(`  ${file.worktreeStatus} `, file.path, '', width - 4))),
    ]
    : !stagedFiles.length && !loadingWorktree
      ? [h(Text, { dimColor: true }, 'No worktree changes detected.')]
      : []))
}

export function renderBranchPreviewPanel(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  context: LogInkContext,
  contextStatus: LogInkContextStatus,
  width: number,
  theme: LogInkTheme,
  focused: boolean
): ReactTypes.ReactElement {
  const { Box, Text } = components
  if (isLogInkContextKeyLoading(contextStatus, 'branches')) {
    return renderPreviewPanel(h, { Box, Text }, 'Branch preview',
      [{ text: formatLogInkLoading({ resource: 'branches' }), emphasis: 'dim' }],
      width, theme, focused)
  }
  // Sort-then-filter, matching the branches surface and the workflow
  // runner — the shared cursor indexes the SORTED list, so filtering the
  // raw ref order here made the preview describe a different branch than
  // the highlighted row.
  const all = sortBranches(context.branches?.localBranches || [], state.branchSort)
  const visible = state.filter
    ? all.filter((branch) =>
      matchesPromotedFilter([branch.shortName, branch.upstream || ''], state.filter))
    : all
  const index = Math.max(0, Math.min(state.selectedBranchIndex, Math.max(0, visible.length - 1)))
  const branch = visible[index]
  return renderPreviewPanel(h, { Box, Text }, 'Branch preview',
    formatBranchPreview(branch), width, theme, focused)
}

export function renderTagPreviewPanel(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  context: LogInkContext,
  contextStatus: LogInkContextStatus,
  width: number,
  theme: LogInkTheme,
  focused: boolean
): ReactTypes.ReactElement {
  const { Box, Text } = components
  if (isLogInkContextKeyLoading(contextStatus, 'tags')) {
    return renderPreviewPanel(h, { Box, Text }, 'Tag preview',
      [{ text: formatLogInkLoading({ resource: 'tags' }), emphasis: 'dim' }],
      width, theme, focused)
  }
  // Sort-then-filter — same contract as the branch preview above.
  const all = sortTags(context.tags?.tags || [], state.tagSort)
  const visible = state.filter
    ? all.filter((tag) => matchesPromotedFilter([tag.name, tag.subject], state.filter))
    : all
  const index = Math.max(0, Math.min(state.selectedTagIndex, Math.max(0, visible.length - 1)))
  const tag = visible[index]
  return renderPreviewPanel(h, { Box, Text }, 'Tag preview',
    formatTagPreview(tag), width, theme, focused)
}

export function renderStashPreviewPanel(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  context: LogInkContext,
  contextStatus: LogInkContextStatus,
  width: number,
  theme: LogInkTheme,
  focused: boolean
): ReactTypes.ReactElement {
  const { Box, Text } = components
  if (isLogInkContextKeyLoading(contextStatus, 'stashes')) {
    return renderPreviewPanel(h, { Box, Text }, 'Stash preview',
      [{ text: formatLogInkLoading({ resource: 'stashes' }), emphasis: 'dim' }],
      width, theme, focused)
  }
  const all = context.stashes?.stashes || []
  const visible = state.filter
    ? all.filter((stash) => matchesPromotedFilter([stash.ref, stash.message], state.filter))
    : all
  const index = Math.max(0, Math.min(state.selectedStashIndex, Math.max(0, visible.length - 1)))
  const stash = visible[index]
  return renderPreviewPanel(h, { Box, Text }, 'Stash preview',
    formatStashPreview(stash), width, theme, focused)
}

export function renderSubmodulePreviewPanel(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  context: LogInkContext,
  contextStatus: LogInkContextStatus,
  width: number,
  theme: LogInkTheme,
  focused: boolean,
): ReactTypes.ReactElement {
  const { Box, Text } = components
  if (isLogInkContextKeyLoading(contextStatus, 'submodules')) {
    return renderPreviewPanel(h, { Box, Text }, 'Submodule preview',
      [{ text: formatLogInkLoading({ resource: 'submodules' }), emphasis: 'dim' }],
      width, theme, focused)
  }
  const all = context.submodules?.entries || []
  const visible = state.filter
    ? all.filter((entry) => matchesPromotedFilter(
      [entry.name, entry.path, entry.trackingBranch || '', entry.url || ''],
      state.filter,
    ))
    : all
  const index = Math.max(0, Math.min(state.selectedSubmoduleIndex, Math.max(0, visible.length - 1)))
  const entry = visible[index]
  if (!entry) {
    return renderPreviewPanel(h, { Box, Text }, 'Submodule preview',
      [{ text: 'No submodule under cursor.', emphasis: 'dim' }],
      width, theme, focused)
  }
  const flagLabel = entry.flag === 'clean' ? 'clean'
    : entry.flag === 'modified' ? 'modified'
      : entry.flag === 'uninitialized' ? 'uninitialized'
        : 'conflicted'
  const sha = entry.pinnedSha ? entry.pinnedSha.slice(0, 8) : '<unknown>'
  const lines: PreviewLine[] = [
    { text: entry.name, emphasis: 'heading' },
    { text: `path:      ${entry.path}` },
    { text: `pinned:    ${sha}` },
    { text: `status:    ${flagLabel}` },
    ...(entry.trackingBranch
      ? [{ text: `tracking:  ${entry.trackingBranch}` }]
      : []),
    ...(entry.url
      ? [{ text: `remote:    ${entry.url}`, emphasis: 'dim' as const }]
      : []),
  ]
  return renderPreviewPanel(h, { Box, Text }, 'Submodule preview',
    lines, width, theme, focused)
}

export function renderCommitPanel(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  context: LogInkContext,
  contextStatus: LogInkContextStatus,
  width: number,
  theme: LogInkTheme,
  focused: boolean
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const compose = state.commitCompose
  const loading = compose.loading
  const stagedCount = context.worktree?.stagedCount || 0
  const unstagedCount = context.worktree?.unstagedCount || 0
  const statusLine = isLogInkContextKeyLoading(contextStatus, 'worktree')
    ? 'Status loading'
    : `${stagedCount} staged | ${unstagedCount} unstaged`
  const summaryCursor = compose.editing && compose.field === 'summary' ? '_' : ''
  const bodyCursor = compose.editing && compose.field === 'body' ? '_' : ''
  const bodyTextWidth = Math.max(8, width - 6) // 4 for chrome + 2 for indent
  // Wrap each source line of the body so long messages don't get cut off
  // by the previous truncate(line, width - 4). The 12-line cap is generous
  // — most commit bodies fit, and the panel's column layout absorbs the
  // height naturally.
  const bodyHasContent = Boolean(compose.body)
  const bodyVisualLines: string[] = bodyHasContent
    ? compose.body.split('\n').flatMap((line) => wrapCells(line, bodyTextWidth)).slice(0, 12)
    : ['<empty>']
  const hasSummary = Boolean(compose.summary)
  const summaryMarker = compose.field === 'summary' && compose.editing ? '>' : ' '
  const bodyMarker = compose.field === 'body' && compose.editing ? '>' : ' '
  // The generated subject is the thing the user is looking for — render
  // it bold + accent so it pops out of the inspector instead of blending
  // into the dim label/body text. The `Summary:` label stays dim.
  const summaryLabel = `${summaryMarker} Summary: `
  const summaryColor = hasSummary && !theme.noColor ? theme.colors.accent : undefined
  const summaryValueWidth = Math.max(4, width - 4 - cellWidth(summaryLabel))
  const summaryWrapped = wrapCells(`${compose.summary || '<empty>'}${summaryCursor}`, summaryValueWidth)
  const trailerLines = [
    ...(compose.message ? ['', compose.message] : []),
    ...(compose.details || []).map((line) => `  ${line}`),
  ]
  const stateLine = compose.editing
    ? 'Enter/tab edits fields, Esc exits edit mode.'
    : 'e edit | c commit | I AI draft'

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    width,
    paddingX: 1,
  },
  h(Text, { bold: true }, panelTitle('Commit', focused)),
  h(Text, { key: 'commit-status', dimColor: true }, truncateCells(statusLine, width - 4, { ascii: theme.ascii })),
  h(Text, { key: 'commit-spacer-1' }, ''),
  // Summary: dim label + the subject value emphasized so it's easy to spot.
  h(Text, { key: 'commit-summary' },
    h(Text, { dimColor: true }, summaryLabel),
    h(Text, {
      bold: hasSummary,
      color: summaryColor,
      dimColor: !hasSummary,
    }, summaryWrapped[0] || '<empty>')
  ),
  ...summaryWrapped.slice(1).map((line, index) => h(Text, {
    key: `commit-summary-rest-${index}`,
    bold: true,
    color: summaryColor,
  }, truncateCells(`${' '.repeat(cellWidth(summaryLabel))}${line}`, width - 4, { ascii: theme.ascii }))),
  h(Text, {
    key: 'commit-body-label',
    dimColor: !(compose.field === 'body' && compose.editing),
  }, truncateCells(`${bodyMarker} Body:`, width - 4, { ascii: theme.ascii })),
  ...bodyVisualLines.map((line, index) => {
    const isLast = index === bodyVisualLines.length - 1
    return h(Text, {
      key: `commit-body-${index}`,
      dimColor: true,
    }, truncateCells(`  ${line}${bodyCursor && isLast ? bodyCursor : ''}`, width - 4, { ascii: theme.ascii }))
  }),
  h(Text, { key: 'commit-spacer-2' }, ''),
  // Loading indicator + commit result/details stay inline with the body
  // (they describe what just happened to the fields above). The action
  // hint ("e edit | c commit | I AI draft") moves to the bottom of the
  // pane to read as footer guidance, matching the compose surface.
  ...(loading
    ? [h(Text, {
      key: 'commit-loading',
      bold: true,
      color: theme.noColor ? undefined : theme.colors.accent,
    }, truncateCells(theme.ascii ? '[...] Generating AI draft' : '⏳ Generating AI draft…', width - 4, { ascii: theme.ascii }))]
    : []),
  ...trailerLines.map((line, index) => h(Text, {
    key: `commit-trailer-${index}`,
    dimColor: line.startsWith('  '),
  }, truncateCells(line, width - 4, { ascii: theme.ascii }))),
  h(Box, { flexGrow: 1 }),
  loading
    ? null
    : h(Text, { key: 'commit-state', dimColor: true }, truncateCells(stateLine, width - 4, { ascii: theme.ascii })))
}

/**
 * Issue triage preview pane (#882 phase 3). Mirrors the branch / tag /
 * stash preview pattern — `renderPreviewPanel` chrome, formatter pulls
 * the cursored item via `state.selectedIssueIndex`. Shown when
 * `state.activeView === 'issues'`.
 */
export function renderIssueTriagePreviewPanel(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  context: LogInkContext,
  contextStatus: LogInkContextStatus,
  width: number,
  theme: LogInkTheme,
  focused: boolean
): ReactTypes.ReactElement {
  const { Box, Text } = components
  if (isLogInkContextKeyLoading(contextStatus, 'issueList')) {
    return renderPreviewPanel(h, { Box, Text }, 'Issue preview',
      [{ text: formatLogInkLoading({ resource: 'issues' }), emphasis: 'dim' }],
      width, theme, focused)
  }
  const all = context.issueList?.issues || []
  const visible = state.filter
    ? all.filter((issue) => matchesPromotedFilter(
      [
        `#${issue.number}`,
        issue.title,
        issue.author || '',
        ...(issue.labels || []),
        ...(issue.assignees || []),
      ],
      state.filter,
    ))
    : all
  const index = Math.max(0, Math.min(state.selectedIssueIndex, Math.max(0, visible.length - 1)))
  const issue = visible[index]
  const detail = issue
    ? context.issueDetailByNumber?.get(issue.number)
    : undefined
  return renderPreviewPanel(h, { Box, Text }, 'Issue preview',
    formatIssueTriagePreview(issue, detail), width, theme, focused)
}

/**
 * Pull-request triage preview pane (#882 phase 3). Shown when
 * `state.activeView === 'pull-request-triage'`. Distinct from the
 * single-PR action panel's right pane (which renders the full
 * inspector with status checks, reviews, and action keys).
 */
export function renderPullRequestTriagePreviewPanel(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  context: LogInkContext,
  contextStatus: LogInkContextStatus,
  width: number,
  theme: LogInkTheme,
  focused: boolean
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const nouns = forgeNouns(context.provider?.repository.provider)
  if (isLogInkContextKeyLoading(contextStatus, 'pullRequestList')) {
    return renderPreviewPanel(h, { Box, Text }, `${nouns.singular} preview`,
      [{ text: formatLogInkLoading({ resource: nouns.pluralLower }), emphasis: 'dim' }],
      width, theme, focused)
  }
  const all = context.pullRequestList?.pullRequests || []
  const visible = state.filter
    ? all.filter((pr) => matchesPromotedFilter(
      [
        `#${pr.number}`,
        pr.title,
        pr.author || '',
        pr.headRefName,
        pr.baseRefName,
        ...(pr.labels || []),
        ...(pr.assignees || []),
      ],
      state.filter,
    ))
    : all
  const index = Math.max(0, Math.min(state.selectedPullRequestTriageIndex, Math.max(0, visible.length - 1)))
  const pr = visible[index]
  const detail = pr
    ? context.pullRequestDetailByNumber?.get(pr.number)
    : undefined
  return renderPreviewPanel(h, { Box, Text }, `${nouns.singular} preview`,
    formatPullRequestTriagePreview(pr, detail, nouns.singularLower), width, theme, focused)
}
