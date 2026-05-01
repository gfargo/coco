/**
 * Ink runtime for `coco log -i` and `coco ui`.
 *
 * # Accessibility & terminal compatibility
 *
 * The TUI is keyboard-only by design — every action is reachable from the
 * keymap (see inkKeymap.ts) and the command palette (`:`). No mouse input
 * is consumed.
 *
 * Color and decorations:
 *   - `NO_COLOR` is honored end-to-end via `LogInkTheme.noColor` (see
 *     inkTheme.ts). When set, `focusBorderColor` returns undefined so
 *     borders fall back to the terminal default and color emphasis is
 *     dropped without changing layout.
 *   - The chrome and surfaces use a small set of unicode glyphs (›, ↑/↓,
 *     ·) that render in any modern UTF-8 terminal. Layout is ASCII-only,
 *     so a missing glyph never affects column widths.
 *
 * Empty / loading / error states:
 *   - Empty-state copy lives in inkSurfaceStates.ts so every surface
 *     speaks with the same voice and points users at the next sensible
 *     action.
 *   - Loading state uses `formatLogInkLoading` for a uniform leading
 *     glyph + text.
 *   - Error state for git command failures is surfaced through the
 *     existing `compose.message` / `compose.details` pipeline (commit /
 *     revert hooks) and the footer status message (transient
 *     operations). Context-load failures fall through to empty-state
 *     copy via `safe()` — surfacing them as a richer "this view failed
 *     to load" panel is a future polish.
 *
 * Themes:
 *   - Four presets (`default`, `monochrome`, `catppuccin`, `gruvbox`).
 *   - `monochrome` is the canary: the layout must read correctly when
 *     every text decoration is dropped.
 */

import type * as ReactTypes from 'react'
import { SimpleGit } from 'simple-git'
import { BranchOverview, getBranchOverview } from './branchData'
import { createManualCommit } from './commitCompose'
import { runCommitDraftWorkflow } from './commitWorkflowActions'
import {
  GitCommitDetail,
  GitCommitFilePreview,
  GitLogRow,
  LOG_INTERACTIVE_DEFAULT_LIMIT,
  getCommitDetail,
  getCommitFilePreview,
  getCommitRows,
  getLogRows,
} from './data'
import {
  LogInkContextKey,
  LogInkContextStatus,
  createLogInkContextStatus,
  isLogInkContextKeyLoading,
  isLogInkContextLoading,
  updateLogInkContextStatus,
} from './inkContext'
import {
  formatInkRefLabels,
  getVisibleLogInkHistory,
} from './inkHistoryRows'
import {
  formatBindingKeys,
  formatLogInkBreadcrumb,
  filterLogInkPaletteCommands,
  getLogInkPaletteCommands,
  getLogInkFooterHints,
  getLogInkHelpSections,
} from './inkKeymap'
import { LogInkInputKey, getLogInkInputEvents } from './inkInput'
import {
  LOG_INK_DEFAULT_COLUMNS,
  LOG_INK_DEFAULT_ROWS,
  LOG_INK_MIN_COLUMNS,
  LOG_INK_MIN_ROWS,
  getLogInkLayout,
} from './inkLayout'
import { createLogInkTheme, LogInkTheme, LogInkThemeConfig } from './inkTheme'
import {
  formatLogInkBranchesEmpty,
  formatLogInkComposeEmpty,
  formatLogInkHistoryEmpty,
  formatLogInkLoading,
  formatLogInkStashEmpty,
  formatLogInkStatusEmpty,
  formatLogInkTagsEmpty,
} from './inkSurfaceStates'
import { truncateCells } from './inkText'
import {
  LogInkSidebarTab,
  LogInkState,
  LogInkView,
  applyLogInkAction,
  createLogInkState,
  getLogInkSidebarTabs,
  getSelectedInkCommit,
} from './inkViewModel'
import { startInteractiveLog } from './interactive'
import { GitOperationOverview, getGitOperationOverview } from './operationData'
import { ProviderOverview, getProviderOverview } from './providerData'
import { PullRequestOverview, getPullRequestOverview } from './pullRequestData'
import { StashOverview, getStashOverview } from './stashData'
import { revertFile, stageFile, unstageFile } from './statusActions'
import { WorktreeOverview, getWorktreeOverview } from './statusData'
import {
  WorktreeHunkOverview,
  getWorktreeHunks,
  revertHunk,
  stageHunk,
  unstageHunk,
} from './statusHunks'
import { TagOverview, getTagOverview } from './tagData'
import {
  getLogInkWorkflowActionById,
  getLogInkWorkflowSections,
} from './inkWorkflows'
import { WorktreeOverview as WorktreeListOverview, getWorktreeListOverview } from './worktreeData'
import { WorktreeFileDiff, getWorktreeFileDiff } from './worktreeDiffData'
import { canStartLogInkTui, getLogInkRenderOptions } from './inkTerminal'
import { LogArgv } from './config'

type DynamicImport = <T>(specifier: string) => Promise<T>
const dynamicImport = new Function('specifier', 'return import(specifier)') as DynamicImport

type LogInkStreams = {
  input?: NodeJS.ReadStream
  output?: NodeJS.WriteStream
  error?: NodeJS.WriteStream
}

type LogInkOptions = {
  appLabel?: string
  initialView?: LogInkView
  logArgv?: LogArgv
  theme?: LogInkThemeConfig
}

type LogInkContext = {
  branches?: BranchOverview
  operation?: GitOperationOverview
  provider?: ProviderOverview
  pullRequest?: PullRequestOverview
  stashes?: StashOverview
  tags?: TagOverview
  worktree?: WorktreeOverview
  worktreeList?: WorktreeListOverview
}

type LogInkRuntime = {
  ink: {
    Box: ReactTypes.ComponentType<Record<string, unknown>>
    Text: ReactTypes.ComponentType<Record<string, unknown>>
    render: (
      app: ReactTypes.ReactElement,
      options: {
        alternateScreen?: boolean
        exitOnCtrlC?: boolean
        patchConsole?: boolean
        stderr?: NodeJS.WriteStream
        stdin?: NodeJS.ReadStream
        stdout?: NodeJS.WriteStream
      }
    ) => {
      waitUntilExit: () => Promise<void>
    }
    useApp: () => {
      exit: () => void
    }
    useInput: (handler: (input: string, key: LogInkInputKey) => void) => void
    useWindowSize: () => {
      columns: number
      rows: number
    }
  }
  React: typeof ReactTypes
}

type LogInkComponents = Pick<LogInkRuntime['ink'], 'Box' | 'Text'>

type LogInkComponentDeps = LogInkRuntime & {
  appLabel: string
  git: SimpleGit
  initialView: LogInkView
  logArgv?: LogArgv
  rows: GitLogRow[]
  theme: LogInkTheme
}

const truncate = truncateCells

function compactHash(hash: string | undefined): string {
  return hash ? hash.slice(0, 7) : '<none>'
}

async function safe<T>(promise: Promise<T>): Promise<T | undefined> {
  try {
    return await promise
  } catch {
    return undefined
  }
}

async function loadLogInkContext(git: SimpleGit): Promise<LogInkContext> {
  const [branches, pullRequest, tags, worktree, stashes, worktreeList, operation, provider] =
    await Promise.all([
      safe(getBranchOverview(git)),
      safe(getPullRequestOverview(git)),
      safe(getTagOverview(git)),
      safe(getWorktreeOverview(git)),
      safe(getStashOverview(git)),
      safe(getWorktreeListOverview(git)),
      safe(getGitOperationOverview(git)),
      safe(getProviderOverview(git)),
    ])

  return {
    branches,
    operation,
    provider,
    pullRequest,
    stashes,
    tags,
    worktree,
    worktreeList,
  }
}

function loadLogInkContextEntries(git: SimpleGit): Array<{
  key: LogInkContextKey
  load: () => Promise<LogInkContext[LogInkContextKey] | undefined>
}> {
  return [
    {
      key: 'branches',
      load: () => safe(getBranchOverview(git)),
    },
    {
      key: 'pullRequest',
      load: () => safe(getPullRequestOverview(git)),
    },
    {
      key: 'tags',
      load: () => safe(getTagOverview(git)),
    },
    {
      key: 'worktree',
      load: () => safe(getWorktreeOverview(git)),
    },
    {
      key: 'stashes',
      load: () => safe(getStashOverview(git)),
    },
    {
      key: 'worktreeList',
      load: () => safe(getWorktreeListOverview(git)),
    },
    {
      key: 'operation',
      load: () => safe(getGitOperationOverview(git)),
    },
    {
      key: 'provider',
      load: () => safe(getProviderOverview(git)),
    },
  ]
}

