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
 * Extracted from `src/commands/log/inkRuntime.ts` as part of phase 5a.6
 * of #890. No behavior change.
 */

import type * as ReactTypes from 'react'
import type { LogInkContextStatus } from '../../chrome/context'
import { isLogInkContextKeyLoading } from '../../chrome/context'
import { formatHyperlink } from '../../chrome/hyperlinks'
import type {
  InspectorAction,
  InspectorActionContext,
} from '../../chrome/inspectorActions'
import { getInspectorActions } from '../../chrome/inspectorActions'
import type { PreviewLine } from '../../chrome/previewPane'
import {
  formatBranchPreview,
  formatStashPreview,
  formatTagPreview,
} from '../../chrome/previewPane'
import { formatLogInkLoading } from '../../chrome/surfaceStates'
import type { LfsAttributeStatus } from '../../../git/lfsAttributes'
import { isPathLfsTracked } from '../../../git/lfsAttributes'
import { truncateCells, wrapCells } from '../../chrome/text'
import type { LogInkTheme } from '../../chrome/theme'
import type {
  GitCommitDetail,
  GitCommitFilePreview,
} from '../../../commands/log/data'
import type { LogInkState } from '../../../commands/log/inkViewModel'
import { getSelectedInkCommit } from '../../../commands/log/inkViewModel'
import type { ProviderRepository } from '../../../git/providerData'
import { matchesPromotedFilter } from '../../runtime/promotedFilter'
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
      const keyCell = action.key.padEnd(KEY_COLUMN)
      const label = truncateCells(action.label, labelBudget)
      const children: Array<string | ReactTypes.ReactElement> = [
        h(Text, {
          key: `actions-${index}-key`,
          color: action.destructive ? theme.colors.danger : theme.colors.accent,
        }, keyCell),
        GAP,
        label,
      ]
      if (action.destructive) {
        children.push(h(Text, {
          key: `actions-${index}-mark`,
          color: theme.colors.danger,
          dimColor: false,
        }, DESTRUCTIVE_SUFFIX))
      }
      return h(Text, {
        key: `actions-${index}`,
        backgroundColor: isSelected && !theme.noColor ? theme.colors.selection : undefined,
        inverse: isSelected,
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
  repository: ProviderRepository | undefined
): ReactTypes.ReactElement[] {
  const out: ReactTypes.ReactElement[] = []
  refs.forEach((ref, index) => {
    if (index > 0) {
      out.push(h(Text, { key: `ref-sep-${index}` }, ', '))
    }
    out.push(h(Text, { key: `ref-${index}` }, formatHyperlink(ref, buildRefUrl(repository, ref))))
  })
  return out
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
  const startIndex = Math.max(0, clamped - Math.floor(maxRows / 2))
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
    const label = `${cursor} ${statusCode} ${file.path}${renamed}${lfsBadge}${stats ? `  ${stats}` : ''}`

    return h(Text, {
      key: `commit-file-${index}`,
      color: statusCodeColor(file.status, theme),
      inverse: isSelected && focused && !theme.noColor,
      bold: isSelected,
    }, truncateCells(label, width - 4))
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
    }, truncateCells(line.text, width - 4))
  }))
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
    const fallbackLines = [
      selected?.message || 'No commit selected.',
      '',
      loading ? 'Loading commit details...' : 'Commit details unavailable.',
    ]
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
    }, truncateCells(line, width - 4))),
    ...renderInspectorActionsSection(h, Text, 'history-commit', width, theme, {
      cursorIndex: state.inspectorActionIndex,
      cursorActive: focused && state.inspectorTab === 'actions',
    }))
  }

  const statLine = `${detail.stats.filesChanged} files  +${detail.stats.insertions}/-${detail.stats.deletions}`
  // P5.1 — link the commit hash and each ref out to GitHub when we know
  // the remote. OSC 8 escapes embed inline; supportsHyperlinks() decides
  // whether to wrap or fall through to plain text.
  const repository = context.provider?.repository
  const commitLink = formatHyperlink(
    compactHash(detail.hash),
    buildCommitUrl(repository, detail.hash)
  )
  const refNodes = detail.refs.length
    ? renderInspectorRefs(h, Text, detail.refs, repository)
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
    h(Text, { key: 'detail-msg' }, truncateCells(detail.message, width - 4)),
    h(Text, { key: 'detail-spacer-1' }, ''),
    h(Text, { key: 'detail-commit', dimColor: true }, 'Commit: ', commitLink),
    h(Text, { key: 'detail-author', dimColor: true }, truncateCells(`Author: ${detail.author}`, width - 4)),
    h(Text, { key: 'detail-date', dimColor: true }, truncateCells(`Date:   ${detail.date}`, width - 4)),
    refNodes
      ? h(Text, { key: 'detail-refs', dimColor: true }, 'Refs:   ', ...refNodes)
      : h(Text, { key: 'detail-refs', dimColor: true }, 'Refs:   none'),
    h(Text, { key: 'detail-stat', dimColor: true }, truncateCells(`Stats:  ${statLine}`, width - 4)),
    h(Text, { key: 'detail-spacer-2' }, ''),
    ...(detail.body ? detail.body.split('\n').slice(0, 8) : ['No commit body.']).map((line, index) =>
      h(Text, {
        key: `detail-body-${index}`,
        dimColor: true,
      }, truncateCells(line, width - 4))
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
  const tabHeader = h(Box, { key: 'inspector-tabs', flexDirection: 'row' },
    h(Text, {
      bold: activeTab === 'inspector',
      dimColor: activeTab !== 'inspector',
    }, activeTab === 'inspector' ? '[Inspector]' : ' Inspector '),
    h(Text, {
      bold: activeTab === 'actions',
      dimColor: activeTab !== 'actions',
    }, activeTab === 'actions' ? '[Actions]' : ' Actions '),
    ...(focused
      ? [h(Text, { key: 'inspector-tabs-hint', dimColor: true }, '  · ←/→ switch')]
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
      ? [...headerNodes, ...fileListNodes]
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
    const fallbackLines = [
      selected?.message || 'No commit selected.',
      '',
      loading ? 'Loading commit details...' : 'Commit details unavailable.',
    ]
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
    }, truncateCells(line, width - 4))))
  }

  const statLine = `${detail.stats.filesChanged} files  +${detail.stats.insertions}/-${detail.stats.deletions}`
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
  }, truncateCells(line, width - 4))),
  ...bodyLines.map((line, index) => h(Text, {
    key: `commit-diff-body-${index}`,
    dimColor: true,
  }, truncateCells(line, width - 4))),
  ...(bodyLines.length ? [h(Text, { key: 'commit-diff-body-spacer' }, '')] : []),
  ...filesHeader.map((line, index) => h(Text, {
    key: `commit-diff-files-${index}`,
    bold: true,
  }, truncateCells(line, width - 4))),
  ...fileListNodes,
  h(Text, undefined, ''),
  h(Text, { dimColor: true }, truncateCells(hint, width - 4)))
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
  h(Text, { dimColor: true }, truncateCells(summary, width - 4)),
  h(Text, undefined, ''),
  ...(compose.loading
    ? [h(Text, {
      key: 'compose-context-loading',
      bold: true,
      color: theme.noColor ? undefined : theme.colors.accent,
    }, truncateCells(theme.ascii ? '[...] AI draft in progress' : '⏳ AI draft in progress', width - 4))]
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
      }, truncateCells(`  ${file.indexStatus} ${file.path}`, width - 4))),
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
      }, truncateCells(`  ${file.worktreeStatus} ${file.path}`, width - 4))),
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
  const all = context.branches?.localBranches || []
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
  const all = context.tags?.tags || []
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
  const summaryWrapped = wrapCells(`${compose.summary || '<empty>'}${summaryCursor}`, bodyTextWidth)
  const summaryFirst = `${compose.field === 'summary' && compose.editing ? '>' : ' '} Summary: ${summaryWrapped[0] || ''}`
  const summaryRest = summaryWrapped.slice(1).map((line) => `           ${line}`)
  const headerLines = [
    statusLine,
    '',
    summaryFirst,
    ...summaryRest,
    `${compose.field === 'body' && compose.editing ? '>' : ' '} Body:`,
    ...bodyVisualLines.map((line, index) => {
      const isLast = index === bodyVisualLines.length - 1
      return `  ${line}${bodyCursor && isLast ? bodyCursor : ''}`
    }),
    '',
  ]
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
  ...headerLines.map((line, index) => h(Text, {
    key: `commit-header-${index}`,
    dimColor: index < 2 || line.startsWith('  ') || line === '<empty>',
  }, truncateCells(line, width - 4))),
  // Loading indicator + commit result/details stay inline with the body
  // (they describe what just happened to the fields above). The action
  // hint ("e edit | c commit | I AI draft") moves to the bottom of the
  // pane to read as footer guidance, matching the compose surface.
  ...(loading
    ? [h(Text, {
      key: 'commit-loading',
      bold: true,
      color: theme.noColor ? undefined : theme.colors.accent,
    }, truncateCells(theme.ascii ? '[...] Generating AI draft' : '⏳ Generating AI draft…', width - 4))]
    : []),
  ...trailerLines.map((line, index) => h(Text, {
    key: `commit-trailer-${index}`,
    dimColor: line.startsWith('  '),
  }, truncateCells(line, width - 4))),
  h(Box, { flexGrow: 1 }),
  loading
    ? null
    : h(Text, { key: 'commit-state', dimColor: true }, truncateCells(stateLine, width - 4)))
}
