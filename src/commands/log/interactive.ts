import readline from 'readline'
import { SimpleGit } from 'simple-git'
import {
  BranchActionResult,
  checkoutBranch,
  createBranch,
  deleteBranch,
  fetchRemotes,
  pullCurrentBranch,
  pushCurrentBranch,
  renameBranch,
  setUpstream,
} from './branchActions'
import { BranchOverview, BranchRef, getBranchOverview } from './branchData'
import { runCommitWorkflow } from './commitWorkflowActions'
import { GitCommitDetail, GitLogRow, getCommitDetail } from './data'
import {
  HistoryCommitRef,
  ReflogEntry,
  ResetMode,
  amendHeadCommit,
  cherryPickCommit,
  compareCommits,
  copyCommitHash,
  copyCommitMessage,
  getReflogEntries,
  isResetMode,
  openCommitOnRemote,
  resetToCommit,
  revertCommit,
  rewordHeadCommit,
  startInteractiveRebase,
} from './historyActions'
import { createPullRequest, openPullRequest } from './pullRequestActions'
import { PullRequestOverview, getPullRequestOverview } from './pullRequestData'
import { applyStash, createStash, dropStash, popStash } from './stashActions'
import { StashEntry, StashOverview, getStashDiffSummary, getStashOverview } from './stashData'
import { revertFile, stageFile, unstageFile } from './statusActions'
import { WorktreeFile, WorktreeOverview, getWorktreeOverview } from './statusData'
import { WorktreeHunkOverview, getWorktreeHunks, revertHunk, stageHunk, unstageHunk } from './statusHunks'
import {
  createAnnotatedTag,
  createLightweightTag,
  deleteLocalTag,
  deleteRemoteTag,
  pushTag,
} from './tagActions'
import { TagOverview, TagRangeSummary, getTagOverview, getTagRangeSummary } from './tagData'
import {
  createBranchWorktree,
  createWorktree,
  removeWorktree,
  worktreePathAction,
} from './worktreeActions'
import {
  WorktreeEntry,
  WorktreeOverview as WorktreeListOverview,
  getWorktreeListOverview,
} from './worktreeData'
import {
  LogTuiState,
  applyLogTuiAction,
  createLogTuiState,
  getSelectedCommit,
} from './interactiveState'
import { abortOperation, continueOperation, skipOperation } from './operationActions'
import { GitOperationOverview, getGitOperationOverview } from './operationData'

type LogTuiStreams = {
  input?: NodeJS.ReadStream
  output?: NodeJS.WriteStream
}

type RenderInteractiveLogOptions = {
  height?: number
  width?: number
}

type RenderInteractiveLogWorkspace = {
  stashes?: StashOverview
  worktreeList?: WorktreeListOverview
  stashDiffSummary?: string[]
}

type RenderInteractiveLogHistory = {
  compareBase?: HistoryCommitRef
  reflog?: ReflogEntry[]
}

type LogTuiFocus = 'commits' | 'branches' | 'tags' | 'status' | 'workspace'
type WorkspaceSection = 'stashes' | 'worktrees'

type LogTuiRenderUi = {
  focus?: LogTuiFocus
  branchIndex?: number
  statusMessage?: string
  statusDetails?: string[]
  pendingDeleteBranch?: string
  pendingDeleteTag?: string
  pendingDeleteRemoteTag?: string
  inputPrompt?: LogTuiInputPrompt
  pullRequestDraft?: boolean
  tagIndex?: number
  statusIndex?: number
  statusHunks?: WorktreeHunkOverview
  statusHunkIndex?: number
  pendingRevertFile?: string
  pendingRevertHunk?: string
  stashIndex?: number
  worktreeIndex?: number
  workspaceSection?: WorkspaceSection
  pendingDropStash?: string
  pendingRemoveWorktree?: string
  pendingCherryPick?: string
  pendingRevertCommit?: string
  pendingResetCommit?: string
  pendingResetMode?: ResetMode
  pendingRebaseCommit?: string
  pendingOperationAction?: 'continue' | 'abort' | 'skip'
  noVerify?: boolean
}

type LogTuiInputKind =
  | 'create-branch'
  | 'rename-branch'
  | 'create-pr-title'
  | 'create-tag'
  | 'create-annotated-tag'
  | 'reword-commit'
  | 'create-stash'
  | 'create-worktree'
  | 'create-branch-worktree-path'
  | 'create-branch-worktree-branch'
  | 'reset-mode'

type LogTuiInputPrompt = {
  kind: LogTuiInputKind
  label: string
  value: string
  sourceRef: string
  branchName?: string
  baseRef?: string
  tagName?: string
  commitHash?: string
  worktreePath?: string
}

const DEFAULT_HEIGHT = 70
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

function renderPullRequestOverview(
  overview: PullRequestOverview | undefined,
  ui: LogTuiRenderUi,
  width: number
): string[] {
  if (!overview) {
    return ['Pull request: unavailable']
  }

  if (!overview.available || !overview.authenticated) {
    return [
      `Pull request: ${overview.message || 'GitHub PR workflow unavailable.'}`,
    ].map((line) => truncate(line, width))
  }

  const repo = overview.repository
    ? `${overview.repository.owner}/${overview.repository.name}`
    : 'GitHub repository'
  const draft = ui.pullRequestDraft ? 'draft' : 'ready'
  const action = 'PR actions: C create | v draft toggle | o open current PR'

  if (!overview.currentPullRequest) {
    return [
      `Pull request: no PR for ${overview.currentBranch || '<detached>'} on ${repo}`,
      `Create mode: ${draft}`,
      action,
    ].map((line) => truncate(line, width))
  }

  const pr = overview.currentPullRequest
  const prState = `${pr.state}${pr.isDraft ? ' draft' : ''}`

  return [
    `Pull request: #${pr.number} ${prState} ${pr.headRefName} -> ${pr.baseRefName}`,
    `Title: ${pr.title}`,
    `URL: ${pr.url}`,
    action,
  ].map((line) => truncate(line, width))
}