async function loadInkRuntime(): Promise<LogInkRuntime> {
  const [ink, React] = await Promise.all([
    dynamicImport<LogInkRuntime['ink']>('ink'),
    dynamicImport<typeof ReactTypes>('react'),
  ])

  return {
    ink,
    React,
  }
}

function focusBorderColor(
  theme: LogInkTheme,
  focused: boolean
): string | undefined {
  if (theme.noColor) {
    return undefined
  }

  return focused ? theme.colors.focusBorder : theme.colors.border
}

function panelTitle(title: string, focused: boolean): string {
  return focused ? `${title} *` : title
}

/**
 * Map a unified-diff line to the props passed to an Ink `<Text>` so the
 * standard +/-/@@ prefixes render in their conventional colors. File
 * headers (`+++`, `---`, `diff --git`, `index`) get a softer treatment so
 * they don't compete with the actual hunk content.
 *
 * `theme.noColor` collapses everything to dim/normal so we stay readable
 * under `NO_COLOR` and the `monochrome` preset.
 */
function diffLineProps(
  line: string,
  theme: LogInkTheme
): { color?: string; dimColor?: boolean } {
  if (theme.noColor) {
    return { dimColor: line.startsWith(' ') || line.startsWith('diff ') || line.startsWith('index ') }
  }

  if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('+++') || line.startsWith('---')) {
    return { dimColor: true }
  }
  if (line.startsWith('@@')) {
    return { color: theme.colors.accent }
  }
  if (line.startsWith('+')) {
    return { color: theme.colors.gitAdded }
  }
  if (line.startsWith('-')) {
    return { color: theme.colors.gitDeleted }
  }

  return {}
}

/**
 * Pick a theme color for a single name-status code (`A`, `M`, `D`,
 * `R100`, etc.) so the inspector and commit-diff file list render with
 * familiar git colors at a glance. Letters stay in the line so the
 * meaning survives `NO_COLOR`.
 */
function statusCodeColor(status: string, theme: LogInkTheme): string | undefined {
  if (theme.noColor) {
    return undefined
  }

  const head = status.charAt(0)
  switch (head) {
    case 'A':
      return theme.colors.gitAdded
    case 'D':
      return theme.colors.gitDeleted
    case 'U':
      return theme.colors.danger
    case 'M':
    case 'T':
      return theme.colors.gitModified
    case 'R':
    case 'C':
      return theme.colors.accent
    default:
      return undefined
  }
}

function formatChangedFileStats(file: GitCommitDetail['files'][number]): string {
  if (file.binary) {
    return 'bin'
  }
  if (file.additions === undefined && file.deletions === undefined) {
    return ''
  }
  return `+${file.additions || 0}/-${file.deletions || 0}`
}

function sidebarTabLabel(tab: LogInkSidebarTab): string {
  switch (tab) {
    case 'status':
      return 'Status'
    case 'branches':
      return 'Branches'
    case 'tags':
      return 'Tags'
    case 'stashes':
      return 'Stashes'
    case 'worktrees':
      return 'Worktrees'
    default:
      return tab
  }
}

function formatDivergence(branch: BranchOverview['localBranches'][number]): string {
  if (!branch.upstream) {
    return 'no upstream'
  }

  if (branch.ahead === 0 && branch.behind === 0) {
    return `even with ${branch.upstream}`
  }

  return `+${branch.ahead}/-${branch.behind} ${branch.upstream}`
}

function sidebarLines(
  context: LogInkContext,
  contextStatus: LogInkContextStatus,
  tab: LogInkSidebarTab,
  width: number
): string[] {
  if (tab === 'status') {
    const worktree = context.worktree

    if (isLogInkContextKeyLoading(contextStatus, 'worktree')) {
      return ['Loading status...']
    }

    if (!worktree) {
      return ['Status unavailable']
    }

    return [
      `${worktree.stagedCount} staged`,
      `${worktree.unstagedCount} unstaged`,
      `${worktree.untrackedCount} untracked`,
      '',
      ...worktree.files.slice(0, 12).map((file) =>
        `${file.indexStatus}${file.worktreeStatus} ${truncate(file.path, width - 3)}`
      ),
    ]
  }

  if (tab === 'branches') {
    const branches = context.branches

    if (isLogInkContextKeyLoading(contextStatus, 'branches')) {
      return ['Loading branches...']
    }

    if (!branches) {
      return ['Branches unavailable']
    }

    return [
      `Current: ${branches.currentBranch || '<detached>'}`,
      branches.dirty ? 'Worktree: dirty' : 'Worktree: clean',
      '',
      ...branches.localBranches.slice(0, 8).map((branch) =>
        `${branch.current ? '*' : ' '} ${truncate(branch.shortName, width - 4)}`
      ),
      ...branches.localBranches.slice(0, 4).map((branch) =>
        `  ${truncate(formatDivergence(branch), width - 2)}`
      ),
    ]
  }

  if (tab === 'tags') {
    if (isLogInkContextKeyLoading(contextStatus, 'tags')) {
      return ['Loading tags...']
    }

    return context.tags?.tags.length
      ? context.tags.tags.slice(0, 12).map((tag) =>
        `${truncate(tag.name, 16)} ${truncate(tag.subject, Math.max(8, width - 18))}`
      )
      : ['No tags found']
  }

  if (tab === 'stashes') {
    if (isLogInkContextKeyLoading(contextStatus, 'stashes')) {
      return ['Loading stashes...']
    }

    return context.stashes?.stashes.length
      ? context.stashes.stashes.slice(0, 12).map((stash) =>
        `${stash.ref} ${truncate(stash.message, Math.max(8, width - stash.ref.length - 1))}`
      )
      : ['No stashes found']
  }

  if (isLogInkContextKeyLoading(contextStatus, 'worktreeList')) {
    return ['Loading worktrees...']
  }

  return context.worktreeList?.worktrees.length
    ? context.worktreeList.worktrees.slice(0, 12).map((worktree) => {
      const marker = worktree.current ? '*' : ' '
      const state = worktree.dirty ? 'dirty' : 'clean'

      return `${marker} ${truncate(worktree.branch || worktree.path, Math.max(8, width - 8))} ${state}`
    })
    : ['No linked worktrees']
}

export async function startInkInteractiveLog(
  git: SimpleGit,
  rows: GitLogRow[],
  streams: LogInkStreams = {},
  options: LogInkOptions = {}
): Promise<void> {
  const input = streams.input || process.stdin
  const output = streams.output || process.stdout
  const error = streams.error || process.stderr

  if (!canStartLogInkTui(input, output)) {
    await startInteractiveLog(git, rows, {
      appLabel: options.appLabel,
      input,
      output,
    })
    return
  }

  const runtime = await loadInkRuntime()
  const { ink, React } = runtime
  const app = React.createElement(LogInkApp, {
    appLabel: options.appLabel || 'coco log',
    git,
    ink,
    initialView: options.initialView || 'history',
    logArgv: options.logArgv,
    React,
    rows,
    theme: createLogInkTheme(options.theme),
  })
  const instance = ink.render(app, getLogInkRenderOptions({ input, output, error }))

  await instance.waitUntilExit()
}

