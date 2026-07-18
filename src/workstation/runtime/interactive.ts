import { SimpleGit } from 'simple-git'
import { BranchOverview, BranchRef, getBranchOverview } from '../../git/branchData'
import { GitCommitDetail, GitLogRow, getCommitDetail } from '../../git/logData'
import { type PullRequestOverview } from '../../git/pullRequestData'
import { getForgePullRequestOverview } from '../../git/forgeActions'
import { StashOverview, getStashOverview } from '../../git/stashData'
import { WorktreeOverview, getWorktreeOverview } from '../../git/statusData'
import { TagOverview, getTagOverview } from '../../git/tagData'
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

function renderBranchOverview(
  overview: BranchOverview | undefined,
  width: number
): string[] {
  if (!overview) {
    return ['Branches: unavailable']
  }

  const dirty = overview.dirty ? 'dirty worktree' : 'clean worktree'
  const current = overview.localBranches.find((branch) => branch.current)
  const localBranches = overview.localBranches
    .slice(0, 6)
    .map((branch) => `  ${branch.current ? '*' : ' '} ${branch.shortName} ${formatDivergence(branch)}`)
  const remoteBranches = overview.remoteBranches
    .slice(0, 6)
    .map((branch) => `    ${branch.shortName}`)
  const hiddenLocal = overview.localBranches.length > localBranches.length
    ? [`  ... ${overview.localBranches.length - localBranches.length} more local branch(es)`]
    : []
  const hiddenRemote = overview.remoteBranches.length > remoteBranches.length
    ? [`  ... ${overview.remoteBranches.length - remoteBranches.length} more remote branch(es)`]
    : []

  return [
    `Branches: ${overview.currentBranch || '<detached>'} | ${dirty}`,
    current ? `Upstream: ${formatDivergence(current)}` : 'Upstream: none',
    'Branch actions: tab focus | enter checkout/track | f fetch | p push | P pull | d delete',
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
  const action = 'PR actions: C create | v draft toggle | o open current PR'

  if (!overview.currentPullRequest) {
    return [
      `Pull request: no PR for ${overview.currentBranch || '<detached>'} on ${repo}`,
      'Create mode: ready',
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

  return [
    `Provider: ${repository.provider} ${repoName} | default ${defaultBranch} | ${auth}`,
    repository.webUrl ? `Repository: ${repository.webUrl}` : `Provider fallback: ${overview.message || repository.message || 'unsupported'}`,
    prLine,
    checks ? `Checks: ${checks}` : 'Checks: unavailable',
    'Provider compare: press U on a ref, then U on another ref',
    'Provider actions: R repo | L branch | O commit | U compare | o PR',
  ].map((line) => truncate(line, width))
}

function renderTagOverview(
  overview: TagOverview | undefined,
  width: number
): string[] {
  if (!overview) {
    return ['Tags: unavailable']
  }

  const tags = overview.tags.slice(0, 6).map((tag) => (
    `  ${tag.name} ${tag.date} ${tag.hash} ${tag.subject}`
  ))
  const hiddenTags = overview.tags.length > tags.length
    ? [`  ... ${overview.tags.length - tags.length} more tag(s)`]
    : []

  return [
    'Tags:',
    ...(tags.length ? tags : ['  No tags found.']),
    ...hiddenTags,
    'Tag actions: t tag | a annotated | s push | x delete local | y delete remote | R range',
    'Range: select a tag and press R to compare with HEAD',
  ].map((line) => truncate(line, width))
}

function renderStatusOverview(
  overview: WorktreeOverview | undefined,
  width: number
): string[] {
  if (!overview) {
    return ['Status: unavailable']
  }

  const files = overview.files.slice(0, 8).map((file) => (
    `  ${file.indexStatus}${file.worktreeStatus} ${file.path}`
  ))
  const hiddenFiles = overview.files.length > files.length
    ? [`  ... ${overview.files.length - files.length} more file(s)`]
    : []

  return [
    `Status: ${overview.stagedCount} staged, ${overview.unstagedCount} unstaged, ${overview.untrackedCount} untracked`,
    ...(files.length ? files : ['  Worktree clean.']),
    ...hiddenFiles,
    'Status actions: space file | enter hunk | [/] hunk select | c commit | S split plan | A split apply | z revert',
  ].map((line) => truncate(line, width))
}

function renderWorkspaceOverview(
  stashes: StashOverview | undefined,
  worktrees: WorktreeListOverview | undefined,
  width: number
): string[] {
  const stashLines = stashes?.stashes.slice(0, 4).map((stash) => {
    const files = stash.files.length ? ` ${stash.files.length} file(s)` : ''

    return `  ${stash.ref} ${stash.branch}: ${stash.message}${files}`
  }) || []
  const worktreeLines = worktrees?.worktrees.slice(0, 4).map((worktree) => {
    const marker = worktree.current ? '*' : ' '
    const branch = worktree.branch || (worktree.detached ? '<detached>' : '<unknown>')
    const dirty = worktree.dirty ? 'dirty' : 'clean'

    return `  ${marker} ${branch} ${dirty} ${worktree.path}`
  }) || []

  return [
    'Workspace: stashes',
    'Stashes:',
    ...(stashLines.length ? stashLines : ['  No stashes found.']),
    'Worktrees:',
    ...(worktreeLines.length ? worktreeLines : ['  No linked worktrees found.']),
    'Workspace actions: [/] section | s stash | a apply | P pop | d drop | i inspect | w worktree | B branch+worktree | x remove | o path',
  ].map((line) => truncate(line, width))
}

function renderHistoryOverview(width: number): string[] {
  return [
    'History:',
    'History actions: h hash | H message | O open | = compare | y cherry-pick | V revert | ! reset | B rebase | F reflog',
    'Compare: press = on a commit, then = on another commit',
  ].map((line) => truncate(line, width))
}

function renderOperationOverview(
  overview: GitOperationOverview | undefined,
  width: number
): string[] {
  if (!overview) {
    return ['Operation: unavailable']
  }

  if (overview.operation === 'none' && overview.conflictedFiles.length === 0) {
    return [
      'Operation: none | no-verify off',
      'Operation actions: none active | N no-verify',
    ].map((line) => truncate(line, width))
  }

  const operation = overview.operation === 'none' ? 'none' : `${overview.operation} in progress`
  const actionLine = overview.operation === 'none'
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
    `Operation: ${operation} | no-verify off`,
    actionLine,
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
  worktree?: WorktreeOverview,
  options: RenderInteractiveLogOptions = {},
  workspace: RenderInteractiveLogWorkspace = {},
  operation?: GitOperationOverview,
  provider?: ProviderOverview
): string {
  const height = options.height || process.stdout.rows || DEFAULT_HEIGHT
  const width = options.width || process.stdout.columns || DEFAULT_WIDTH
  const selected = getSelectedCommit(state)
  const filter = state.filter ? state.filter : '<none>'
  const graphMode = state.fullGraph ? 'full graph' : 'compact graph'
  const help = state.showHelp
    ? 'Keys: tab focus | up/down move | n branch | t tag | C PR | c commit | AI I/M/J/W | q quit'
    : 'Press ? for help'
  const commitActions = 'Commit actions: e amend HEAD | w reword HEAD | h hash | H message | O open | = compare'
  const detailHeader = selected
    ? `Selected: ${selected.shortHash} ${selected.message}`
    : 'Selected: none'
  const branchLines = renderBranchOverview(branches, width).slice(0, 12)
  const pullRequestLines = renderPullRequestOverview(pullRequest, width).slice(0, 4)
  const providerLines = renderProviderOverview(provider, width).slice(0, 6)
  const tagLines = renderTagOverview(tags, width).slice(0, 10)
  const statusLines = renderStatusOverview(worktree, width).slice(0, 10)
  const workspaceLines = workspace.stashes || workspace.worktreeList
    ? renderWorkspaceOverview(workspace.stashes, workspace.worktreeList, width).slice(0, 12)
    : []
  const historyLines = renderHistoryOverview(width).slice(0, 8)
  const operationLines = renderOperationOverview(operation, width).slice(0, 12)
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
      10
  )
  const detailLines = renderDetail(detail, width).slice(0, detailHeight)
  const filterPrompt = state.filterMode ? `Search: ${state.filter}_` : `Filter: ${filter}`

  return [
    options.appLabel || 'coco log',
    `${state.filteredCommits.length}/${state.commits.length} commits | Focus: commits | ${filterPrompt} | ${graphMode}`,
    help,
    commitActions,
    '',
    ...branchLines,
    ...pullRequestLines,
    ...providerLines,
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
      worktree,
      { appLabel },
      { stashes, worktreeList },
      operationOverview,
      providerOverview
    )}\n`,
    'utf8'
  )
}
