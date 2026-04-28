import readline from 'readline'
import { SimpleGit } from 'simple-git'
import {
  BranchActionResult,
  checkoutBranch,
  deleteBranch,
  fetchRemotes,
  pullCurrentBranch,
  pushCurrentBranch,
} from './branchActions'
import { BranchOverview, BranchRef, getBranchOverview } from './branchData'
import { GitCommitDetail, GitLogRow, getCommitDetail } from './data'
import {
  LogTuiState,
  applyLogTuiAction,
  createLogTuiState,
  getSelectedCommit,
} from './interactiveState'

type LogTuiStreams = {
  input?: NodeJS.ReadStream
  output?: NodeJS.WriteStream
}

type RenderInteractiveLogOptions = {
  height?: number
  width?: number
}

type LogTuiFocus = 'commits' | 'branches'

type LogTuiRenderUi = {
  focus?: LogTuiFocus
  branchIndex?: number
  statusMessage?: string
  pendingDeleteBranch?: string
}

const DEFAULT_HEIGHT = 52
const DEFAULT_WIDTH = 120

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

function formatChangedFile(file: GitCommitDetail['files'][number]): string {
  if (file.oldPath) {
    return `${file.status}  ${file.oldPath} -> ${file.path}`
  }

  return `${file.status}  ${file.path}`
}

function renderCommitList(state: LogTuiState, maxRows: number, width: number): string[] {
  const start = Math.max(0, state.selectedIndex - Math.floor(maxRows / 2))
  const visible = state.filteredCommits.slice(start, start + maxRows)

  if (visible.length === 0) {
    return ['  No commits match the current filter.']
  }

  return visible.map((commit, offset) => {
    const index = start + offset
    const selected = index === state.selectedIndex ? '>' : ' '
    const graph = state.fullGraph ? commit.graph || '*' : '*'
    const refs = commit.refs.length ? ` [${commit.refs.join(', ')}]` : ''
    const row = [
      selected,
      graph.padEnd(state.fullGraph ? 8 : 2),
      commit.shortHash.padEnd(9),
      commit.date.padEnd(10),
      truncate(commit.author, 18).padEnd(18),
      `${commit.message}${refs}`,
    ].join(' ')

    return truncate(row, width)
  })
}

function formatDivergence(branch: BranchRef): string {
  if (!branch.upstream) {
    return 'no upstream'
  }

  if (branch.ahead === 0 && branch.behind === 0) {
    return `even with ${branch.upstream}`
  }

  return `+${branch.ahead}/-${branch.behind} vs ${branch.upstream}`
}

function getBranchList(overview: BranchOverview | undefined): BranchRef[] {
  if (!overview) {
    return []
  }

  return [...overview.localBranches, ...overview.remoteBranches]
}

function renderBranchOverview(
  overview: BranchOverview | undefined,
  ui: LogTuiRenderUi,
  width: number
): string[] {
  if (!overview) {
    return ['Branches: unavailable']
  }

  const dirty = overview.dirty ? 'dirty worktree' : 'clean worktree'
  const current = overview.localBranches.find((branch) => branch.current)
  const selectedBranches = getBranchList(overview)
  const isBranchFocused = ui.focus === 'branches'
  const localBranches = overview.localBranches
    .slice(0, 6)
    .map((branch) => {
      const marker = branch.current ? '*' : ' '
      const selected = isBranchFocused && selectedBranches[ui.branchIndex || 0] === branch ? '>' : ' '
      return `${selected}${marker} ${branch.shortName} ${formatDivergence(branch)}`
    })
  const remoteBranches = overview.remoteBranches.slice(0, 6).map((branch) => {
    const selected = isBranchFocused && selectedBranches[ui.branchIndex || 0] === branch ? '>' : ' '

    return `${selected}  ${branch.shortName}`
  })
  const hiddenLocal = overview.localBranches.length > localBranches.length
    ? [`  ... ${overview.localBranches.length - localBranches.length} more local branch(es)`]
    : []
  const hiddenRemote = overview.remoteBranches.length > remoteBranches.length
    ? [`  ... ${overview.remoteBranches.length - remoteBranches.length} more remote branch(es)`]
    : []

  return [
    `Branches: ${overview.currentBranch || '<detached>'} | ${dirty}`,
    current ? `Upstream: ${formatDivergence(current)}` : 'Upstream: none',
    ui.pendingDeleteBranch
      ? `Pending delete: press D to delete ${ui.pendingDeleteBranch}`
      : 'Branch actions: tab focus | enter checkout/track | f fetch | p push | P pull | d delete',
    'Local:',
    ...(localBranches.length ? localBranches : ['  No local branches found.']),
    'Remote:',
    ...(remoteBranches.length ? remoteBranches : ['  No remote branches found.']),
    ...hiddenLocal,
    ...hiddenRemote,
  ].map((line) => truncate(line, width))
}