function LogInkApp(deps: LogInkComponentDeps): ReactTypes.ReactElement {
  const { appLabel, git, ink, initialView, logArgv, React, rows, theme } = deps
  const { Box, Text, useApp, useInput, useWindowSize } = ink
  const h = React.createElement
  const { exit } = useApp()
  const windowSize = useWindowSize()
  const layout = getLogInkLayout({
    columns: windowSize.columns || process.stdout.columns || LOG_INK_DEFAULT_COLUMNS,
    rows: windowSize.rows || process.stdout.rows || LOG_INK_DEFAULT_ROWS,
  })
  const [state, setState] = React.useState<LogInkState>(() =>
    createLogInkState(rows, { activeView: initialView })
  )
  const [context, setContext] = React.useState<LogInkContext>({})
  const [contextStatus, setContextStatus] = React.useState<LogInkContextStatus>(() =>
    createLogInkContextStatus('loading')
  )
  const [detail, setDetail] = React.useState<GitCommitDetail | undefined>(undefined)
  const [detailLoading, setDetailLoading] = React.useState(false)
  const [filePreview, setFilePreview] = React.useState<GitCommitFilePreview | undefined>(undefined)
  const [filePreviewLoading, setFilePreviewLoading] = React.useState(false)
  const [worktreeDiff, setWorktreeDiff] = React.useState<WorktreeFileDiff | undefined>(undefined)
  const [worktreeDiffLoading, setWorktreeDiffLoading] = React.useState(false)
  const [worktreeHunks, setWorktreeHunks] = React.useState<WorktreeHunkOverview | undefined>(
    undefined
  )
  const [worktreeHunksLoading, setWorktreeHunksLoading] = React.useState(false)
  const [hasMoreCommits, setHasMoreCommits] = React.useState(() => (
    Boolean(logArgv?.interactive && !logArgv.limit) &&
    getCommitRows(rows).length >= LOG_INTERACTIVE_DEFAULT_LIMIT
  ))
  const [loadingMoreCommits, setLoadingMoreCommits] = React.useState(false)
  const loadingMoreCommitsRef = React.useRef(false)
  const loadMoreRequestRef = React.useRef(0)
  const mountedRef = React.useRef(true)
  const selected = getSelectedInkCommit(state)
  const selectedDetailFile = detail?.files[state.selectedFileIndex]
  const selectedWorktreeFile = context.worktree?.files[state.selectedWorktreeFileIndex]

  const dispatch = React.useCallback((action: Parameters<typeof applyLogInkAction>[1]) => {
    setState((current) => applyLogInkAction(current, action))
  }, [])

  const refreshContext = React.useCallback(async () => {
    dispatch({ type: 'setStatus', value: 'refreshing repository context' })
    setContextStatus(createLogInkContextStatus('loading'))
    setContext(await loadLogInkContext(git))
    setContextStatus(createLogInkContextStatus('ready'))
    dispatch({ type: 'setStatus', value: 'repository context refreshed' })
  }, [dispatch, git])

  const refreshWorktreeContext = React.useCallback(async () => {
    setContextStatus((current) => updateLogInkContextStatus(current, 'worktree', 'loading'))
    const worktree = await safe(getWorktreeOverview(git))

    setContext((current) => ({
      ...current,
      worktree,
    }))
    setContextStatus((current) => updateLogInkContextStatus(current, 'worktree', 'ready'))
  }, [git])

  React.useEffect(() => {
    let active = true

    async function loadWorktreeHunks(): Promise<void> {
      if (state.activeView !== 'diff' || !selectedWorktreeFile) {
        setWorktreeHunks(undefined)
        setWorktreeHunksLoading(false)
        return
      }

      setWorktreeHunksLoading(true)
      const nextHunks = await safe(getWorktreeHunks(git, selectedWorktreeFile))

      if (active) {
        setWorktreeHunks(nextHunks)
        setWorktreeHunksLoading(false)
      }
    }

    void loadWorktreeHunks()

    return () => {
      active = false
    }
  }, [
    git,
    selectedWorktreeFile?.indexStatus,
    selectedWorktreeFile?.path,
    selectedWorktreeFile?.worktreeStatus,
    state.activeView,
  ])

  React.useEffect(() => {
    let active = true

    loadLogInkContextEntries(git).forEach(({ key, load }) => {
      void load().then((value) => {
        if (!active) {
          return
        }

        setContext((current) => ({
          ...current,
          [key]: value,
        }))
        setContextStatus((current) => updateLogInkContextStatus(current, key, 'ready'))
      })
    })

    return () => {
      active = false
    }
  }, [git])

  React.useEffect(() => {
    let active = true

    async function loadDetail(): Promise<void> {
      if (!selected) {
        setDetail(undefined)
        return
      }

      setDetailLoading(true)
      const nextDetail = await safe(getCommitDetail(git, selected.hash))

      if (active) {
        setDetail(nextDetail)
        setDetailLoading(false)
      }
    }

    void loadDetail()

    return () => {
      active = false
    }
  }, [git, selected?.hash])

  React.useEffect(() => {
    let active = true

    async function loadWorktreeDiff(): Promise<void> {
      if (state.activeView !== 'diff' || !selectedWorktreeFile) {
        setWorktreeDiff(undefined)
        setWorktreeDiffLoading(false)
        return
      }

      setWorktreeDiffLoading(true)
      const nextDiff = await safe(getWorktreeFileDiff(git, selectedWorktreeFile))

      if (active) {
        setWorktreeDiff(nextDiff)
        setWorktreeDiffLoading(false)
      }
    }

    void loadWorktreeDiff()

    return () => {
      active = false
    }
  }, [
    git,
    selectedWorktreeFile?.indexStatus,
    selectedWorktreeFile?.path,
    selectedWorktreeFile?.worktreeStatus,
    state.activeView,
  ])

  const toggleSelectedFileStage = React.useCallback(async () => {
    if (!selectedWorktreeFile) {
      dispatch({ type: 'setStatus', value: 'no worktree file selected' })
      return
    }

    dispatch({ type: 'setStatus', value: 'updating file stage state' })
    const result = selectedWorktreeFile.state === 'staged'
      ? await unstageFile(git, selectedWorktreeFile)
      : await stageFile(git, selectedWorktreeFile)

    dispatch({ type: 'setStatus', value: result.message })
    await refreshWorktreeContext()
    setWorktreeDiff(undefined)
    setWorktreeHunks(undefined)
  }, [dispatch, git, refreshWorktreeContext, selectedWorktreeFile])

  const toggleSelectedHunkStage = React.useCallback(async () => {
    const selectedHunk = worktreeHunks?.hunks[state.selectedWorktreeHunkIndex]

    if (!selectedHunk) {
      dispatch({ type: 'setStatus', value: 'no hunk selected' })
      return
    }

    dispatch({ type: 'setStatus', value: 'updating hunk stage state' })
    try {
      if (selectedHunk.state === 'staged') {
        await unstageHunk(git, selectedHunk)
      } else {
        await stageHunk(git, selectedHunk)
      }

      dispatch({
        type: 'setStatus',
        value: `${selectedHunk.state === 'staged' ? 'Unstaged' : 'Staged'} hunk`,
      })
      await refreshWorktreeContext()
      setWorktreeDiff(undefined)
      setWorktreeHunks(undefined)
    } catch (error) {
      dispatch({
        type: 'setStatus',
        value: (error as Error).message || 'failed to update hunk stage state',
      })
    }
  }, [dispatch, git, refreshWorktreeContext, state.selectedWorktreeHunkIndex, worktreeHunks])

  const revertSelectedFile = React.useCallback(async () => {
    if (!selectedWorktreeFile) {
      dispatch({ type: 'setStatus', value: 'no worktree file selected' })
      return
    }

    dispatch({ type: 'setStatus', value: 'reverting selected file' })
    const result = await revertFile(git, selectedWorktreeFile)

    dispatch({ type: 'setStatus', value: result.message })
    await refreshWorktreeContext()
    setWorktreeDiff(undefined)
    setWorktreeHunks(undefined)
  }, [dispatch, git, refreshWorktreeContext, selectedWorktreeFile])

  const revertSelectedHunk = React.useCallback(async () => {
    const selectedHunk = worktreeHunks?.hunks[state.selectedWorktreeHunkIndex]

    if (!selectedHunk) {
      dispatch({ type: 'setStatus', value: 'no hunk selected' })
      return
    }

    dispatch({ type: 'setStatus', value: 'reverting selected hunk' })
    try {
      await revertHunk(git, selectedHunk)
      dispatch({ type: 'setStatus', value: `Reverted hunk in ${selectedHunk.filePath}` })
      await refreshWorktreeContext()
      setWorktreeDiff(undefined)
      setWorktreeHunks(undefined)
    } catch (error) {
      dispatch({
        type: 'setStatus',
        value: (error as Error).message || 'failed to revert hunk',
      })
    }
  }, [dispatch, git, refreshWorktreeContext, state.selectedWorktreeHunkIndex, worktreeHunks])

  const createCommitFromCompose = React.useCallback(async () => {
    const stagedCount = context.worktree?.stagedCount || 0

    if (!stagedCount) {
      dispatch({ type: 'setStatus', value: 'stage changes before committing' })
      return
    }

    dispatch({ type: 'commitCompose', action: { type: 'setLoading', value: true } })
    dispatch({ type: 'setStatus', value: 'creating commit' })
    const result = await createManualCommit({
      git,
      summary: state.commitCompose.summary,
      body: state.commitCompose.body,
    })

    dispatch({
      type: 'commitCompose',
      action: { type: 'setResult', message: result.message, details: result.details },
    })
    dispatch({ type: 'setStatus', value: result.message })

    if (result.ok) {
      dispatch({ type: 'commitCompose', action: { type: 'reset' } })
      await refreshWorktreeContext()
    }
  }, [
    context.worktree?.stagedCount,
    dispatch,
    git,
    refreshWorktreeContext,
    state.commitCompose.body,
    state.commitCompose.summary,
  ])

  const runAiCommitDraft = React.useCallback(async () => {
    dispatch({ type: 'commitCompose', action: { type: 'setLoading', value: true } })
    dispatch({ type: 'setStatus', value: 'generating AI commit draft' })
    const result = await runCommitDraftWorkflow()

    if (result.ok && result.draft) {
      dispatch({ type: 'commitCompose', action: { type: 'setDraft', value: result.draft } })
      dispatch({ type: 'setStatus', value: 'AI draft ready for editing' })
      return
    }

    dispatch({
      type: 'commitCompose',
      action: { type: 'setResult', message: result.message, details: result.details },
    })
    dispatch({ type: 'setStatus', value: result.message })
  }, [dispatch])

  React.useEffect(() => {
    let active = true

    async function loadPreview(): Promise<void> {
      if (!selected || !selectedDetailFile) {
        setFilePreview(undefined)
        return
      }

      setFilePreviewLoading(true)
      const nextPreview = await safe(getCommitFilePreview(git, selected.hash, selectedDetailFile))

      if (active) {
        setFilePreview(nextPreview)
        setFilePreviewLoading(false)
      }
    }

    void loadPreview()

    return () => {
      active = false
    }
  }, [git, selected?.hash, selectedDetailFile?.path, selectedDetailFile?.oldPath])

  React.useEffect(() => {
    return () => {
      mountedRef.current = false
    }
  }, [])

  React.useEffect(() => {
    loadingMoreCommitsRef.current = loadingMoreCommits
  }, [loadingMoreCommits])

  React.useEffect(() => {
    const remaining = state.filteredCommits.length - state.selectedIndex - 1

    async function loadMoreCommits(): Promise<void> {
      if (!logArgv || logArgv.limit || loadingMoreCommitsRef.current || !hasMoreCommits) {
        return
      }

      if (state.filteredCommits.length === 0 || remaining > 20) {
        return
      }

      loadingMoreCommitsRef.current = true
      const requestId = loadMoreRequestRef.current + 1
      loadMoreRequestRef.current = requestId
      setLoadingMoreCommits(true)
      dispatch({ type: 'setStatus', value: 'loading older commits' })
      const nextRows = await safe(
        getLogRows(git, logArgv, {
          limit: LOG_INTERACTIVE_DEFAULT_LIMIT,
          skip: state.commits.length,
        })
      )

      if (!mountedRef.current || loadMoreRequestRef.current !== requestId) {
        return
      }

      loadingMoreCommitsRef.current = false
      setLoadingMoreCommits(false)

      const nextCommitCount = nextRows ? getCommitRows(nextRows).length : 0

      if (!nextRows) {
        dispatch({ type: 'setStatus', value: 'failed to load older commits' })
        return
      }

      if (nextRows?.length) {
        dispatch({ type: 'appendRows', rows: nextRows })
      }

      setHasMoreCommits(nextCommitCount >= LOG_INTERACTIVE_DEFAULT_LIMIT)
      dispatch({
        type: 'setStatus',
        value: nextCommitCount
          ? `loaded ${nextCommitCount} older commits`
          : 'end of history',
      })
    }

    void loadMoreCommits()
  }, [
    dispatch,
    git,
    hasMoreCommits,
    loadingMoreCommits,
    logArgv,
    state.commits.length,
    state.filteredCommits.length,
    state.selectedIndex,
  ])

  const commitDiffHunkOffsets = React.useMemo(() => (
    filePreview?.hunks
      .map((line, index) => (line.startsWith('@@') ? index : -1))
      .filter((index) => index >= 0)
  ), [filePreview])

  useInput((inputValue: string, key: LogInkInputKey) => {
    getLogInkInputEvents(state, inputValue, key, {
      detailFileCount: detail?.files.length,
      previewLineCount: filePreview?.hunks.length,
      worktreeDiffLineCount: worktreeDiff?.lines.length,
      worktreeFileCount: context.worktree?.files.length,
      worktreeHunkOffsets: worktreeDiff?.hunkOffsets,
      commitDiffHunkOffsets,
      branchCount: context.branches?.localBranches.length,
      tagCount: context.tags?.tags.length,
      stashCount: context.stashes?.stashes.length,
    }).forEach((event) => {
      if (event.type === 'exit') {
        exit()
      } else if (event.type === 'refreshContext') {
        void refreshContext()
      } else if (event.type === 'toggleSelectedFileStage') {
        void toggleSelectedFileStage()
      } else if (event.type === 'toggleSelectedHunkStage') {
        void toggleSelectedHunkStage()
      } else if (event.type === 'revertSelectedFile') {
        void revertSelectedFile()
      } else if (event.type === 'revertSelectedHunk') {
        void revertSelectedHunk()
      } else if (event.type === 'createManualCommit') {
        void createCommitFromCompose()
      } else if (event.type === 'runAiCommitDraft') {
        void runAiCommitDraft()
      } else {
        dispatch(event.action)
      }
    })
  })

  if (layout.tooSmall) {
    return h(Box, {
      flexDirection: 'column',
      height: layout.rows,
      paddingX: 1,
      paddingY: 1,
    },
    h(Text, { bold: true }, appLabel),
    h(Text, undefined, `Terminal too small: ${layout.columns}x${layout.rows}`),
    h(Text, { dimColor: true }, `Minimum size is ${LOG_INK_MIN_COLUMNS}x${LOG_INK_MIN_ROWS}.`),
    h(Text, { dimColor: true }, 'Resize the terminal or run plain coco log.'))
  }

  return h(Box, { flexDirection: 'column', height: layout.rows },
    renderHeader(h, { Box, Text }, state, context, contextStatus, layout.columns, theme, appLabel),
    h(Box, { flexDirection: 'row', height: layout.bodyRows },
      renderSidebar(h, { Box, Text }, state, context, contextStatus, layout.sidebarWidth, theme),
      renderMainPanel(
        h,
        { Box, Text },
        state,
        context,
        contextStatus,
        worktreeDiff,
        worktreeDiffLoading,
        worktreeHunks,
        worktreeHunksLoading,
        filePreview,
        filePreviewLoading,
        commitDiffHunkOffsets,
        selectedDetailFile,
        layout.bodyRows,
        theme,
        hasMoreCommits,
        loadingMoreCommits
      ),
      renderDetailPanel(
        h,
        { Box, Text },
        state,
        context,
        contextStatus,
        detail,
        detailLoading,
        filePreview,
        filePreviewLoading,
        layout.detailWidth,
        theme
      )
    ),
    renderFooter(h, { Box, Text }, state, theme)
  )
}