function renderTagOverview(
  overview: TagOverview | undefined,
  summary: TagRangeSummary | undefined,
  ui: LogTuiRenderUi,
  width: number
): string[] {
  if (!overview) {
    return ['Tags: unavailable']
  }

  const tags = overview.tags.slice(0, 6).map((tag, index) => {
    const selected = ui.focus === 'tags' && (ui.tagIndex || 0) === index ? '>' : ' '

    return `${selected} ${tag.name} ${tag.date} ${tag.hash} ${tag.subject}`
  })
  const hiddenTags = overview.tags.length > tags.length
    ? [`  ... ${overview.tags.length - tags.length} more tag(s)`]
    : []
  const deletePrompt = ui.pendingDeleteTag
    ? `Pending tag delete: press X to delete ${ui.pendingDeleteTag}`
    : ui.pendingDeleteRemoteTag
      ? `Pending remote tag delete: press Y to delete origin/${ui.pendingDeleteRemoteTag}`
      : 'Tag actions: t tag | a annotated | s push | x delete local | y delete remote | R range'
  const summaryLine = summary
    ? `Range ${summary.from}..${summary.to}: ${summary.commitCount} commits, ${summary.authors.length} authors, ${summary.changedFiles.length} files`
    : 'Range: select a tag and press R to compare with HEAD'

  return [
    'Tags:',
    ...(tags.length ? tags : ['  No tags found.']),
    ...hiddenTags,
    deletePrompt,
    summaryLine,
  ].map((line) => truncate(line, width))
}

function renderStatusOverview(
  overview: WorktreeOverview | undefined,
  ui: LogTuiRenderUi,
  width: number
): string[] {
  if (!overview) {
    return ['Status: unavailable']
  }

  const files = overview.files.slice(0, 8).map((file, index) => {
    const selected = ui.focus === 'status' && (ui.statusIndex || 0) === index ? '>' : ' '

    return `${selected} ${file.indexStatus}${file.worktreeStatus} ${file.path}`
  })
  const hiddenFiles = overview.files.length > files.length
    ? [`  ... ${overview.files.length - files.length} more file(s)`]
    : []
  const hunkOverview = ui.statusHunks
  const hunkLines = hunkOverview?.hunks.length
    ? hunkOverview.hunks.slice(0, 5).map((hunk, index) => {
      const selected = ui.focus === 'status' && (ui.statusHunkIndex || 0) === index ? '>' : ' '
      const state = hunk.state === 'staged' ? 'S' : 'U'
      const preview = hunk.preview ? ` ${hunk.preview}` : ''

      return `${selected} [${state}] ${hunk.header}${preview}`
    })
    : []
  const hiddenHunks = hunkOverview && hunkOverview.hunks.length > hunkLines.length
    ? [`  ... ${hunkOverview.hunks.length - hunkLines.length} more hunk(s)`]
    : []
  const actionLine = ui.pendingRevertFile
    ? `Pending revert: press Z to revert ${ui.pendingRevertFile}`
    : ui.pendingRevertHunk
      ? 'Pending hunk revert: press Z to revert selected hunk'
    : 'Status actions: space file | enter hunk | [/] hunk select | c commit | S split plan | A split apply | z revert'

  return [
    `Status: ${overview.stagedCount} staged, ${overview.unstagedCount} unstaged, ${overview.untrackedCount} untracked`,
    ...(files.length ? files : ['  Worktree clean.']),
    ...hiddenFiles,
    ...(hunkOverview ? [`Hunks: ${hunkOverview.filePath}`, ...hunkLines, ...hiddenHunks] : []),
    actionLine,
  ].map((line) => truncate(line, width))
}

function renderWorkspaceOverview(
  stashes: StashOverview | undefined,
  worktrees: WorktreeListOverview | undefined,
  stashDiffSummary: string[] | undefined,
  ui: LogTuiRenderUi,
  width: number
): string[] {
  const section = ui.workspaceSection || 'stashes'
  const stashLines = stashes?.stashes.slice(0, 4).map((stash, index) => {
    const selected = ui.focus === 'workspace' && section === 'stashes' && (ui.stashIndex || 0) === index ? '>' : ' '
    const files = stash.files.length ? ` ${stash.files.length} file(s)` : ''

    return `${selected} ${stash.ref} ${stash.branch}: ${stash.message}${files}`
  }) || []
  const worktreeLines = worktrees?.worktrees.slice(0, 4).map((worktree, index) => {
    const selected = ui.focus === 'workspace' && section === 'worktrees' && (ui.worktreeIndex || 0) === index ? '>' : ' '
    const marker = worktree.current ? '*' : ' '
    const branch = worktree.branch || (worktree.detached ? '<detached>' : '<unknown>')
    const dirty = worktree.dirty ? 'dirty' : 'clean'

    return `${selected}${marker} ${branch} ${dirty} ${worktree.path}`
  }) || []
  const actionLine = ui.pendingDropStash
    ? `Pending stash drop: press D to drop ${ui.pendingDropStash}`
    : ui.pendingRemoveWorktree
      ? `Pending worktree remove: press X to remove ${ui.pendingRemoveWorktree}`
      : 'Workspace actions: [/] section | s stash | a apply | P pop | d drop | i inspect | w worktree | B branch+worktree | x remove | o path'
  const diffLines = stashDiffSummary?.slice(0, 3).map((line) => `  ${line}`) || []

  return [
    `Workspace: ${section}`,
    'Stashes:',
    ...(stashLines.length ? stashLines : ['  No stashes found.']),
    'Worktrees:',
    ...(worktreeLines.length ? worktreeLines : ['  No linked worktrees found.']),
    ...diffLines,
    actionLine,
  ].map((line) => truncate(line, width))
}

function renderHistoryOverview(
  history: RenderInteractiveLogHistory,
  ui: LogTuiRenderUi,
  width: number
): string[] {
  const pendingLine = ui.pendingCherryPick
    ? `Pending cherry-pick: press Y to cherry-pick ${ui.pendingCherryPick}`
    : ui.pendingRevertCommit
      ? `Pending revert: press V to revert ${ui.pendingRevertCommit}`
      : ui.pendingResetCommit && ui.pendingResetMode
        ? `Pending reset: press X to reset --${ui.pendingResetMode} to ${ui.pendingResetCommit}`
        : ui.pendingRebaseCommit
          ? `Pending rebase: press B to start rebase from ${ui.pendingRebaseCommit}`
          : undefined
  const compareLine = history.compareBase
    ? `Compare base: ${history.compareBase.shortHash} ${history.compareBase.message}`
    : 'Compare: press = on a commit, then = on another commit'
  const reflogLines = history.reflog?.slice(0, 5).map((entry) => (
    `  ${entry.selector} ${entry.hash} ${entry.subject}`
  )) || []

  return [
    'History:',
    pendingLine || 'History actions: h hash | H message | O open | = compare | y cherry-pick | V revert | ! reset | B rebase | F reflog',
    compareLine,
    ...(reflogLines.length ? ['Reflog:', ...reflogLines] : []),
  ].map((line) => truncate(line, width))
}

