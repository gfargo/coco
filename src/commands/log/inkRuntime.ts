import type * as ReactTypes from 'react'
import { SimpleGit } from 'simple-git'
import { BranchOverview, getBranchOverview } from './branchData'
import { GitCommitDetail, GitLogCommitRow, GitLogRow, getCommitDetail } from './data'
import {
  formatBindingKeys,
  getLogInkCommandPaletteItems,
  getLogInkFooterHints,
  getLogInkHelpSections,
} from './inkKeymap'
import { createLogInkTheme, LogInkTheme } from './inkTheme'
import {
  LogInkSidebarTab,
  LogInkState,
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
import { WorktreeOverview, getWorktreeOverview } from './statusData'
import { TagOverview, getTagOverview } from './tagData'
import { WorktreeOverview as WorktreeListOverview, getWorktreeListOverview } from './worktreeData'

type DynamicImport = <T>(specifier: string) => Promise<T>
const dynamicImport = new Function('specifier', 'return import(specifier)') as DynamicImport

type LogInkStreams = {
  input?: NodeJS.ReadStream
  output?: NodeJS.WriteStream
  error?: NodeJS.WriteStream
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
    useInput: (handler: (input: string, key: LogInkKey) => void) => void
    useWindowSize: () => {
      columns: number
      rows: number
    }
  }
  React: typeof ReactTypes
}

type LogInkComponents = Pick<LogInkRuntime['ink'], 'Box' | 'Text'>

type LogInkKey = {
  backspace?: boolean
  ctrl?: boolean
  delete?: boolean
  downArrow?: boolean
  escape?: boolean
  meta?: boolean
  pageDown?: boolean
  pageUp?: boolean
  return?: boolean
  shift?: boolean
  tab?: boolean
  upArrow?: boolean
}

type LogInkComponentDeps = LogInkRuntime & {
  git: SimpleGit
  initialContext: LogInkContext
  rows: GitLogRow[]
  theme: LogInkTheme
}

const MIN_COLUMNS = 80
const MIN_ROWS = 24
const DEFAULT_COLUMNS = 120
const DEFAULT_ROWS = 40

function truncate(value: string, width: number): string {
  if (width < 1) {
    return ''
  }

  if (value.length <= width) {
    return value
  }

  if (width <= 3) {
    return value.slice(0, width)
  }

  return `${value.slice(0, width - 3)}...`
}

function compactHash(hash: string | undefined): string {
  return hash ? hash.slice(0, 7) : '<none>'
}

function formatRefs(commit: GitLogCommitRow): string {
  return commit.refs.length ? ` [${commit.refs.join(', ')}]` : ''
}