function renderHeader(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  context: LogInkContext,
  contextStatus: LogInkContextStatus,
  columns: number,
  theme: LogInkTheme,
  appLabel: string
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const branch = context.branches?.currentBranch || context.provider?.currentBranch || '<detached>'
  const dirty = context.branches?.dirty ? 'dirty' : 'clean'
  const repo = context.provider?.repository.owner && context.provider.repository.name
    ? `${context.provider.repository.owner}/${context.provider.repository.name}`
    : 'local repository'
  const pr = context.provider?.currentPullRequest
    ? `PR #${context.provider.currentPullRequest.number} ${context.provider.currentPullRequest.state}`
    : context.pullRequest?.currentPullRequest
      ? `PR #${context.pullRequest.currentPullRequest.number} ${context.pullRequest.currentPullRequest.state}`
      : 'no PR'
  const search = state.filterMode ? `search: ${state.filter}_` : state.filter ? `filter: ${state.filter}` : ''
  const loading = isLogInkContextLoading(contextStatus) ? '  loading context' : ''
  const breadcrumb = formatLogInkBreadcrumb(state.viewStack)
  const view = breadcrumb ? `  ${breadcrumb}` : ''
  const title = truncate(`${appLabel}  ${repo}  ${branch}  ${dirty}  ${pr}${view}${loading}`, columns - 2)

  return h(Box, {
    borderColor: theme.colors.border,
    borderStyle: theme.borderStyle,
    height: 3,
    paddingX: 1,
  },
  h(Text, { bold: true, color: theme.colors.accent }, title),
  search ? h(Text, { dimColor: true }, `  ${truncate(search, 36)}`) : undefined)
}

function renderSidebar(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  context: LogInkContext,
  contextStatus: LogInkContextStatus,
  width: number,
  theme: LogInkTheme
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const focused = state.focus === 'sidebar'
  const lines = sidebarLines(context, contextStatus, state.sidebarTab, width - 4)
  const tabs = getLogInkSidebarTabs()

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    width,
    paddingX: 1,
  },
  h(Text, { bold: true }, panelTitle('Repository', focused)),
  h(Text, { dimColor: true }, tabs.map((tab) => tab === state.sidebarTab ? `[${sidebarTabLabel(tab)}]` : sidebarTabLabel(tab)).join(' ')),
  h(Text, undefined, ''),
  ...lines.map((line, index) => h(Text, { key: `sidebar-${index}` }, truncate(line, width - 4))))
}