function renderDetail(detail: GitCommitDetail | undefined, width: number): string[] {
  if (!detail) {
    return ['Loading selected commit details...']
  }

  const refs = detail.refs.length ? ` (${detail.refs.join(', ')})` : ''
  const body = detail.body ? ['', ...detail.body.split('\n').map((line) => `  ${line}`)] : []
  const files = detail.files.length
    ? detail.files.slice(0, 12).map((file) => `  ${formatChangedFile(file)}`)
    : ['  No changed files found.']
  const hiddenFiles = detail.files.length > 12
    ? [`  ... ${detail.files.length - 12} more file(s)`]
    : []

  return [
    truncate(`commit ${detail.hash}${refs}`, width),
    truncate(`Author: ${detail.author}`, width),
    truncate(`Date:   ${detail.date}`, width),
    '',
    truncate(`  ${detail.message}`, width),
    ...body.map((line) => truncate(line, width)),
    '',
    'Changed files:',
    ...files.map((line) => truncate(line, width)),
    ...hiddenFiles,
  ]
}

export function renderInteractiveLog(
  state: LogTuiState,
  detail?: GitCommitDetail,
  branches?: BranchOverview,
  ui: LogTuiRenderUi = {},
  options: RenderInteractiveLogOptions = {}
): string {
  const height = options.height || process.stdout.rows || DEFAULT_HEIGHT
  const width = options.width || process.stdout.columns || DEFAULT_WIDTH
  const selected = getSelectedCommit(state)
  const filter = state.filter ? state.filter : '<none>'
  const graphMode = state.fullGraph ? 'full graph' : 'compact graph'
  const focus = ui.focus || 'commits'
  const help = state.showHelp
    ? 'Keys: tab focus | up/down or j/k move | / search | enter checkout | g graph | f fetch | q quit'
    : 'Press ? for help'
  const detailHeader = selected
    ? `Selected: ${selected.shortHash} ${selected.message}`
    : 'Selected: none'
  const branchLines = renderBranchOverview(branches, ui, width).slice(0, 12)
  const listHeight = Math.max(4, Math.floor(height * 0.35))
  const detailHeight = Math.max(6, height - listHeight - branchLines.length - 10)
  const detailLines = renderDetail(detail, width).slice(0, detailHeight)
  const filterPrompt = state.filterMode ? `Search: ${state.filter}_` : `Filter: ${filter}`

  return [
    'coco log',
    `${state.filteredCommits.length}/${state.commits.length} commits | Focus: ${focus} | ${filterPrompt} | ${graphMode}`,
    help,
    ui.statusMessage ? truncate(`Status: ${ui.statusMessage}`, width) : '',
    '',
    ...branchLines,
    '',
    ...renderCommitList(state, listHeight, width),
    '',
    truncate(detailHeader, width),
    '-'.repeat(Math.min(width, 80)),
    ...detailLines,
  ].join('\n')
}

