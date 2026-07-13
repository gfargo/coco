import { SimpleGit } from 'simple-git'
import { LogAiAction, LogAiActionImpact } from '../../git/aiActions'
import { BranchOverview, BranchRef, getBranchOverview } from '../../git/branchData'
import { GitCommitDetail, GitLogRow, getCommitDetail } from '../../git/logData'
import { HistoryCommitRef, ReflogEntry, ResetMode } from '../../git/historyActions'
import { type PullRequestOverview } from '../../git/pullRequestData'
import { getForgePullRequestOverview } from '../../git/forgeActions'
import { StashOverview, getStashOverview } from '../../git/stashData'
import { WorktreeOverview, getWorktreeOverview } from '../../git/statusData'
import { WorktreeHunkOverview } from '../../git/statusHunks'
import { TagOverview, TagRangeSummary, getTagOverview } from '../../git/tagData'
import {
  WorktreeOverview as WorktreeListOverview,
  getWorktreeListOverview,
} from '../../git/worktreeData'
import { LogTuiState, createLogTuiState, getSelectedCommit } from './interactiveState'
import { GitOperationOverview, getGitOperationOverview } from '../../git/operationData'
import { ProviderOverview, getProviderOverview } from '../../git/providerData'

type LogTuiStreams = {
  appLabel?: string
  input?: NodeJS.ReadStream
  output?: NodeJS.WriteStream
}

type RenderInteractiveLogOptions = {
  appLabel?: string
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
  providerCompareBase?: string
}