function renderMainPanel(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  context: LogInkContext,
  contextStatus: LogInkContextStatus,
  worktreeDiff: WorktreeFileDiff | undefined,
  worktreeDiffLoading: boolean,
  worktreeHunks: WorktreeHunkOverview | undefined,
  worktreeHunksLoading: boolean,
  filePreview: GitCommitFilePreview | undefined,
  filePreviewLoading: boolean,
  commitDiffHunkOffsets: number[] | undefined,
  selectedDetailFile: GitCommitDetail['files'][number] | undefined,
  bodyRows: number,
  theme: LogInkTheme,
  hasMoreCommits: boolean,
  loadingMoreCommits: boolean
): ReactTypes.ReactElement {
  if (state.activeView === 'status') {
    return renderStatusSurface(h, components, state, context, contextStatus, bodyRows, theme)
  }

  if (state.activeView === 'diff') {
    return renderDiffSurface(
      h,
      components,
      state,
      context,
      contextStatus,
      worktreeDiff,
      worktreeDiffLoading,
      worktreeHunks,
      worktreeHunksLoading,
      filePreview,
      filePreviewLoading,
      commitDiffHunkOffsets,
      selectedDetailFile,
      bodyRows,
      theme
    )
  }

  if (state.activeView === 'compose') {
    return renderComposeSurface(h, components, state, context, contextStatus, bodyRows, theme)
  }

  if (state.activeView === 'branches') {
    return renderBranchesSurface(h, components, state, context, contextStatus, bodyRows, theme)
  }

  if (state.activeView === 'tags') {
    return renderTagsSurface(h, components, state, context, contextStatus, bodyRows, theme)
  }

  if (state.activeView === 'stash') {
    return renderStashSurface(h, components, state, context, contextStatus, bodyRows, theme)
  }

  return renderHistoryPanel(
    h,
    components,
    state,
    bodyRows,
    theme,
    hasMoreCommits,
    loadingMoreCommits
  )
}

function renderHistoryPanel(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  bodyRows: number,
  theme: LogInkTheme,
  hasMoreCommits: boolean,
  loadingMoreCommits: boolean
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const focused = state.focus === 'commits'
  const listRows = Math.max(3, bodyRows - 4)
  const visible = getVisibleLogInkHistory(state, listRows)
  const loadState = loadingMoreCommits
    ? 'loading older commits'
    : hasMoreCommits
      ? 'more below'
      : 'loaded'
  const title = `${state.filteredCommits.length}/${state.commits.length} commits`
  const graphMode = state.fullGraph ? 'full graph' : 'compact graph'

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    flexGrow: 1,
    paddingX: 1,
  },
  h(Box, { justifyContent: 'space-between' },
    h(Text, { bold: true }, panelTitle('Commits', focused)),
    h(Text, { dimColor: true }, `${title} | ${graphMode} | ${loadState}`)
  ),
  visible.items.length === 0
    ? h(Text, { dimColor: true }, formatLogInkHistoryEmpty({
      filter: state.filter,
      totalCommits: state.commits.length,
    }))
    : visible.items.map((item, index) => {
      if (item.type === 'graph') {
        return h(Text, {
          key: `graph-${index}-${item.graph}`,
          dimColor: true,
        }, truncate(item.graph.padEnd(visible.graphWidth), 140))
      }

      const { commit, selected } = item
      const graph = item.graph.padEnd(visible.graphWidth)
      const row = `${graph} ${commit.shortHash} ${commit.date} ${commit.message}${formatInkRefLabels(commit.refs)}`

      return h(Text, {
        key: `${commit.hash}-${index}`,
        backgroundColor: selected && !theme.noColor ? theme.colors.selection : undefined,
        inverse: selected,
      }, truncate(row, 140))
    }))
}

function renderStatusSurface(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  context: LogInkContext,
  contextStatus: LogInkContextStatus,
  bodyRows: number,
  theme: LogInkTheme
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const focused = state.focus === 'commits'
  const worktree = context.worktree
  const listRows = Math.max(4, bodyRows - 5)
  const selectedIndex = state.selectedWorktreeFileIndex
  const cleanHint = formatLogInkStatusEmpty({ hasChanges: Boolean(worktree?.files.length) })
  const lines = isLogInkContextKeyLoading(contextStatus, 'worktree')
    ? [formatLogInkLoading({ resource: 'worktree status' })]
    : worktree?.files.length
      ? worktree.files
        .slice(Math.max(0, selectedIndex - Math.floor(listRows / 2)))
        .slice(0, listRows)
        .map((file, offset) => {
          const index = Math.max(0, selectedIndex - Math.floor(listRows / 2)) + offset

          return `${index === selectedIndex ? '>' : ' '} ${file.indexStatus}${file.worktreeStatus} ${file.state.padEnd(9)} ${file.path}`
        })
      : cleanHint
        ? [cleanHint]
        : ['Worktree clean']

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    flexGrow: 1,
    paddingX: 1,
  },
  h(Box, { justifyContent: 'space-between' },
    h(Text, { bold: true }, panelTitle('Worktree', focused)),
    h(Text, { dimColor: true }, worktree
      ? `${worktree.stagedCount} staged | ${worktree.unstagedCount} unstaged | ${worktree.untrackedCount} untracked`
      : 'status loading')
  ),
  ...lines.map((line, index) => h(Text, {
    key: `status-surface-${index}`,
    dimColor: index > 0,
  }, truncate(line, 140))))
}

function renderComposeSurface(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  context: LogInkContext,
  contextStatus: LogInkContextStatus,
  bodyRows: number,
  theme: LogInkTheme
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const compose = state.commitCompose
  const focused = state.focus === 'commits'
  const worktree = context.worktree
  const statusLine = isLogInkContextKeyLoading(contextStatus, 'worktree')
    ? 'Status loading'
    : worktree
      ? `${worktree.stagedCount} staged | ${worktree.unstagedCount} unstaged | ${worktree.untrackedCount} untracked`
      : 'No worktree info yet'
  const summaryCursor = compose.editing && compose.field === 'summary' ? '_' : ''
  const bodyCursor = compose.editing && compose.field === 'body' ? '_' : ''
  const bodyRowsAvailable = Math.max(4, bodyRows - 10)
  const bodyLines = compose.body
    ? compose.body.split('\n').slice(0, bodyRowsAvailable)
    : ['<empty>']
  const stateLine = compose.editing
    ? 'Editing — Enter switches summary↔body, Esc exits edit mode.'
    : 'Press e to edit, c to commit, I for AI draft, esc to leave.'
  const stagedFileLines = (worktree?.files || [])
    .filter((file) => file.indexStatus !== ' ' && file.indexStatus !== '?')
    .slice(0, 5)
    .map((file) => `  ${file.indexStatus} ${file.path}`)
  const noStagedHint = !isLogInkContextKeyLoading(contextStatus, 'worktree')
    ? formatLogInkComposeEmpty({ hasStaged: stagedFileLines.length > 0 })
    : undefined

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    flexGrow: 1,
    paddingX: 1,
  },
  h(Box, { justifyContent: 'space-between' },
    h(Text, { bold: true }, panelTitle('Compose commit', focused)),
    h(Text, { dimColor: true }, statusLine)
  ),
  h(Text, undefined, ''),
  h(Text, {
    bold: compose.field === 'summary' && compose.editing,
  }, truncate(`Summary  ${compose.summary || '<empty>'}${summaryCursor}`, 140)),
  h(Text, undefined, ''),
  h(Text, {
    bold: compose.field === 'body' && compose.editing,
  }, 'Body'),
  ...bodyLines.map((line, index) => h(Text, {
    key: `compose-body-${index}`,
    dimColor: line === '<empty>',
  }, truncate(`  ${line}${bodyCursor && index === bodyLines.length - 1 ? bodyCursor : ''}`, 140))),
  h(Text, undefined, ''),
  ...(compose.loading
    ? [h(Text, {
      key: 'compose-loading',
      bold: true,
      color: theme.noColor ? undefined : theme.colors.accent,
    }, theme.ascii
      ? '[...] Generating AI commit draft (this can take a moment)'
      : '⏳ Generating AI commit draft… (this can take a moment)')]
    : [h(Text, { dimColor: true }, stateLine)]),
  ...(compose.message ? [h(Text, { key: 'compose-msg' }, truncate(compose.message, 140))] : []),
  ...(compose.details || []).map((line, index) => h(Text, {
    key: `compose-detail-${index}`,
    dimColor: true,
  }, truncate(`  ${line}`, 140))),
  ...(stagedFileLines.length > 0
    ? [
      h(Text, { key: 'compose-staged-spacer' }, ''),
      h(Text, { key: 'compose-staged-title', bold: true }, 'Staged'),
      ...stagedFileLines.map((line, index) => h(Text, {
        key: `compose-staged-${index}`,
        dimColor: true,
      }, truncate(line, 140))),
    ]
    : noStagedHint
      ? [
        h(Text, { key: 'compose-no-staged-spacer' }, ''),
        h(Text, { key: 'compose-no-staged', dimColor: true }, truncate(noStagedHint, 140)),
      ]
      : []))
}