function formatChangedFile(file: GitCommitDetail['files'][number]): string {
  if (file.oldPath) {
    return `${file.status} ${file.oldPath} -> ${file.path}`
  }

  return `${file.status} ${file.path}`
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

function getVisibleCommits(state: LogInkState, visibleRows: number): {
  commits: GitLogCommitRow[]
  offset: number
} {
  const offset = Math.max(0, state.selectedIndex - Math.floor(visibleRows / 2))

  return {
    commits: state.filteredCommits.slice(offset, offset + visibleRows),
    offset,
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

function sidebarLines(context: LogInkContext, tab: LogInkSidebarTab, width: number): string[] {
  if (tab === 'status') {
    const worktree = context.worktree

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
    return context.tags?.tags.length
      ? context.tags.tags.slice(0, 12).map((tag) =>
        `${truncate(tag.name, 16)} ${truncate(tag.subject, Math.max(8, width - 18))}`
      )
      : ['No tags found']
  }

  if (tab === 'stashes') {
    return context.stashes?.stashes.length
      ? context.stashes.stashes.slice(0, 12).map((stash) =>
        `${stash.ref} ${truncate(stash.message, Math.max(8, width - stash.ref.length - 1))}`
      )
      : ['No stashes found']
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
  streams: LogInkStreams = {}
): Promise<void> {
  const input = streams.input || process.stdin
  const output = streams.output || process.stdout
  const error = streams.error || process.stderr

  if (!input.isTTY || !output.isTTY) {
    await startInteractiveLog(git, rows, { input, output })
    return
  }

  const [runtime, initialContext] = await Promise.all([
    loadInkRuntime(),
    loadLogInkContext(git),
  ])
  const { ink, React } = runtime
  const app = React.createElement(LogInkApp, {
    git,
    initialContext,
    ink,
    React,
    rows,
    theme: createLogInkTheme(),
  })
  const instance = ink.render(app, {
    exitOnCtrlC: true,
    patchConsole: false,
    stdin: input,
    stdout: output,
    stderr: error,
    alternateScreen: true,
  })

  await instance.waitUntilExit()
}

function LogInkApp(deps: LogInkComponentDeps): ReactTypes.ReactElement {
  const { git, initialContext, ink, React, rows, theme } = deps
  const { Box, Text, useApp, useInput, useWindowSize } = ink
  const h = React.createElement
  const { exit } = useApp()
  const windowSize = useWindowSize()
  const columns = windowSize.columns || process.stdout.columns || DEFAULT_COLUMNS
  const terminalRows = windowSize.rows || process.stdout.rows || DEFAULT_ROWS
  const [state, setState] = React.useState<LogInkState>(() => createLogInkState(rows))
  const [context, setContext] = React.useState<LogInkContext>(initialContext)
  const [detail, setDetail] = React.useState<GitCommitDetail | undefined>(undefined)
  const [detailLoading, setDetailLoading] = React.useState(false)
  const selected = getSelectedInkCommit(state)

  const dispatch = React.useCallback((action: Parameters<typeof applyLogInkAction>[1]) => {
    setState((current) => applyLogInkAction(current, action))
  }, [])

  const refreshContext = React.useCallback(async () => {
    dispatch({ type: 'setStatus', value: 'refreshing repository context' })
    setContext(await loadLogInkContext(git))
    dispatch({ type: 'setStatus', value: 'repository context refreshed' })
  }, [dispatch, git])

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

  useInput((inputValue: string, key: LogInkKey) => {
    if (key.ctrl && inputValue === 'c') {
      exit()
      return
    }

    if (state.filterMode) {
      if (key.return || key.escape) {
        dispatch({ type: 'toggleFilterMode' })
      } else if (key.backspace || key.delete) {
        dispatch({ type: 'backspaceFilter' })
      } else if (key.ctrl && inputValue === 'u') {
        dispatch({ type: 'clearFilter' })
      } else if (inputValue && !key.ctrl && !key.meta) {
        dispatch({ type: 'appendFilter', value: inputValue })
      }

      return
    }

    if (key.escape && state.showHelp) {
      dispatch({ type: 'toggleHelp' })
      return
    }

    if (key.escape && state.showCommandPalette) {
      dispatch({ type: 'toggleCommandPalette' })
      return
    }

    if (inputValue === 'q') {
      exit()
    } else if (inputValue === '?') {
      dispatch({ type: 'toggleHelp' })
    } else if (inputValue === '/') {
      dispatch({ type: 'toggleFilterMode' })
    } else if (inputValue === 'g') {
      dispatch({ type: 'toggleGraph' })
    } else if (inputValue === 'r') {
      void refreshContext()
    } else if (inputValue === ':') {
      dispatch({ type: 'toggleCommandPalette' })
    } else if (key.tab) {
      dispatch({ type: key.shift ? 'focusPrevious' : 'focusNext' })
    } else if (key.upArrow || inputValue === 'k') {
      dispatch(state.focus === 'sidebar' ? { type: 'previousSidebarTab' } : { type: 'move', delta: -1 })
    } else if (key.downArrow || inputValue === 'j') {
      dispatch(state.focus === 'sidebar' ? { type: 'nextSidebarTab' } : { type: 'move', delta: 1 })
    } else if (key.pageUp) {
      dispatch({ type: 'page', delta: -10 })
    } else if (key.pageDown) {
      dispatch({ type: 'page', delta: 10 })
    }
  })

  if (columns < MIN_COLUMNS || terminalRows < MIN_ROWS) {
    return h(Box, {
      flexDirection: 'column',
      height: terminalRows,
      paddingX: 1,
      paddingY: 1,
    },
    h(Text, { bold: true }, 'coco log -i'),
    h(Text, undefined, `Terminal too small: ${columns}x${terminalRows}`),
    h(Text, { dimColor: true }, `Minimum size is ${MIN_COLUMNS}x${MIN_ROWS}.`),
    h(Text, { dimColor: true }, 'Resize the terminal or run plain coco log.'))
  }

  const bodyRows = Math.max(8, terminalRows - 5)
  const sidebarWidth = Math.max(22, Math.min(34, Math.floor(columns * 0.24)))
  const detailWidth = Math.max(30, Math.min(56, Math.floor(columns * 0.34)))

  return h(Box, { flexDirection: 'column', height: terminalRows },
    renderHeader(h, { Box, Text }, state, context, columns, theme),
    h(Box, { flexDirection: 'row', height: bodyRows },
      renderSidebar(h, { Box, Text }, state, context, sidebarWidth, theme),
      renderCommitPanel(h, { Box, Text }, state, bodyRows, theme),
      renderDetailPanel(h, { Box, Text }, state, detail, detailLoading, detailWidth, theme)
    ),
    renderFooter(h, { Box, Text }, state, theme)
  )
}

function renderHeader(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  context: LogInkContext,
  columns: number,
  theme: LogInkTheme
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
  const title = truncate(`coco log  ${repo}  ${branch}  ${dirty}  ${pr}`, columns - 2)

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
  width: number,
  theme: LogInkTheme
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const focused = state.focus === 'sidebar'
  const lines = sidebarLines(context, state.sidebarTab, width - 4)
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

function renderCommitPanel(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  bodyRows: number,
  theme: LogInkTheme
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const focused = state.focus === 'commits'
  const listRows = Math.max(3, bodyRows - 4)
  const visible = getVisibleCommits(state, listRows)
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
    h(Text, { dimColor: true }, `${title} | ${graphMode}`)
  ),
  visible.commits.length === 0
    ? h(Text, { dimColor: true }, 'No commits match the current filter.')
    : visible.commits.map((commit, offset) => {
      const index = visible.offset + offset
      const selected = index === state.selectedIndex
      const graph = state.fullGraph ? commit.graph || '*' : '*'
      const row = `${graph.padEnd(state.fullGraph ? 8 : 2)} ${commit.shortHash} ${commit.date} ${commit.message}${formatRefs(commit)}`

      return h(Text, {
        key: commit.hash,
        backgroundColor: selected && !theme.noColor ? theme.colors.selection : undefined,
        inverse: selected,
      }, truncate(row, 140))
    }))
}

function renderDetailPanel(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  detail: GitCommitDetail | undefined,
  loading: boolean,
  width: number,
  theme: LogInkTheme
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const focused = state.focus === 'detail'

  if (state.showHelp) {
    return renderHelpPanel(h, components, width, theme, focused)
  }

  if (state.showCommandPalette) {
    return renderCommandPalette(h, components, width, theme, focused)
  }

  const selected = getSelectedInkCommit(state)
  const lines = detail
    ? [
      detail.message,
      '',
      `Commit: ${compactHash(detail.hash)}`,
      `Author: ${detail.author}`,
      `Date: ${detail.date}`,
      detail.refs.length ? `Refs: ${detail.refs.join(', ')}` : 'Refs: none',
      '',
      ...(detail.body ? detail.body.split('\n').slice(0, 6) : ['No commit body.']),
      '',
      'Changed files:',
      ...(detail.files.length ? detail.files.slice(0, 12).map(formatChangedFile) : ['No changed files found.']),
    ]
    : [
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
  h(Text, { bold: true }, panelTitle('Detail', focused)),
  ...lines.map((line, index) => h(Text, {
    key: `detail-${index}`,
    dimColor: index > 1 && line !== 'Changed files:',
  }, truncate(line, width - 4))))
}

function renderHelpPanel(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  width: number,
  theme: LogInkTheme,
  focused: boolean
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const children: ReactTypes.ReactNode[] = [
    h(Text, { bold: true, key: 'title' }, panelTitle('Help', focused)),
  ]

  for (const section of getLogInkHelpSections()) {
    children.push(h(Text, { key: `${section.title}-spacer` }, ''))
    children.push(h(Text, { bold: true, key: section.title }, section.title))
    section.bindings.forEach((binding) => {
      children.push(h(Text, { key: binding.id },
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
  width: number,
  theme: LogInkTheme,
  focused: boolean
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const commands = getLogInkCommandPaletteItems()

  return h(Box, {
    borderColor: focusBorderColor(theme, focused),
    borderStyle: theme.borderStyle,
    flexDirection: 'column',
    width,
    paddingX: 1,
  },
  h(Text, { bold: true }, panelTitle('Commands', focused)),
  h(Text, { dimColor: true }, 'Every command is sourced from the shared keymap.'),
  h(Text, undefined, ''),
  ...commands.map((command) => h(Text, {
    key: command.id,
  }, truncate(`${command.keys.padEnd(12)} ${command.label} - ${command.description}`, width - 4))))
}

function renderFooter(
  h: typeof ReactTypes.createElement,
  components: LogInkComponents,
  state: LogInkState,
  theme: LogInkTheme
): ReactTypes.ReactElement {
  const { Box, Text } = components
  const hints = getLogInkFooterHints({
    filterMode: state.filterMode,
    focus: state.focus,
    showCommandPalette: state.showCommandPalette,
    showHelp: state.showHelp,
  })
  const status = state.statusMessage ? `  ${state.statusMessage}` : ''

  return h(Box, {
    height: 2,
    paddingX: 1,
  },
  h(Text, { color: theme.colors.muted, dimColor: true }, `${hints.join('   ')}${status}`))
}