type RenderInteractiveLogAi = {
  pendingAction?: LogAiAction
  impact?: LogAiActionImpact
  draft?: string
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
  pendingAiAction?: LogAiAction
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

function renderProviderOverview(
  overview: ProviderOverview | undefined,
  history: RenderInteractiveLogHistory,
  width: number
): string[] {
  if (!overview) {
    return ['Provider: unavailable']
  }

  const repository = overview.repository
  const repoName = repository.owner && repository.name
    ? `${repository.owner}/${repository.name}`
    : repository.message || 'unsupported remote'

  if (repository.provider === 'unsupported' || !repository.webUrl) {
    return [
      `Provider: ${repoName} | ${overview.message || repository.message || 'unsupported remote'}`,
    ].map((line) => truncate(line, width))
  }

  const defaultBranch = repository.defaultBranch || '<unknown>'
  const auth = overview.authenticated ? 'authenticated' : 'offline'
  const pr = overview.currentPullRequest
  const checks = pr?.statusCheckRollup?.length
    ? pr.statusCheckRollup
      .slice(0, 3)
      .map((check) => `${check.name}:${check.conclusion || check.status || 'pending'}`)
      .join(', ')
    : undefined
  const prLine = pr
    ? `Provider PR: #${pr.number} ${pr.state}${pr.isDraft ? ' draft' : ''} review ${pr.reviewDecision || '<unknown>'}`
    : `Provider PR: ${overview.message || 'none for current branch'}`
  const compareLine = history.providerCompareBase
    ? `Provider compare base: ${history.providerCompareBase}`
    : 'Provider compare: press U on a ref, then U on another ref'

  return [
    `Provider: ${repository.provider} ${repoName} | default ${defaultBranch} | ${auth}`,
    repository.webUrl ? `Repository: ${repository.webUrl}` : `Provider fallback: ${overview.message || repository.message || 'unsupported'}`,
    prLine,
    checks ? `Checks: ${checks}` : 'Checks: unavailable',
    compareLine,
    'Provider actions: R repo | L branch | O commit | U compare | o PR',
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

function renderAiOverview(
  ai: RenderInteractiveLogAi,
  width: number
): string[] {
  if (!ai.pendingAction && !ai.draft) {
    return []
  }

  const impact = ai.impact
  const pendingLine = ai.pendingAction && impact
    ? `Pending AI ${impact.label}: press ${ai.pendingAction === 'summarize-range' ? 'M' : ai.pendingAction === 'release-notes' ? 'J' : ai.pendingAction === 'risk-review' ? 'W' : 'I'} to run | ~${impact.estimatedTokens} tokens${impact.large ? ' large' : ''}`
    : 'AI actions: I commit summary | M range summary | J release notes | W risk review'
  const draftLines = ai.draft
    ? ai.draft.split('\n').slice(0, 4).map((line) => `  ${line}`)
    : []

  return [
    'Coco AI:',
    pendingLine,
    'AI calls are opt-in; large actions show token awareness before running.',
    ...(draftLines.length ? ['AI draft:', ...draftLines] : []),
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
  operation?: GitOperationOverview,
  provider?: ProviderOverview,
  ai: RenderInteractiveLogAi = {}
): string {
  const height = options.height || process.stdout.rows || DEFAULT_HEIGHT
  const width = options.width || process.stdout.columns || DEFAULT_WIDTH
  const selected = getSelectedCommit(state)
  const filter = state.filter ? state.filter : '<none>'
  const graphMode = state.fullGraph ? 'full graph' : 'compact graph'
  const focus = ui.focus || 'commits'
  const help = state.showHelp
    ? 'Keys: tab focus | up/down move | n branch | t tag | C PR | c commit | AI I/M/J/W | q quit'
    : 'Press ? for help'
  const commitActions = focus === 'commits'
    ? 'Commit actions: e amend HEAD | w reword HEAD | h hash | H message | O open | = compare'
    : ''
  const detailHeader = selected
    ? `Selected: ${selected.shortHash} ${selected.message}`
    : 'Selected: none'
  const branchLines = renderBranchOverview(branches, ui, width).slice(0, 12)
  const pullRequestLines = renderPullRequestOverview(pullRequest, ui, width).slice(0, 4)
  const providerLines = renderProviderOverview(provider, history, width).slice(0, 6)
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
  const aiLines = renderAiOverview(ai, width).slice(0, 8)
  const listHeight = Math.max(4, Math.floor(height * 0.35))
  const detailHeight = Math.max(
    6,
    height -
      listHeight -
      branchLines.length -
      pullRequestLines.length -
      providerLines.length -
      tagLines.length -
      statusLines.length -
      workspaceLines.length -
      historyLines.length -
      operationLines.length -
      aiLines.length -
      11
  )
  const detailLines = renderDetail(detail, width).slice(0, detailHeight)
  const filterPrompt = state.filterMode ? `Search: ${state.filter}_` : `Filter: ${filter}`

  return [
    options.appLabel || 'coco log',
    `${state.filteredCommits.length}/${state.commits.length} commits | Focus: ${focus} | ${filterPrompt} | ${graphMode}`,
    help,
    commitActions,
    ui.statusMessage ? truncate(`Status: ${ui.statusMessage}`, width) : '',
    ...(ui.statusDetails || []).slice(0, 4).map((line) => truncate(`  ${line}`, width)),
    ui.inputPrompt ? truncate(`${ui.inputPrompt.label}: ${ui.inputPrompt.value}_`, width) : '',
    '',
    ...branchLines,
    ...pullRequestLines,
    ...providerLines,
    ...tagLines,
    ...statusLines,
    ...workspaceLines,
    ...historyLines,
    ...operationLines,
    ...aiLines,
    '',
    ...renderCommitList(state, listHeight, width),
    '',
    truncate(detailHeader, width),
    '-'.repeat(Math.min(width, 80)),
    ...detailLines,
  ].join('\n')
}

/**
 * Non-TTY snapshot fallback for `coco log --interactive` / `coco ui`. The
 * TTY-interactive path is owned by the Ink runtime in `inkRuntime.ts`; this
 * function exists so piped / CI invocations still produce a usable static
 * dump. Fetches the same overview data the live workstation seeds with,
 * renders one frame via `renderInteractiveLog`, and exits.
 */
export async function startInteractiveLog(
  git: SimpleGit,
  rows: GitLogRow[],
  streams: LogTuiStreams = {}
): Promise<void> {
  const output = streams.output || process.stdout
  const appLabel = streams.appLabel
  const state = createLogTuiState(rows)
  const details = new Map<string, GitCommitDetail>()

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

  let branches: BranchOverview | undefined
  let pullRequest: PullRequestOverview | undefined
  let tags: TagOverview | undefined
  let worktree: WorktreeOverview | undefined
  let stashes: StashOverview | undefined
  let worktreeList: WorktreeListOverview | undefined
  let operationOverview: GitOperationOverview | undefined
  let providerOverview: ProviderOverview | undefined

  try {
    [
      branches,
      pullRequest,
      tags,
      worktree,
      stashes,
      worktreeList,
      operationOverview,
      providerOverview,
    ] = await Promise.all([
      getBranchOverview(git),
      getForgePullRequestOverview(git),
      getTagOverview(git),
      getWorktreeOverview(git),
      getStashOverview(git),
      getWorktreeListOverview(git),
      getGitOperationOverview(git),
      getProviderOverview(git),
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
      undefined,
      worktree,
      {},
      { appLabel },
      { stashes, worktreeList },
      {},
      operationOverview,
      providerOverview
    )}\n`,
    'utf8'
  )
}