function matchesPromotedFilter(haystacks: string[], filter: string): boolean {
  if (!filter.trim()) {
    return true
  }
  const needle = filter.toLowerCase()
  return haystacks.some((value) => value.toLowerCase().includes(needle))
}

function renderBranchesSurface(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  context: LogInkContext,
  contextStatus: LogInkContextStatus,
  bodyRows: number,
  theme: LogInkTheme
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const focused = state.focus === 'commits'
  const branches = context.branches
  const loading = isLogInkContextKeyLoading(contextStatus, 'branches')
  const allLocalBranches = branches?.localBranches || []
  const localBranches = state.filter
    ? allLocalBranches.filter((branch) =>
      matchesPromotedFilter([branch.shortName, branch.upstream || ''], state.filter)
    )
    : allLocalBranches
  const selected = Math.max(0, Math.min(state.selectedBranchIndex, Math.max(0, localBranches.length - 1)))
  const listRows = Math.max(4, bodyRows - 4)
  const startIndex = Math.max(0, selected - Math.floor(listRows / 2))
  const visible = localBranches.slice(startIndex, startIndex + listRows)
  const filterLabel = state.filter ? ` | filter: ${state.filter}` : ''
  const headerRight = loading
    ? 'loading branches'
    : `${localBranches.length}/${allLocalBranches.length} local | current: ${branches?.currentBranch || '<detached>'}${filterLabel}`
  const emptyLabel = formatLogInkBranchesEmpty({ filter: state.filter })
  const loadingLabel = formatLogInkLoading({ resource: 'branches' })
  const lines: ReactTypes.ReactNode[] = loading
    ? [h(Text, { key: 'branches-loading', dimColor: true }, loadingLabel)]
    : localBranches.length === 0
      ? [h(Text, { key: 'branches-empty', dimColor: true }, emptyLabel)]
      : visible.map((branch, offset) => {
        const index = startIndex + offset
        const isSelected = index === selected
        const cursor = isSelected ? '>' : ' '
        const marker = branch.current ? '*' : ' '
        const divergence = formatDivergence(branch)
        return h(Text, {
          key: `branch-${index}`,
          bold: isSelected,
          dimColor: !isSelected && !branch.current,
        }, truncate(`${cursor} ${marker} ${branch.shortName.padEnd(28)} ${divergence}`, 140))
      })

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    flexGrow: 1,
    paddingX: 1,
  },
  h(Box, { justifyContent: 'space-between' },
    h(Text, { bold: true }, panelTitle('Branches', focused)),
    h(Text, { dimColor: true }, headerRight)
  ),
  ...lines)
}

function renderTagsSurface(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  context: LogInkContext,
  contextStatus: LogInkContextStatus,
  bodyRows: number,
  theme: LogInkTheme
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const focused = state.focus === 'commits'
  const loading = isLogInkContextKeyLoading(contextStatus, 'tags')
  const allTags = context.tags?.tags || []
  const tags = state.filter
    ? allTags.filter((tag) => matchesPromotedFilter([tag.name, tag.subject], state.filter))
    : allTags
  const selected = Math.max(0, Math.min(state.selectedTagIndex, Math.max(0, tags.length - 1)))
  const listRows = Math.max(4, bodyRows - 4)
  const startIndex = Math.max(0, selected - Math.floor(listRows / 2))
  const visible = tags.slice(startIndex, startIndex + listRows)
  const filterLabel = state.filter ? ` | filter: ${state.filter}` : ''
  const headerRight = loading
    ? 'loading tags'
    : `${tags.length}/${allTags.length} tags${filterLabel}`
  const emptyLabel = formatLogInkTagsEmpty({ filter: state.filter })
  const loadingLabel = formatLogInkLoading({ resource: 'tags' })
  const lines: ReactTypes.ReactNode[] = loading
    ? [h(Text, { key: 'tags-loading', dimColor: true }, loadingLabel)]
    : tags.length === 0
      ? [h(Text, { key: 'tags-empty', dimColor: true }, emptyLabel)]
      : visible.map((tag, offset) => {
        const index = startIndex + offset
        const isSelected = index === selected
        const cursor = isSelected ? '>' : ' '
        return h(Text, {
          key: `tag-${index}`,
          bold: isSelected,
          dimColor: !isSelected,
        }, truncate(`${cursor} ${tag.name.padEnd(20)} ${tag.subject}`, 140))
      })

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    flexGrow: 1,
    paddingX: 1,
  },
  h(Box, { justifyContent: 'space-between' },
    h(Text, { bold: true }, panelTitle('Tags', focused)),
    h(Text, { dimColor: true }, headerRight)
  ),
  ...lines)
}

function renderStashSurface(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  context: LogInkContext,
  contextStatus: LogInkContextStatus,
  bodyRows: number,
  theme: LogInkTheme
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const focused = state.focus === 'commits'
  const loading = isLogInkContextKeyLoading(contextStatus, 'stashes')
  const allStashes = context.stashes?.stashes || []
  const stashes = state.filter
    ? allStashes.filter((stash) =>
      matchesPromotedFilter([stash.ref, stash.message], state.filter)
    )
    : allStashes
  const selected = Math.max(0, Math.min(state.selectedStashIndex, Math.max(0, stashes.length - 1)))
  const listRows = Math.max(4, bodyRows - 4)
  const startIndex = Math.max(0, selected - Math.floor(listRows / 2))
  const visible = stashes.slice(startIndex, startIndex + listRows)
  const filterLabel = state.filter ? ` | filter: ${state.filter}` : ''
  const headerRight = loading
    ? 'loading stashes'
    : `${stashes.length}/${allStashes.length} stashes${filterLabel}`
  const emptyLabel = formatLogInkStashEmpty({ filter: state.filter })
  const loadingLabel = formatLogInkLoading({ resource: 'stashes' })
  const lines: ReactTypes.ReactNode[] = loading
    ? [h(Text, { key: 'stash-loading', dimColor: true }, loadingLabel)]
    : stashes.length === 0
      ? [h(Text, { key: 'stash-empty', dimColor: true }, emptyLabel)]
      : visible.map((stash, offset) => {
        const index = startIndex + offset
        const isSelected = index === selected
        const cursor = isSelected ? '>' : ' '
        return h(Text, {
          key: `stash-${index}`,
          bold: isSelected,
          dimColor: !isSelected,
        }, truncate(`${cursor} ${stash.ref.padEnd(12)} ${stash.message}`, 140))
      })

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    flexGrow: 1,
    paddingX: 1,
  },
  h(Box, { justifyContent: 'space-between' },
    h(Text, { bold: true }, panelTitle('Stash', focused)),
    h(Text, { dimColor: true }, headerRight)
  ),
  ...lines)
}