function renderOperationOverview(
  overview: GitOperationOverview | undefined,
  ui: LogTuiRenderUi,
  width: number
): string[] {
  if (!overview) {
    return ['Operation: unavailable']
  }

  if (overview.operation === 'none' && overview.conflictedFiles.length === 0 && !ui.pendingOperationAction) {
    return [
      `Operation: none | no-verify ${ui.noVerify ? 'on' : 'off'}`,
      'Operation actions: none active | N no-verify',
    ].map((line) => truncate(line, width))
  }

  const operation = overview.operation === 'none' ? 'none' : `${overview.operation} in progress`
  const pendingLine = ui.pendingOperationAction
    ? `Pending ${ui.pendingOperationAction}: press G to confirm ${ui.pendingOperationAction} ${overview.operation}`
    : overview.operation === 'none'
      ? 'Operation actions: none active | N no-verify'
      : 'Operation actions: g continue | A abort | K skip | N no-verify'
  const conflictLines = overview.conflictedFiles.slice(0, 5).map((file) => (
    `  ${file.indexStatus}${file.worktreeStatus} ${file.path}`
  ))
  const markerLines = overview.conflictMarkers.slice(0, 5).map((marker) => (
    `  ${marker.path}:${marker.line} ${marker.marker}`
  ))
  const hookLine = overview.hooks.configuredHooks.length
    ? `Hooks: ${overview.hooks.configuredHooks.slice(0, 5).join(', ')}`
    : 'Hooks: none configured'
  const aiLine = overview.aiConflictHelpAvailable
    ? 'AI conflict help: opt-in action planned; no remote call made automatically'
    : 'AI conflict help: available when conflicts exist'

  return [
    `Operation: ${operation} | no-verify ${ui.noVerify ? 'on' : 'off'}`,
    pendingLine,
    `Conflicts: ${overview.conflictedFiles.length}`,
    ...(conflictLines.length ? conflictLines : ['  No conflicted files.']),
    ...(markerLines.length ? ['Conflict markers:', ...markerLines] : []),
    hookLine,
    `Hooks path: ${overview.hooks.hooksPath}`,
    aiLine,
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
  pullRequest?: PullRequestOverview,
  tags?: TagOverview,
  tagRangeSummary?: TagRangeSummary,
  worktree?: WorktreeOverview,
  ui: LogTuiRenderUi = {},
  options: RenderInteractiveLogOptions = {},
  workspace: RenderInteractiveLogWorkspace = {},
  history: RenderInteractiveLogHistory = {},
  operation?: GitOperationOverview
): string {
  const height = options.height || process.stdout.rows || DEFAULT_HEIGHT
  const width = options.width || process.stdout.columns || DEFAULT_WIDTH
  const selected = getSelectedCommit(state)
  const filter = state.filter ? state.filter : '<none>'
  const graphMode = state.fullGraph ? 'full graph' : 'compact graph'
  const focus = ui.focus || 'commits'
  const help = state.showHelp
    ? 'Keys: tab focus | up/down move | n branch | t tag | C PR | c commit | history h/H/O/= | q quit'
    : 'Press ? for help'
  const commitActions = focus === 'commits'
    ? 'Commit actions: e amend HEAD | w reword HEAD | h hash | H message | O open | = compare'
    : ''
  const detailHeader = selected
    ? `Selected: ${selected.shortHash} ${selected.message}`
    : 'Selected: none'
  const branchLines = renderBranchOverview(branches, ui, width).slice(0, 12)
  const pullRequestLines = renderPullRequestOverview(pullRequest, ui, width).slice(0, 4)
  const tagLines = renderTagOverview(tags, tagRangeSummary, ui, width).slice(0, 10)
  const statusLines = renderStatusOverview(worktree, ui, width).slice(0, 10)
  const workspaceLines = workspace.stashes || workspace.worktreeList
    ? renderWorkspaceOverview(
      workspace.stashes,
      workspace.worktreeList,
      workspace.stashDiffSummary,
      ui,
      width
    ).slice(0, 12)
    : []
  const historyLines = renderHistoryOverview(history, ui, width).slice(0, 8)
  const operationLines = renderOperationOverview(operation, ui, width).slice(0, 12)
  const listHeight = Math.max(4, Math.floor(height * 0.35))
  const detailHeight = Math.max(
    6,
    height -
      listHeight -
      branchLines.length -
      pullRequestLines.length -
      tagLines.length -
      statusLines.length -
      workspaceLines.length -
      historyLines.length -
      operationLines.length -
      11
  )
  const detailLines = renderDetail(detail, width).slice(0, detailHeight)
  const filterPrompt = state.filterMode ? `Search: ${state.filter}_` : `Filter: ${filter}`

  return [
    'coco log',
    `${state.filteredCommits.length}/${state.commits.length} commits | Focus: ${focus} | ${filterPrompt} | ${graphMode}`,
    help,
    commitActions,
    ui.statusMessage ? truncate(`Status: ${ui.statusMessage}`, width) : '',
    ...(ui.statusDetails || []).slice(0, 4).map((line) => truncate(`  ${line}`, width)),
    ui.inputPrompt ? truncate(`${ui.inputPrompt.label}: ${ui.inputPrompt.value}_`, width) : '',
    '',
    ...branchLines,
    ...pullRequestLines,
    ...tagLines,
    ...statusLines,
    ...workspaceLines,
    ...historyLines,
    ...operationLines,
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
  let pullRequest: PullRequestOverview | undefined
  let tags: TagOverview | undefined
  let tagRangeSummary: TagRangeSummary | undefined
  let worktree: WorktreeOverview | undefined
  let statusHunks: WorktreeHunkOverview | undefined
  let stashes: StashOverview | undefined
  let worktreeList: WorktreeListOverview | undefined
  let stashDiffSummary: string[] | undefined
  let compareBase: HistoryCommitRef | undefined
  let reflog: ReflogEntry[] | undefined
  let operationOverview: GitOperationOverview | undefined
  let focus: LogTuiFocus = 'commits'
  let branchIndex = 0
  let tagIndex = 0
  let statusIndex = 0
  let statusHunkIndex = 0
  let stashIndex = 0
  let worktreeIndex = 0
  let workspaceSection: WorkspaceSection = 'stashes'
  let statusMessage: string | undefined
  let statusDetails: string[] | undefined
  let pendingDeleteBranch: string | undefined
  let pendingDeleteTag: string | undefined
  let pendingDeleteRemoteTag: string | undefined
  let pendingRevertFile: string | undefined
  let pendingRevertHunk: string | undefined
  let pendingDropStash: string | undefined
  let pendingRemoveWorktree: string | undefined
  let pendingCherryPick: string | undefined
  let pendingRevertCommit: string | undefined
  let pendingResetCommit: string | undefined
  let pendingResetMode: ResetMode | undefined
  let pendingRebaseCommit: string | undefined
  let pendingOperationAction: 'continue' | 'abort' | 'skip' | undefined
  let inputPrompt: LogTuiInputPrompt | undefined
  let pullRequestDraft = false
  let noVerify = false

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
      [branches, pullRequest, tags, worktree, stashes, worktreeList, operationOverview] = await Promise.all([
        getBranchOverview(git),
        getPullRequestOverview(git),
        getTagOverview(git),
        getWorktreeOverview(git),
        getStashOverview(git),
        getWorktreeListOverview(git),
        getGitOperationOverview(git),
      ])
    } catch {
      branches = undefined
    }

    output.write(
      `${renderInteractiveLog(
        state,
        await loadSelectedDetail(),
        branches,
        pullRequest,
        tags,
        tagRangeSummary,
        worktree,
        {},
        {},
        { stashes, worktreeList },
        {},
        operationOverview
      )}\n`,
      'utf8'
    )
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
        statusDetails,
        pendingDeleteBranch,
        pendingDeleteTag,
        pendingDeleteRemoteTag,
        pendingRevertFile,
        pendingRevertHunk,
        inputPrompt,
        pullRequestDraft,
        tagIndex,
        statusIndex,
        statusHunks,
        statusHunkIndex,
        stashIndex,
        worktreeIndex,
        workspaceSection,
        pendingDropStash,
        pendingRemoveWorktree,
        pendingCherryPick,
        pendingRevertCommit,
        pendingResetCommit,
        pendingResetMode,
        pendingRebaseCommit,
        pendingOperationAction,
        noVerify,
      }

      output.write(
        `\x1b[2J\x1b[H${renderInteractiveLog(
          state,
          undefined,
          branches,
          pullRequest,
          tags,
          tagRangeSummary,
          worktree,
          ui,
          {},
          { stashes, worktreeList, stashDiffSummary },
          { compareBase, reflog },
          operationOverview
        )}\n`,
        'utf8'
      )

      try {
        const detail = await loadSelectedDetail()

        if (!closed && version === renderVersion) {
          output.write(
            `\x1b[2J\x1b[H${renderInteractiveLog(
              state,
              detail,
              branches,
              pullRequest,
              tags,
              tagRangeSummary,
              worktree,
              ui,
              {},
              { stashes, worktreeList, stashDiffSummary },
              { compareBase, reflog },
              operationOverview
            )}\n`,
            'utf8'
          )
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

    const refreshPullRequest = async () => {
      pullRequest = await getPullRequestOverview(git)
    }

    const refreshTags = async () => {
      tags = await getTagOverview(git)
      tagIndex = Math.max(0, Math.min(tagIndex, (tags?.tags.length || 1) - 1))
    }

    const refreshWorktree = async () => {
      worktree = await getWorktreeOverview(git)
      statusIndex = Math.max(0, Math.min(statusIndex, (worktree?.files.length || 1) - 1))
    }

    const refreshStatusHunks = async () => {
      statusHunks = await getWorktreeHunks(git, worktree?.files[statusIndex])
      statusHunkIndex = Math.max(0, Math.min(statusHunkIndex, (statusHunks?.hunks.length || 1) - 1))
    }

    const refreshStashes = async () => {
      stashes = await getStashOverview(git)
      stashIndex = Math.max(0, Math.min(stashIndex, (stashes?.stashes.length || 1) - 1))
    }

    const refreshWorktreeList = async () => {
      worktreeList = await getWorktreeListOverview(git)
      worktreeIndex = Math.max(0, Math.min(worktreeIndex, (worktreeList?.worktrees.length || 1) - 1))
    }

    const refreshOperationOverview = async () => {
      operationOverview = await getGitOperationOverview(git)
    }

    const setActionResult = async (result: BranchActionResult, refresh = true) => {
      statusMessage = result.message
      statusDetails = result.details
      pendingDeleteBranch = undefined
      pendingDeleteTag = undefined
      pendingDeleteRemoteTag = undefined
      pendingRevertFile = undefined
      pendingRevertHunk = undefined
      pendingDropStash = undefined
      pendingRemoveWorktree = undefined
      pendingCherryPick = undefined
      pendingRevertCommit = undefined
      pendingResetCommit = undefined
      pendingResetMode = undefined
      pendingRebaseCommit = undefined
      pendingOperationAction = undefined
      inputPrompt = undefined

      if (refresh) {
        await Promise.all([
          refreshBranches(),
          refreshPullRequest(),
          refreshTags(),
          refreshWorktree(),
          refreshStashes(),
          refreshWorktreeList(),
          refreshOperationOverview(),
        ])
        await refreshStatusHunks()
      }

      await render()
    }

    const selectedBranch = () => getBranchList(branches)[branchIndex]
    const selectedTag = () => tags?.tags[tagIndex]
    const selectedStatusFile = (): WorktreeFile | undefined => worktree?.files[statusIndex]
    const selectedStatusHunk = () => statusHunks?.hunks[statusHunkIndex]
    const selectedStash = (): StashEntry | undefined => stashes?.stashes[stashIndex]
    const selectedWorkspaceWorktree = (): WorktreeEntry | undefined => worktreeList?.worktrees[worktreeIndex]
    const selectedHistoryCommit = (): HistoryCommitRef | undefined => {
      const selected = getSelectedCommit(state)

      return selected
        ? {
          hash: selected.hash,
          shortHash: selected.shortHash,
          message: selected.message,
        }
        : undefined
    }

    const selectedRef = () => {
      if (focus === 'branches') {
        return selectedBranch()?.shortName
      }

      if (focus === 'tags') {
        return selectedTag()?.name
      }

      return getSelectedCommit(state)?.hash
    }

    const selectedBaseRef = () => {
      const branch = focus === 'branches' ? selectedBranch() : undefined

      if (branch?.type === 'remote') {
        return branch.shortName.split('/').slice(1).join('/') || branch.shortName
      }

      if (branch?.type === 'local' && !branch.current) {
        return branch.shortName
      }

      const upstreamDefault = branches?.localBranches
        .find((entry) => entry.upstream)
        ?.upstream
        ?.split('/')
        .slice(1)
        .join('/')

      return upstreamDefault || 'main'
    }

    const generatedPullRequestBody = () => [
      '## Summary',
      '',
      ...state.commits.slice(0, 8).map((commit) => `- ${commit.message}`),
    ].join('\n')

    const moveBranchSelection = (delta: number) => {
      const branchesList = getBranchList(branches)

      branchIndex = Math.max(0, Math.min(branchIndex + delta, branchesList.length - 1))
      pendingDeleteBranch = undefined
      void render()
    }

    const moveTagSelection = (delta: number) => {
      const tagCount = tags?.tags.length || 0

      tagIndex = Math.max(0, Math.min(tagIndex + delta, tagCount - 1))
      pendingDeleteTag = undefined
      pendingDeleteRemoteTag = undefined
      void render()
    }

    const moveStatusSelection = (delta: number) => {
      const fileCount = worktree?.files.length || 0

      statusIndex = Math.max(0, Math.min(statusIndex + delta, fileCount - 1))
      statusHunkIndex = 0
      statusHunks = undefined
      pendingRevertFile = undefined
      pendingRevertHunk = undefined
      void refreshStatusHunks().then(render)
    }

    const moveStatusHunkSelection = (delta: number) => {
      const hunkCount = statusHunks?.hunks.length || 0

      statusHunkIndex = Math.max(0, Math.min(statusHunkIndex + delta, hunkCount - 1))
      void render()
    }

    const moveWorkspaceSelection = (delta: number) => {
      if (workspaceSection === 'stashes') {
        const stashCount = stashes?.stashes.length || 0

        stashIndex = Math.max(0, Math.min(stashIndex + delta, stashCount - 1))
        pendingDropStash = undefined
        stashDiffSummary = undefined
      } else {
        const worktreeCount = worktreeList?.worktrees.length || 0

        worktreeIndex = Math.max(0, Math.min(worktreeIndex + delta, worktreeCount - 1))
        pendingRemoveWorktree = undefined
      }

      void render()
    }

    const toggleWorkspaceSection = () => {
      workspaceSection = workspaceSection === 'stashes' ? 'worktrees' : 'stashes'
      pendingDropStash = undefined
      pendingRemoveWorktree = undefined
      void render()
    }

    const runBranchAction = async (
      action: () => Promise<BranchActionResult>,
      refresh = true,
      runningMessage = 'Running branch action...'
    ) => {
      statusMessage = runningMessage
      await render()
      await setActionResult(await action(), refresh)
    }

    const startInputPrompt = (prompt: LogTuiInputPrompt) => {
      inputPrompt = prompt
      statusMessage = undefined
      statusDetails = undefined
      pendingDeleteBranch = undefined
      pendingDeleteTag = undefined
      pendingDeleteRemoteTag = undefined
      pendingRevertFile = undefined
      pendingRevertHunk = undefined
      pendingDropStash = undefined
      pendingRemoveWorktree = undefined
      pendingCherryPick = undefined
      pendingRevertCommit = undefined
      pendingResetCommit = undefined
      pendingResetMode = undefined
      pendingRebaseCommit = undefined
      pendingOperationAction = undefined
      void render()
    }

    const submitInputPrompt = async () => {
      const prompt = inputPrompt

      if (!prompt) {
        return
      }

      const value = prompt.value.trim()
      inputPrompt = undefined

      if (!value) {
        statusMessage = 'Branch action cancelled: empty value'
        statusDetails = undefined
        await render()
        return
      }

      if (prompt.kind === 'reset-mode' && prompt.commitHash) {
        if (!isResetMode(value)) {
          statusMessage = 'Reset cancelled: mode must be soft, mixed, or hard.'
          statusDetails = undefined
          await render()
          return
        }

        pendingResetCommit = prompt.commitHash
        pendingResetMode = value
        statusMessage = `Press X to confirm reset --${value} to ${prompt.commitHash}`
        statusDetails = [
          'This moves the current branch. Use reflog to recover the previous HEAD.',
        ]
        await render()
      } else if (prompt.kind === 'create-branch') {
        await runBranchAction(() => createBranch(git, value, prompt.sourceRef))
      } else if (prompt.kind === 'rename-branch' && prompt.branchName) {
        await runBranchAction(() => renameBranch(git, prompt.branchName as string, value))
      } else if (prompt.kind === 'create-pr-title' && prompt.baseRef) {
        const head = pullRequest?.currentBranch || branches?.currentBranch

        if (!head) {
          statusMessage = 'Cannot create pull request without a current branch.'
          statusDetails = undefined
          await render()
          return
        }

        await runBranchAction(() => createPullRequest({
          base: prompt.baseRef as string,
          head,
          title: value,
          body: generatedPullRequestBody(),
          draft: pullRequestDraft,
        }))
      } else if (prompt.kind === 'create-tag') {
        await runBranchAction(() => createLightweightTag(git, value, prompt.sourceRef))
      } else if (prompt.kind === 'create-annotated-tag') {
        await runBranchAction(() => createAnnotatedTag(git, value, prompt.sourceRef, `release ${value}`))
      } else if (prompt.kind === 'reword-commit' && prompt.commitHash) {
        await runBranchAction(
          () => rewordHeadCommit(git, prompt.commitHash as string, value),
          true,
          'Rewording HEAD commit...'
        )
      } else if (prompt.kind === 'create-stash') {
        await runBranchAction(() => createStash(git, value), true, 'Creating stash...')
      } else if (prompt.kind === 'create-worktree') {
        await runBranchAction(
          () => createWorktree(git, value, prompt.sourceRef),
          true,
          'Creating worktree...'
        )
      } else if (prompt.kind === 'create-branch-worktree-path') {
        startInputPrompt({
          kind: 'create-branch-worktree-branch',
          label: `New branch for ${value}`,
          value: '',
          sourceRef: prompt.sourceRef,
          worktreePath: value,
        })
      } else if (prompt.kind === 'create-branch-worktree-branch' && prompt.worktreePath) {
        await runBranchAction(
          () => createBranchWorktree(git, prompt.worktreePath as string, value, prompt.sourceRef),
          true,
          'Creating branch worktree...'
        )
      }
    }

    const onPromptKeypress = (sequence: string | undefined, key: readline.Key) => {
      if (!inputPrompt) {
        return
      }

      if (key.name === 'return') {
        void submitInputPrompt()
        return
      }

      if (key.name === 'escape') {
        inputPrompt = undefined
        statusMessage = 'Branch action cancelled'
        statusDetails = undefined
        void render()
        return
      }

      if (key.name === 'backspace') {
        inputPrompt = {
          ...inputPrompt,
          value: inputPrompt.value.slice(0, -1),
        }
        void render()
        return
      }

      if (sequence && sequence.length === 1 && !key.ctrl && !key.meta) {
        inputPrompt = {
          ...inputPrompt,
          value: `${inputPrompt.value}${sequence}`,
        }
        void render()
      }
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

      if (inputPrompt) {
        onPromptKeypress(sequence, key)
        return
      }

      if (state.filterMode) {
        onFilterKeypress(sequence, key)
        return
      }

      if (key.name === 'tab') {
        focus = focus === 'commits'
          ? 'branches'
          : focus === 'branches'
            ? 'tags'
            : focus === 'tags'
              ? 'status'
              : focus === 'status'
                ? 'workspace'
                : 'commits'
        pendingDeleteBranch = undefined
        pendingDeleteTag = undefined
        pendingDeleteRemoteTag = undefined
        pendingRevertFile = undefined
        pendingRevertHunk = undefined
        pendingDropStash = undefined
        pendingRemoveWorktree = undefined
        pendingCherryPick = undefined
        pendingRevertCommit = undefined
        pendingResetCommit = undefined
        pendingResetMode = undefined
        pendingRebaseCommit = undefined
        pendingOperationAction = undefined
        void render()
      } else if ((key.name === 'up' || key.name === 'k') && focus === 'branches') {
        moveBranchSelection(-1)
      } else if ((key.name === 'down' || key.name === 'j') && focus === 'branches') {
        moveBranchSelection(1)
      } else if ((key.name === 'up' || key.name === 'k') && focus === 'tags') {
        moveTagSelection(-1)
      } else if ((key.name === 'down' || key.name === 'j') && focus === 'tags') {
        moveTagSelection(1)
      } else if ((key.name === 'up' || key.name === 'k') && focus === 'status') {
        moveStatusSelection(-1)
      } else if ((key.name === 'down' || key.name === 'j') && focus === 'status') {
        moveStatusSelection(1)
      } else if ((key.name === 'up' || key.name === 'k') && focus === 'workspace') {
        moveWorkspaceSelection(-1)
      } else if ((key.name === 'down' || key.name === 'j') && focus === 'workspace') {
        moveWorkspaceSelection(1)
      } else if ((sequence === '[' || key.name === 'left') && focus === 'workspace') {
        toggleWorkspaceSection()
      } else if ((sequence === ']' || key.name === 'right') && focus === 'workspace') {
        toggleWorkspaceSection()
      } else if ((sequence === '[' || key.name === 'left') && focus === 'status') {
        moveStatusHunkSelection(-1)
      } else if ((sequence === ']' || key.name === 'right') && focus === 'status') {
        moveStatusHunkSelection(1)
      } else if (key.name === 's' && focus === 'workspace') {
        startInputPrompt({
          kind: 'create-stash',
          label: 'Create stash message',
          value: '',
          sourceRef: 'HEAD',
        })
      } else if (key.name === 'a' && focus === 'workspace' && workspaceSection === 'stashes') {
        const stash = selectedStash()

        if (stash) {
          void runBranchAction(() => applyStash(git, stash), true, 'Applying stash...')
        }
      } else if (sequence === 'P' && focus === 'workspace' && workspaceSection === 'stashes') {
        const stash = selectedStash()

        if (stash) {
          void runBranchAction(() => popStash(git, stash), true, 'Popping stash...')
        }
      } else if (key.name === 'd' && focus === 'workspace' && workspaceSection === 'stashes') {
        const stash = selectedStash()

        if (stash) {
          pendingDropStash = stash.ref
          statusMessage = `Press D to confirm dropping ${stash.ref}`
          statusDetails = undefined
          void render()
        }
      } else if (sequence === 'D' && focus === 'workspace' && workspaceSection === 'stashes') {
        const stash = selectedStash()

        if (stash && pendingDropStash === stash.ref) {
          void runBranchAction(() => dropStash(git, stash), true, 'Dropping stash...')
        }
      } else if (key.name === 'i' && focus === 'workspace' && workspaceSection === 'stashes') {
        const stash = selectedStash()

        if (stash) {
          void runBranchAction(async () => {
            stashDiffSummary = await getStashDiffSummary(git, stash.ref)

            return {
              ok: true,
              message: `Inspecting ${stash.ref}`,
            }
          }, false, 'Loading stash diff...')
        }
      } else if (key.name === 'w' && focus === 'workspace') {
        const ref = selectedRef()

        if (ref) {
          startInputPrompt({
            kind: 'create-worktree',
            label: `New worktree path from ${ref}`,
            value: '',
            sourceRef: ref,
          })
        }
      } else if (sequence === 'B' && focus === 'workspace') {
        const ref = selectedRef()

        if (ref) {
          startInputPrompt({
            kind: 'create-branch-worktree-path',
            label: `New branch worktree path from ${ref}`,
            value: '',
            sourceRef: ref,
          })
        }
      } else if (key.name === 'x' && focus === 'workspace' && workspaceSection === 'worktrees') {
        const selectedWorktree = selectedWorkspaceWorktree()

        if (selectedWorktree) {
          pendingRemoveWorktree = selectedWorktree.path
          statusMessage = `Press X to confirm removing ${selectedWorktree.path}`
          statusDetails = undefined
          void render()
        }
      } else if (sequence === 'X' && focus === 'workspace' && workspaceSection === 'worktrees') {
        const selectedWorktree = selectedWorkspaceWorktree()

        if (selectedWorktree && pendingRemoveWorktree === selectedWorktree.path) {
          void runBranchAction(() => removeWorktree(git, selectedWorktree), true, 'Removing worktree...')
        }
      } else if (key.name === 'o' && focus === 'workspace' && workspaceSection === 'worktrees') {
        const selectedWorktree = selectedWorkspaceWorktree()

        if (selectedWorktree) {
          void runBranchAction(() => Promise.resolve(worktreePathAction(selectedWorktree)), false)
        }
      } else if (sequence === 'N') {
        noVerify = !noVerify
        statusMessage = `Commit no-verify mode: ${noVerify ? 'on' : 'off'}`
        statusDetails = noVerify
          ? ['TUI commit actions will pass --no-verify and skip Git hooks.']
          : ['TUI commit actions will run Git hooks.']
        void render()
      } else if (key.name === 'g' && focus === 'commits' && operationOverview && operationOverview.operation !== 'none') {
        pendingOperationAction = 'continue'
        statusMessage = `Press G to continue ${operationOverview?.operation}`
        statusDetails = ['Coco will not continue until you confirm.']
        void render()
      } else if (sequence === 'A' && focus === 'commits' && operationOverview && operationOverview.operation !== 'none') {
        pendingOperationAction = 'abort'
        statusMessage = `Press G to abort ${operationOverview?.operation}`
        statusDetails = ['This asks Git to abort the in-progress operation.']
        void render()
      } else if (sequence === 'K' && focus === 'commits' && operationOverview && operationOverview.operation !== 'none') {
        pendingOperationAction = 'skip'
        statusMessage = `Press G to skip ${operationOverview?.operation}`
        statusDetails = ['Skip is supported by rebase, cherry-pick, and revert operations.']
        void render()
      } else if (sequence === 'G' && focus === 'commits' && pendingOperationAction && operationOverview) {
        const action = pendingOperationAction
        const operation = operationOverview.operation

        void runBranchAction(
          () => action === 'continue'
            ? continueOperation(git, operation)
            : action === 'abort'
              ? abortOperation(git, operation)
              : skipOperation(git, operation),
          true,
          `Running git ${operation} --${action}...`
        )
      } else if (key.name === 'h' && focus === 'commits') {
        void runBranchAction(() => copyCommitHash(selectedHistoryCommit()), false, 'Copying commit hash...')
      } else if (sequence === 'H' && focus === 'commits') {
        void runBranchAction(
          () => copyCommitMessage(selectedHistoryCommit()),
          false,
          'Copying commit message...'
        )
      } else if (sequence === 'O' && focus === 'commits') {
        void runBranchAction(
          () => openCommitOnRemote(git, selectedHistoryCommit()),
          false,
          'Opening selected commit...'
        )
      } else if (sequence === '=' && focus === 'commits') {
        const commit = selectedHistoryCommit()

        if (!compareBase && commit) {
          compareBase = commit
          statusMessage = `Compare base set to ${commit.shortHash}`
          statusDetails = ['Move to another commit and press = again to compare.']
          void render()
        } else if (commit) {
          const base = compareBase
          compareBase = undefined
          void runBranchAction(
            () => compareCommits(git, base, commit),
            false,
            'Comparing selected commits...'
          )
        }
      } else if (key.name === 'y' && focus === 'commits') {
        const commit = selectedHistoryCommit()

        if (commit) {
          pendingCherryPick = commit.hash
          statusMessage = `Press Y to confirm cherry-picking ${commit.shortHash}`
          statusDetails = ['This applies the selected commit onto the current branch.']
          void render()
        }
      } else if (sequence === 'Y' && focus === 'commits') {
        const commit = selectedHistoryCommit()

        if (commit && pendingCherryPick === commit.hash) {
          void runBranchAction(
            () => cherryPickCommit(git, commit),
            true,
            'Cherry-picking selected commit...'
          )
        }
      } else if (sequence === 'V' && focus === 'commits') {
        const commit = selectedHistoryCommit()

        if (commit && pendingRevertCommit === commit.hash) {
          void runBranchAction(
            () => revertCommit(git, commit),
            true,
            'Reverting selected commit...'
          )
        } else if (commit) {
          pendingRevertCommit = commit.hash
          statusMessage = `Press V again to confirm reverting ${commit.shortHash}`
          statusDetails = ['This creates a new commit that reverses the selected commit.']
          void render()
        }
      } else if (sequence === '!' && focus === 'commits') {
        const commit = selectedHistoryCommit()

        if (commit) {
          startInputPrompt({
            kind: 'reset-mode',
            label: `Reset ${commit.shortHash} mode (soft|mixed|hard)`,
            value: 'mixed',
            sourceRef: commit.hash,
            commitHash: commit.hash,
          })
        }
      } else if (sequence === 'X' && focus === 'commits') {
        const commit = selectedHistoryCommit()

        if (commit && pendingResetCommit === commit.hash && pendingResetMode) {
          void runBranchAction(
            () => resetToCommit(git, commit, pendingResetMode as ResetMode),
            true,
            `Resetting current branch --${pendingResetMode}...`
          )
        }
      } else if (sequence === 'B' && focus === 'commits') {
        const commit = selectedHistoryCommit()

        if (commit && pendingRebaseCommit === commit.hash) {
          void runBranchAction(
            () => startInteractiveRebase(git, commit),
            true,
            'Starting interactive rebase...'
          )
        } else if (commit) {
          pendingRebaseCommit = commit.hash
          statusMessage = `Press B again to start interactive rebase from ${commit.shortHash}`
          statusDetails = ['Use `git rebase --abort` if the rebase needs to be cancelled.']
          void render()
        }
      } else if (sequence === 'F' && focus === 'commits') {
        void runBranchAction(async () => {
          reflog = await getReflogEntries(git)

          return {
            ok: true,
            message: 'Loaded reflog recovery view',
          }
        }, false, 'Loading reflog...')
      } else if (key.name === 'return' && focus === 'status') {
        const hunk = selectedStatusHunk()

        if (hunk) {
          void runBranchAction(async () => {
            if (hunk.state === 'staged') {
              await unstageHunk(git, hunk)

              return {
                ok: true,
                message: `Unstaged hunk in ${hunk.filePath}`,
              }
            }

            await stageHunk(git, hunk)

            return {
              ok: true,
              message: `Staged hunk in ${hunk.filePath}`,
            }
          })
        } else {
          statusMessage = 'No selectable hunk for the selected file.'
          statusDetails = undefined
          void render()
        }
      } else if (key.name === 'space' && focus === 'status') {
        const file = selectedStatusFile()

        if (file) {
          void runBranchAction(() => file.state === 'staged' ? unstageFile(git, file) : stageFile(git, file))
        }
      } else if (key.name === 'z' && focus === 'status') {
        const file = selectedStatusFile()
        const hunk = selectedStatusHunk()

        if (hunk) {
          pendingRevertHunk = hunk.id
          pendingRevertFile = undefined
          statusMessage = `Press Z to confirm reverting hunk in ${hunk.filePath}`
          statusDetails = undefined
          void render()
        } else if (file) {
          pendingRevertFile = file.path
          pendingRevertHunk = undefined
          statusMessage = `Press Z to confirm reverting ${file.path}`
          statusDetails = undefined
          void render()
        }
      } else if (sequence === 'Z' && focus === 'status') {
        const file = selectedStatusFile()
        const hunk = selectedStatusHunk()

        if (hunk && pendingRevertHunk === hunk.id) {
          void runBranchAction(async () => {
            await revertHunk(git, hunk)

            return {
              ok: true,
              message: `Reverted hunk in ${hunk.filePath}`,
            }
          })
        } else if (file && pendingRevertFile === file.path) {
          void runBranchAction(() => revertFile(git, file))
        }
      } else if (key.name === 'c' && focus === 'status') {
        void runBranchAction(
          () => runCommitWorkflow({ action: 'commit', git, noVerify }),
          true,
          'Generating commit message...'
        )
      } else if (sequence === 'S' && focus === 'status') {
        void runBranchAction(
          () => runCommitWorkflow({ action: 'split-plan', git, noVerify }),
          true,
          'Generating commit split plan...'
        )
      } else if (sequence === 'A' && focus === 'status') {
        void runBranchAction(
          () => runCommitWorkflow({ action: 'split-apply', git, noVerify }),
          true,
          'Applying commit split plan...'
        )
      } else if (key.name === 'e') {
        const selected = getSelectedCommit(state)

        void runBranchAction(
          () => amendHeadCommit(git, selected?.hash),
          true,
          'Amending HEAD commit...'
        )
      } else if (key.name === 'w') {
        const selected = getSelectedCommit(state)

        if (selected) {
          startInputPrompt({
            kind: 'reword-commit',
            label: 'Reword HEAD',
            value: selected.message,
            sourceRef: selected.hash,
            commitHash: selected.hash,
          })
        }
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
          await Promise.all([
            refreshBranches(),
            refreshPullRequest(),
            refreshTags(),
            refreshWorktree(),
            refreshStashes(),
            refreshWorktreeList(),
          ])
          await refreshStatusHunks()

          return {
            ok: true,
          message: 'Refreshed Git overview',
          }
        }, false)
      } else if (key.name === 'n') {
        const ref = selectedRef()

        if (ref) {
          startInputPrompt({
            kind: 'create-branch',
            label: `New branch from ${ref}`,
            value: '',
            sourceRef: ref,
          })
        }
      } else if (key.name === 'm' && focus === 'branches') {
        const branch = selectedBranch()

        if (branch?.type === 'local') {
          startInputPrompt({
            kind: 'rename-branch',
            label: `Rename ${branch.shortName} to`,
            value: branch.shortName,
            sourceRef: branch.shortName,
            branchName: branch.shortName,
          })
        } else {
          statusMessage = 'Only local branches can be renamed.'
          statusDetails = undefined
          void render()
        }
      } else if (key.name === 'u' && focus === 'branches') {
        const branch = selectedBranch()
        const current = branches?.localBranches.find((entry) => entry.current)

        if (branch?.type === 'remote' && current) {
          void runBranchAction(() => setUpstream(git, current.shortName, branch.shortName))
        } else {
          statusMessage = 'Select a remote branch to set as the current branch upstream.'
          statusDetails = undefined
          void render()
        }
      } else if (key.name === 't') {
        const target = selectedRef()

        if (target) {
          startInputPrompt({
            kind: 'create-tag',
            label: `Create tag at ${target}`,
            value: '',
            sourceRef: target,
          })
        }
      } else if (key.name === 'a') {
        const target = selectedRef()

        if (target) {
          startInputPrompt({
            kind: 'create-annotated-tag',
            label: `Create annotated tag at ${target}`,
            value: '',
            sourceRef: target,
          })
        }
      } else if (key.name === 's' && focus === 'tags') {
        const tag = selectedTag()

        if (tag) {
          void runBranchAction(() => pushTag(git, tag.name))
        }
      } else if (key.name === 'x' && focus === 'tags') {
        const tag = selectedTag()

        if (tag) {
          pendingDeleteTag = tag.name
          statusMessage = `Press X to confirm deleting local tag ${tag.name}`
          void render()
        }
      } else if (sequence === 'X' && focus === 'tags') {
        const tag = selectedTag()

        if (tag && pendingDeleteTag === tag.name) {
          void runBranchAction(() => deleteLocalTag(git, tag.name))
        }
      } else if (key.name === 'y' && focus === 'tags') {
        const tag = selectedTag()

        if (tag) {
          pendingDeleteRemoteTag = tag.name
          statusMessage = `Press Y to confirm deleting remote tag ${tag.name}`
          void render()
        }
      } else if (sequence === 'Y' && focus === 'tags') {
        const tag = selectedTag()

        if (tag && pendingDeleteRemoteTag === tag.name) {
          void runBranchAction(() => deleteRemoteTag(git, tag.name))
        }
      } else if (sequence === 'R' && focus === 'tags') {
        const tag = selectedTag()

        if (tag) {
          void runBranchAction(async () => {
            tagRangeSummary = await getTagRangeSummary(git, tag.name)

            return {
              ok: true,
              message: `Compared ${tag.name}..HEAD`,
            }
          }, false)
        }
      } else if (sequence === 'C') {
        const baseRef = selectedBaseRef()
        const title = getSelectedCommit(state)?.message || `Open ${pullRequest?.currentBranch || 'branch'}`

        startInputPrompt({
          kind: 'create-pr-title',
          label: `Create ${pullRequestDraft ? 'draft ' : ''}PR into ${baseRef}`,
          value: title,
          sourceRef: pullRequest?.currentBranch || branches?.currentBranch || '',
          baseRef,
        })
      } else if (key.name === 'v') {
        pullRequestDraft = !pullRequestDraft
        statusMessage = `Pull request create mode: ${pullRequestDraft ? 'draft' : 'ready'}`
        statusDetails = undefined
        void render()
      } else if (key.name === 'o') {
        const url = pullRequest?.currentPullRequest?.url

        if (url) {
          void runBranchAction(() => openPullRequest(url), false)
        } else {
          statusMessage = 'No current pull request to open.'
          statusDetails = undefined
          void render()
        }
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
    void Promise.all([
      refreshBranches(),
      refreshPullRequest(),
      refreshTags(),
      refreshWorktree(),
      refreshStashes(),
      refreshWorktreeList(),
      refreshOperationOverview(),
    ])
      .then(async () => {
        await refreshStatusHunks()
        await render()
      })
      .catch(() => {
        branches = undefined
        pullRequest = undefined
        tags = undefined
        worktree = undefined
        statusHunks = undefined
        stashes = undefined
        worktreeList = undefined
        operationOverview = undefined
      })
    void render()
  })
}