export async function startInteractiveLog(
  git: SimpleGit,
  rows: GitLogRow[],
  streams: LogTuiStreams = {}
): Promise<void> {
  const input = streams.input || process.stdin
  const output = streams.output || process.stdout
  let state = createLogTuiState(rows)
  const details = new Map<string, GitCommitDetail>()
  let branches: BranchOverview | undefined
  let focus: LogTuiFocus = 'commits'
  let branchIndex = 0
  let statusMessage: string | undefined
  let pendingDeleteBranch: string | undefined

  async function loadSelectedDetail(): Promise<GitCommitDetail | undefined> {
    const selected = getSelectedCommit(state)

    if (!selected) {
      return undefined
    }

    const cached = details.get(selected.hash)
    if (cached) {
      return cached
    }

    const detail = await getCommitDetail(git, selected.hash)
    details.set(selected.hash, detail)
    return detail
  }

  if (!input.isTTY || !output.isTTY) {
    try {
      branches = await getBranchOverview(git)
    } catch {
      branches = undefined
    }

    output.write(`${renderInteractiveLog(state, await loadSelectedDetail(), branches)}\n`, 'utf8')
    return
  }

  readline.emitKeypressEvents(input)
  input.setRawMode(true)
  output.write('\x1b[?25l', 'utf8')

  let closed = false
  let renderVersion = 0

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      closed = true
      input.off('keypress', onKeypress)
      input.setRawMode(false)
      output.write('\x1b[?25h\n', 'utf8')
      resolve()
    }

    const render = async () => {
      const version = ++renderVersion
      const ui = {
        focus,
        branchIndex,
        statusMessage,
        pendingDeleteBranch,
      }

      output.write(`\x1b[2J\x1b[H${renderInteractiveLog(state, undefined, branches, ui)}\n`, 'utf8')

      try {
        const detail = await loadSelectedDetail()

        if (!closed && version === renderVersion) {
          output.write(`\x1b[2J\x1b[H${renderInteractiveLog(state, detail, branches, ui)}\n`, 'utf8')
        }
      } catch (error) {
        reject(error)
      }
    }

    const applyAndRender = (nextState: LogTuiState) => {
      state = nextState
      void render()
    }

    const refreshBranches = async () => {
      branches = await getBranchOverview(git)
      branchIndex = Math.max(0, Math.min(branchIndex, getBranchList(branches).length - 1))
    }

    const setActionResult = async (result: BranchActionResult, refresh = true) => {
      statusMessage = result.message
      pendingDeleteBranch = undefined

      if (refresh) {
        await refreshBranches()
      }

      await render()
    }

    const selectedBranch = () => getBranchList(branches)[branchIndex]

    const moveBranchSelection = (delta: number) => {
      const branchesList = getBranchList(branches)

      branchIndex = Math.max(0, Math.min(branchIndex + delta, branchesList.length - 1))
      pendingDeleteBranch = undefined
      void render()
    }

    const runBranchAction = async (action: () => Promise<BranchActionResult>, refresh = true) => {
      statusMessage = 'Running branch action...'
      await render()
      await setActionResult(await action(), refresh)
    }

    const onFilterKeypress = (sequence: string | undefined, key: readline.Key) => {
      if (key.name === 'return' || key.name === 'escape') {
        applyAndRender(applyLogTuiAction(state, { type: 'toggleFilterMode' }))
        return
      }

      if (key.name === 'backspace') {
        applyAndRender(applyLogTuiAction(state, { type: 'backspaceFilter' }))
        return
      }

      if (key.ctrl && key.name === 'u') {
        applyAndRender(applyLogTuiAction(state, { type: 'clearFilter' }))
        return
      }

      if (sequence && sequence.length === 1 && !key.ctrl && !key.meta) {
        applyAndRender(applyLogTuiAction(state, { type: 'appendFilter', value: sequence }))
      }
    }

    const onKeypress = (sequence: string | undefined, key: readline.Key) => {
      if ((key.ctrl && key.name === 'c') || key.name === 'q') {
        cleanup()
        return
      }

      if (state.filterMode) {
        onFilterKeypress(sequence, key)
        return
      }

      if (key.name === 'tab') {
        focus = focus === 'commits' ? 'branches' : 'commits'
        pendingDeleteBranch = undefined
        void render()
      } else if ((key.name === 'up' || key.name === 'k') && focus === 'branches') {
        moveBranchSelection(-1)
      } else if ((key.name === 'down' || key.name === 'j') && focus === 'branches') {
        moveBranchSelection(1)
      } else if (key.name === 'return' && focus === 'branches') {
        const branch = selectedBranch()

        if (branch) {
          void runBranchAction(() => checkoutBranch(git, branch))
        }
      } else if (key.name === 'f') {
        void runBranchAction(() => fetchRemotes(git))
      } else if (key.name === 'p' && sequence !== 'P') {
        void runBranchAction(() => pushCurrentBranch(git))
      } else if (sequence === 'P') {
        void runBranchAction(() => pullCurrentBranch(git))
      } else if (key.name === 'd' && focus === 'branches') {
        const branch = selectedBranch()

        if (branch) {
          pendingDeleteBranch = branch.shortName
          statusMessage = `Press D to confirm deleting ${branch.shortName}`
          void render()
        }
      } else if (sequence === 'D' && focus === 'branches') {
        const branch = selectedBranch()

        if (branch && pendingDeleteBranch === branch.shortName) {
          void runBranchAction(() => deleteBranch(git, branch))
        }
      } else if (key.name === 'r') {
        void runBranchAction(async () => {
          await refreshBranches()

          return {
            ok: true,
            message: 'Refreshed branch overview',
          }
        }, false)
      } else if (key.name === 'up' || key.name === 'k') {
        applyAndRender(applyLogTuiAction(state, { type: 'move', delta: -1 }))
      } else if (key.name === 'down' || key.name === 'j') {
        applyAndRender(applyLogTuiAction(state, { type: 'move', delta: 1 }))
      } else if (key.name === 'pageup') {
        applyAndRender(applyLogTuiAction(state, { type: 'page', delta: -10 }))
      } else if (key.name === 'pagedown') {
        applyAndRender(applyLogTuiAction(state, { type: 'page', delta: 10 }))
      } else if (key.name === 'g') {
        applyAndRender(applyLogTuiAction(state, { type: 'toggleGraph' }))
      } else if (key.name === '/') {
        applyAndRender(applyLogTuiAction(state, { type: 'toggleFilterMode' }))
      } else if (key.name === '?') {
        applyAndRender(applyLogTuiAction(state, { type: 'toggleHelp' }))
      } else if (key.name === 'escape') {
        applyAndRender(applyLogTuiAction(state, { type: 'clearFilter' }))
      }
    }

    input.on('keypress', onKeypress)
    void refreshBranches()
      .then(() => {
        void render()
      })
      .catch(() => {
        branches = undefined
      })
    void render()
  })
}