function renderDiffSurface(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  context: LogInkContext,
  contextStatus: LogInkContextStatus,
  worktreeDiff: WorktreeFileDiff | undefined,
  worktreeDiffLoading: boolean,
  worktreeHunks: WorktreeHunkOverview | undefined,
  worktreeHunksLoading: boolean,
  filePreview: GitCommitFilePreview | undefined,
  filePreviewLoading: boolean,
  commitDiffHunkOffsets: number[] | undefined,
  selectedDetailFile: GitCommitDetail['files'][number] | undefined,
  bodyRows: number,
  theme: LogInkTheme
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const focused = state.focus === 'commits'
  const worktree = context.worktree
  const worktreeFile = worktree?.files[state.selectedWorktreeFileIndex]
  const visibleRows = Math.max(4, bodyRows - 4)

  // diffSource disambiguates: 'commit' was set when the user opened the
  // diff via history → Enter (read-only commit-diff explore), 'worktree'
  // was set when they came from status → Enter (stage / hunk / revert).
  // Falls back to the previous heuristic when no source is recorded so
  // older entry paths still render something sensible.
  const useCommitDiff = state.diffSource === 'commit' ||
    (state.diffSource === undefined && !worktreeFile && Boolean(selectedDetailFile))

  if (useCommitDiff) {
    const previewHunks = filePreview?.hunks || []
    const visiblePreviewHunks = previewHunks.slice(
      state.diffPreviewOffset,
      state.diffPreviewOffset + visibleRows
    )
    const hunkCount = commitDiffHunkOffsets?.length || 0
    const currentHunkIndex = hunkCount > 0
      ? Math.max(0, [...(commitDiffHunkOffsets || [])]
          .reverse()
          .findIndex((offset) => offset <= state.diffPreviewOffset))
      : 0
    const currentHunkLabel = hunkCount > 0
      ? `Hunk ${Math.min(hunkCount - currentHunkIndex, hunkCount)}/${hunkCount}`
      : 'No hunks for this file.'

    const headerLines: string[] = filePreviewLoading
      ? [`Loading diff for ${selectedDetailFile?.path || 'selected file'}...`]
      : previewHunks.length
        ? [
          `Selected file: ${selectedDetailFile?.path || ''}`,
          currentHunkLabel,
          `Lines ${Math.min(state.diffPreviewOffset + 1, previewHunks.length || 1)}-${Math.min(state.diffPreviewOffset + visiblePreviewHunks.length, previewHunks.length)}/${previewHunks.length}`,
          '',
        ]
        : ['No diff preview available for this file.']

    return h(Box, {
      borderColor: focusBorderColor(theme, focused),
      borderStyle: theme.borderStyle,
      flexDirection: 'column',
      flexGrow: 1,
      paddingX: 1,
    },
    h(Box, { justifyContent: 'space-between' },
      h(Text, { bold: true }, panelTitle('Diff', focused)),
      h(Text, { dimColor: true }, selectedDetailFile?.path || 'no file')
    ),
    ...headerLines.map((line, index) => h(Text, {
      key: `diff-surface-header-${index}`,
      dimColor: index > 0,
    }, truncate(line, 140))),
    ...(filePreviewLoading || !previewHunks.length
      ? []
      : visiblePreviewHunks.map((line, index) => h(Text, {
        key: `diff-surface-line-${state.diffPreviewOffset + index}`,
        ...diffLineProps(line, theme),
      }, truncate(line, 140)))))
  }

  const diffLines = worktreeDiff?.lines || []
  const selectedHunk = worktreeHunks?.hunks[state.selectedWorktreeHunkIndex]
  const visibleDiffLines = diffLines.slice(
    state.worktreeDiffOffset,
    state.worktreeDiffOffset + visibleRows
  )
  const headerLines: string[] = isLogInkContextKeyLoading(contextStatus, 'worktree')
    ? ['Loading file context...']
    : worktreeDiffLoading
      ? [`Loading diff for ${worktreeFile?.path || 'selected file'}...`]
      : worktreeFile
      ? [
        `Selected file: ${worktreeFile.path}`,
        worktreeHunksLoading
          ? 'Hunks loading...'
          : worktreeHunks?.hunks.length
            ? `Hunk ${state.selectedWorktreeHunkIndex + 1}/${worktreeHunks.hunks.length} ${selectedHunk?.state || ''}`
            : 'No stageable hunks for this file.',
        `Lines ${Math.min(state.worktreeDiffOffset + 1, diffLines.length || 1)}-${Math.min(state.worktreeDiffOffset + visibleDiffLines.length, diffLines.length)}/${diffLines.length}`,
        '',
      ]
      : ['No changed file selected.']

  const showDiffLines = Boolean(worktreeFile) &&
    !worktreeDiffLoading &&
    !isLogInkContextKeyLoading(contextStatus, 'worktree')

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    flexGrow: 1,
    paddingX: 1,
  },
  h(Box, { justifyContent: 'space-between' },
    h(Text, { bold: true }, panelTitle('Diff', focused)),
    h(Text, { dimColor: true }, worktreeFile ? worktreeFile.path : 'no file')
  ),
  ...headerLines.map((line, index) => h(Text, {
    key: `diff-surface-header-${index}`,
    dimColor: index > 0,
  }, truncate(line, 140))),
  ...(showDiffLines
    ? visibleDiffLines.map((line, index) => h(Text, {
      key: `diff-surface-line-${state.worktreeDiffOffset + index}`,
      ...diffLineProps(line, theme),
    }, truncate(line, 140)))
    : []))
}

function renderDetailPanel(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  context: LogInkContext,
  contextStatus: LogInkContextStatus,
  detail: GitCommitDetail | undefined,
  loading: boolean,
  filePreview: GitCommitFilePreview | undefined,
  filePreviewLoading: boolean,
  width: number,
  theme: LogInkTheme
): ReactTypes.ReactElement {
  const focused = state.focus === 'detail'

  if (state.showHelp) {
    return renderHelpPanel(h, components, state, width, theme, focused)
  }

  if (state.showCommandPalette) {
    return renderCommandPalette(h, components, state, width, theme, focused)
  }

  if (state.pendingConfirmationId || state.pendingMutationConfirmation) {
    return renderConfirmationPanel(h, components, state, width, theme, focused)
  }

  // Status + worktree-sourced diff keep the staging compose panel — it's
  // the action surface for stage / hunk / commit. Commit-sourced diff (from
  // history → Enter) gets a dedicated explore panel: subject, body, and a
  // navigable file list whose selection swaps the center diff.
  if (state.activeView === 'status') {
    return renderCommitPanel(h, components, state, context, contextStatus, width, theme, focused)
  }

  if (state.activeView === 'diff') {
    if (state.diffSource === 'commit') {
      return renderCommitDiffDetail(h, components, state, detail, loading, width, theme, focused)
    }
    return renderCommitPanel(h, components, state, context, contextStatus, width, theme, focused)
  }

  // Compose view: the right panel had been falling through to the inspector
  // and showing the last selected commit's data, which is wrong context for
  // an in-progress commit. Show the worktree summary instead.
  if (state.activeView === 'compose') {
    return renderComposeContextPanel(h, components, state, context, contextStatus, width, theme, focused)
  }

  return renderHistoryInspector(
    h, components, state, context, contextStatus, detail, loading,
    filePreview, filePreviewLoading, width, theme, focused
  )
}

function renderHistoryInspector(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  context: LogInkContext,
  contextStatus: LogInkContextStatus,
  detail: GitCommitDetail | undefined,
  loading: boolean,
  _filePreview: GitCommitFilePreview | undefined,
  _filePreviewLoading: boolean,
  width: number,
  theme: LogInkTheme,
  focused: boolean
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const selected = getSelectedInkCommit(state)
  const workflowSections = getLogInkWorkflowSections({
    ...context,
    contextLoading: isLogInkContextLoading(contextStatus),
    selectedCommit: selected,
  })

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
    }, truncate(line, width - 4))))
  }

  const statLine = `${detail.stats.filesChanged} files  +${detail.stats.insertions}/-${detail.stats.deletions}`
  const headerLines = [
    detail.message,
    '',
    `Commit: ${compactHash(detail.hash)}`,
    `Author: ${detail.author}`,
    `Date: ${detail.date}`,
    detail.refs.length ? `Refs: ${detail.refs.join(', ')}` : 'Refs: none',
    statLine,
    '',
    ...(detail.body ? detail.body.split('\n').slice(0, 6) : ['No commit body.']),
    '',
    'Changed files:',
  ]

  const fileListMaxRows = Math.max(4, Math.min(detail.files.length, 10))
  const fileListNodes = renderCommitFileList(
    h, Text, detail.files, state.selectedFileIndex, focused, fileListMaxRows, width, theme
  )

  const trailerLines = [
    '',
    'Workflows:',
    ...workflowSections.flatMap((section) => [
      section.title,
      ...section.lines.slice(0, 3).map((line) => `  ${line}`),
    ]).slice(0, 12),
  ]

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    width,
    paddingX: 1,
  },
  h(Text, { bold: true }, panelTitle('Inspector', focused)),
  ...headerLines.map((line, index) => h(Text, {
    key: `detail-header-${index}`,
    dimColor: index > 1 && line !== 'Changed files:',
  }, truncate(line, width - 4))),
  ...fileListNodes,
  ...trailerLines.map((line, index) => h(Text, {
    key: `detail-trailer-${index}`,
    dimColor: index > 0,
  }, truncate(line, width - 4))))
}

function renderCommitDiffDetail(
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
    }, truncate(line, width - 4))))
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
  }, truncate(line, width - 4))),
  ...bodyLines.map((line, index) => h(Text, {
    key: `commit-diff-body-${index}`,
    dimColor: true,
  }, truncate(line, width - 4))),
  ...(bodyLines.length ? [h(Text, { key: 'commit-diff-body-spacer' }, '')] : []),
  ...filesHeader.map((line, index) => h(Text, {
    key: `commit-diff-files-${index}`,
    bold: true,
  }, truncate(line, width - 4))),
  ...fileListNodes,
  h(Text, undefined, ''),
  h(Text, { dimColor: true }, truncate(hint, width - 4)))
}

function renderComposeContextPanel(
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
  h(Text, { dimColor: true }, truncate(summary, width - 4)),
  h(Text, undefined, ''),
  ...(compose.loading
    ? [h(Text, {
      key: 'compose-context-loading',
      bold: true,
      color: theme.noColor ? undefined : theme.colors.accent,
    }, truncate(theme.ascii ? '[...] AI draft in progress' : '⏳ AI draft in progress', width - 4))]
    : []),
  ...(stagedFiles.length
    ? [
      h(Text, { key: 'compose-context-staged-title', bold: true }, 'Staged'),
      ...stagedFiles.map((file, index) => h(Text, {
        key: `compose-context-staged-${index}`,
        color: theme.noColor ? undefined : theme.colors.gitAdded,
      }, truncate(`  ${file.indexStatus} ${file.path}`, width - 4))),
      h(Text, { key: 'compose-context-staged-spacer' }, ''),
    ]
    : []),
  ...(unstagedFiles.length
    ? [
      h(Text, { key: 'compose-context-unstaged-title', bold: true }, 'Unstaged'),
      ...unstagedFiles.map((file, index) => h(Text, {
        key: `compose-context-unstaged-${index}`,
        color: theme.noColor ? undefined : theme.colors.gitModified,
      }, truncate(`  ${file.worktreeStatus} ${file.path}`, width - 4))),
    ]
    : !stagedFiles.length && !loadingWorktree
      ? [h(Text, { dimColor: true }, 'No worktree changes detected.')]
      : []))
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
  theme: LogInkTheme
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
    const label = `${cursor} ${statusCode} ${file.path}${renamed}${stats ? `  ${stats}` : ''}`

    return h(Text, {
      key: `commit-file-${index}`,
      color: statusCodeColor(file.status, theme),
      inverse: isSelected && focused && !theme.noColor,
      bold: isSelected,
    }, truncate(label, width - 4))
  })
}

function renderCommitPanel(
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
  const bodyLines = compose.body ? compose.body.split('\n').slice(0, 4) : ['<empty>']
  const headerLines = [
    statusLine,
    '',
    `${compose.field === 'summary' && compose.editing ? '>' : ' '} Summary: ${compose.summary || '<empty>'}${summaryCursor}`,
    `${compose.field === 'body' && compose.editing ? '>' : ' '} Body:`,
    ...bodyLines.map((line) => `  ${line}${bodyCursor && line === bodyLines[bodyLines.length - 1] ? bodyCursor : ''}`),
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
  }, truncate(line, width - 4))),
  loading
    ? h(Text, {
      key: 'commit-loading',
      bold: true,
      color: theme.noColor ? undefined : theme.colors.accent,
    }, truncate(theme.ascii ? '[...] Generating AI draft' : '⏳ Generating AI draft…', width - 4))
    : h(Text, { key: 'commit-state', dimColor: true }, truncate(stateLine, width - 4)),
  ...trailerLines.map((line, index) => h(Text, {
    key: `commit-trailer-${index}`,
    dimColor: line.startsWith('  '),
  }, truncate(line, width - 4))))
}

function renderConfirmationPanel(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  width: number,
  theme: LogInkTheme,
  focused: boolean
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const action = getLogInkWorkflowActionById(state.pendingConfirmationId)
  const mutationLabel = state.pendingMutationConfirmation === 'revert-hunk'
    ? 'Revert selected hunk'
    : state.pendingMutationConfirmation === 'revert-file'
      ? 'Revert selected file'
      : undefined
  const label = action?.label || mutationLabel || 'Workflow action'
  const warning = state.pendingMutationConfirmation
    ? 'This discards local changes and cannot be undone by Coco.'
    : action?.kind === 'ai'
    ? `AI action requires confirmation. Estimated ${action.estimatedTokens || '<unknown>'} tokens.`
    : 'Destructive Git action requires confirmation.'

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    width,
    paddingX: 1,
  },
  h(Text, { bold: true }, panelTitle('Confirm', focused)),
  h(Text, undefined, truncate(label, width - 4)),
  h(Text, { dimColor: true }, truncate(warning, width - 4)),
  h(Text, undefined, ''),
  h(Text, undefined, 'Press y to confirm or n/Esc to cancel.'))
}

function renderHelpPanel(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  width: number,
  theme: LogInkTheme,
  focused: boolean
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const children: ReactTypes.ReactNode[] = [
    h(Text, { bold: true, key: 'title' }, panelTitle('Help', focused)),
  ]

  const sections = getLogInkHelpSections({
    activeView: state.activeView,
    focus: state.focus,
  })

  for (const section of sections) {
    children.push(h(Text, { key: `${section.title}-spacer` }, ''))
    children.push(h(Text, { bold: true, key: section.title }, section.title))
    section.bindings.forEach((binding) => {
      children.push(h(Text, { key: `${section.title}:${binding.id}` },
        truncate(`${formatBindingKeys(binding).padEnd(14)} ${binding.description}`, width - 4)
      ))
    })
  }

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    width,
    paddingX: 1,
  }, ...children)
}

function renderCommandPalette(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  width: number,
  theme: LogInkTheme,
  focused: boolean
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const all = getLogInkPaletteCommands()
  const filtered = filterLogInkPaletteCommands(all, state.paletteFilter, state.paletteRecent)
  const recentSet = new Set(state.paletteRecent)
  const showingRecent = !state.paletteFilter.trim() && state.paletteRecent.length > 0

  const selectedIndex = filtered.length === 0
    ? 0
    : Math.max(0, Math.min(state.paletteSelectedIndex, filtered.length - 1))

  // Slide a window of rows around the selection so the cursor stays visible
  // even with hundreds of bindings.
  const listRows = 14
  const startIndex = Math.max(0, selectedIndex - Math.floor(listRows / 2))
  const visible = filtered.slice(startIndex, startIndex + listRows)

  const inputLine = `> ${state.paletteFilter}_`
  const matchSummary = filtered.length === 0
    ? 'no matches'
    : `${filtered.length} ${filtered.length === 1 ? 'match' : 'matches'}`
  const hint = '↑/↓ select · enter run · esc close'

  const itemLines = filtered.length === 0
    ? [h(Text, { key: 'palette-empty', dimColor: true }, 'No commands match the current filter.')]
    : visible.map((command, offset) => {
      const index = startIndex + offset
      const isSelected = index === selectedIndex
      const cursor = isSelected ? '>' : ' '
      const recentMarker = showingRecent && recentSet.has(command.id) ? '·' : ' '
      const kindMarker = command.kind === 'workflow'
        ? command.workflowKind === 'ai'
          ? '[AI]'
          : command.requiresConfirmation
            ? '[confirm]'
            : '[action]'
        : ''
      const line = `${cursor} ${recentMarker} ${command.keys.padEnd(8)} ${command.label.padEnd(20)} ${kindMarker ? `${kindMarker} ` : ''}${command.description}`
      return h(Text, {
        key: `palette-${command.kind}-${command.id}`,
        bold: isSelected,
        dimColor: !isSelected,
      }, truncate(line, width - 4))
    })

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    width,
    paddingX: 1,
  },
  h(Box, { justifyContent: 'space-between' },
    h(Text, { bold: true }, panelTitle('Command palette', focused)),
    h(Text, { dimColor: true }, matchSummary)
  ),
  h(Text, { color: theme.colors.accent }, truncate(inputLine, width - 4)),
  h(Text, { dimColor: true }, truncate(hint, width - 4)),
  h(Text, undefined, ''),
  ...(showingRecent
    ? [h(Text, { key: 'palette-recent-hint', dimColor: true }, '· marks recently-used')]
    : []),
  ...itemLines)
}

function renderFooter(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  theme: LogInkTheme
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const hints = getLogInkFooterHints({
    activeView: state.activeView,
    filterMode: state.filterMode,
    focus: state.focus,
    showCommandPalette: state.showCommandPalette,
    showHelp: state.showHelp,
  })
  const status = state.statusMessage ? `  ${state.statusMessage}` : ''
  const contextualText = `${hints.contextual.join('   ')}${status}`
  const globalText = hints.global.join(' · ')

  return h(Box, {
    flexDirection: 'row',
    height: 2,
    justifyContent: 'space-between',
    paddingX: 1,
  },
  h(Text, { color: theme.colors.muted, dimColor: true }, contextualText),
  h(Text, { color: theme.colors.muted, dimColor: true }, globalText))
}
