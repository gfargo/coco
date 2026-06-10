import { SimpleGit } from 'simple-git'
import { describeGlabStatus, getGitLabProject, getGlabStatus, type GlabRunner, defaultGlabRunner } from './glabCli'
import type {
  IssueListFilter,
  IssueListItem,
  IssueListOverview,
} from './issuesListData'
import type {
  PullRequestListFilter,
  PullRequestListItem,
  PullRequestListOverview,
} from './pullRequestListData'
import type { PullRequestInfo, PullRequestOverview } from './pullRequestData'

/**
 * GitLab list loaders. These produce the SAME overview shapes as the GitHub
 * loaders (`PullRequestListOverview` / `IssueListOverview`) so the triage
 * surfaces and command handlers consume them identically — only the transport
 * (glab) and field mapping differ.
 *
 * Data is fetched through `glab api`, which proxies the documented GitLab REST
 * API (auth + host inferred from the repo remote). Using the REST passthrough
 * rather than `glab mr list` keeps us on a stable, well-specified JSON shape
 * instead of glab's presentation-layer output.
 */

/** Percent-encode the project path for the GitLab REST `projects/:id` segment. */
function encodeProjectPath(path: string): string {
  return encodeURIComponent(path)
}

/** Map a GitLab MR/issue `state` to coco's uppercased state vocabulary. */
function normalizeState(raw: unknown): string {
  const s = String(raw || '').toLowerCase()
  if (s === 'opened') return 'OPEN'
  if (s === 'closed') return 'CLOSED'
  if (s === 'merged') return 'MERGED'
  if (s === 'locked') return 'LOCKED'
  return s.toUpperCase()
}

function usernamesOf(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const names = value
    .map((entry) =>
      entry && typeof entry === 'object' && 'username' in entry
        ? String((entry as { username: unknown }).username)
        : ''
    )
    .filter(Boolean)
  return names.length ? names : undefined
}

function usernameOf(value: unknown): string | undefined {
  return value && typeof value === 'object' && 'username' in value
    ? String((value as { username: unknown }).username)
    : undefined
}

function stringLabels(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  // GitLab REST returns labels as a flat string[]; tolerate object form too.
  const labels = value
    .map((l) => (typeof l === 'string' ? l : l && typeof l === 'object' && 'name' in l ? String((l as { name: unknown }).name) : ''))
    .filter(Boolean)
  return labels.length ? labels : undefined
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const pairs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
  return pairs.length ? `?${pairs.join('&')}` : ''
}

// ---------------------------------------------------------------------------
// Merge requests
// ---------------------------------------------------------------------------

function mrStateParam(state: PullRequestListFilter['state']): string | undefined {
  if (!state || state === 'all') return state === 'all' ? 'all' : undefined
  if (state === 'open') return 'opened'
  return state // 'closed' | 'merged'
}

function parseMergeRequests(output: string): PullRequestListItem[] {
  const trimmed = output.trim()
  if (!trimmed) return []
  const raw = JSON.parse(trimmed) as Array<Record<string, unknown>>
  return raw.map((mr) => ({
    number: Number(mr.iid),
    title: String(mr.title || ''),
    url: String(mr.web_url || ''),
    state: normalizeState(mr.state),
    isDraft: Boolean(mr.draft ?? mr.work_in_progress),
    headRefName: String(mr.source_branch || ''),
    baseRefName: String(mr.target_branch || ''),
    author: usernameOf(mr.author),
    assignees: usernamesOf(mr.assignees),
    labels: stringLabels(mr.labels),
    reviewDecision: undefined,
    mergeable: typeof mr.merge_status === 'string' ? mr.merge_status : undefined,
    mergeStateStatus:
      typeof mr.detailed_merge_status === 'string' ? mr.detailed_merge_status : undefined,
    createdAt: String(mr.created_at || ''),
    updatedAt: String(mr.updated_at || ''),
  }))
}

function buildMergeRequestEndpoint(path: string, filter: PullRequestListFilter): string {
  const query = buildQuery({
    state: mrStateParam(filter.state),
    author_username: filter.author,
    assignee_username: filter.assignee,
    labels: filter.label,
    search: filter.search,
    source_branch: filter.head,
    target_branch: filter.base,
    per_page: filter.limit ?? 30,
  })
  return `projects/${encodeProjectPath(path)}/merge_requests${query}`
}

export async function getMergeRequestList(
  git: SimpleGit,
  filter: PullRequestListFilter = {},
  runner: GlabRunner = defaultGlabRunner
): Promise<PullRequestListOverview> {
  const project = await getGitLabProject(git)
  if (!project) {
    return { available: false, authenticated: false, filter, message: 'No GitLab remote detected.' }
  }

  const status = await getGlabStatus(runner)
  if (status.kind !== 'ok') {
    return {
      available: true,
      authenticated: false,
      repository: { owner: project.owner, name: project.name },
      filter,
      message: describeGlabStatus(status),
    }
  }

  try {
    const output = await runner(['api', buildMergeRequestEndpoint(project.path, filter)])
    let pullRequests = parseMergeRequests(output)
    // The REST API has no stable cross-version "draft only" filter; apply it
    // client-side so `--draft` behaves the same as on GitHub.
    if (filter.draft) pullRequests = pullRequests.filter((mr) => mr.isDraft)
    return {
      available: true,
      authenticated: true,
      repository: { owner: project.owner, name: project.name },
      filter,
      pullRequests,
    }
  } catch (error) {
    return {
      available: true,
      authenticated: true,
      repository: { owner: project.owner, name: project.name },
      filter,
      message: error instanceof Error ? error.message : 'Failed to fetch merge request list.',
    }
  }
}

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

function issueStateParam(state: IssueListFilter['state']): string | undefined {
  // The GitLab issues API supports only opened/closed; omitting state returns
  // everything, so `all` (and unset) maps to no param. (MRs differ — their API
  // does accept state=all, handled by mrStateParam.)
  if (state === 'open') return 'opened'
  if (state === 'closed') return 'closed'
  return undefined
}

function parseIssues(output: string): IssueListItem[] {
  const trimmed = output.trim()
  if (!trimmed) return []
  const raw = JSON.parse(trimmed) as Array<Record<string, unknown>>
  return raw.map((issue) => ({
    number: Number(issue.iid),
    title: String(issue.title || ''),
    url: String(issue.web_url || ''),
    state: normalizeState(issue.state),
    author: usernameOf(issue.author),
    assignees: usernamesOf(issue.assignees),
    labels: stringLabels(issue.labels),
    comments: typeof issue.user_notes_count === 'number' ? issue.user_notes_count : undefined,
    createdAt: String(issue.created_at || ''),
    updatedAt: String(issue.updated_at || ''),
  }))
}

function buildIssueEndpoint(path: string, filter: IssueListFilter): string {
  const query = buildQuery({
    state: issueStateParam(filter.state),
    author_username: filter.author,
    assignee_username: filter.assignee,
    labels: filter.label,
    search: filter.search,
    per_page: filter.limit ?? 30,
  })
  return `projects/${encodeProjectPath(path)}/issues${query}`
}

export async function getGitLabIssueList(
  git: SimpleGit,
  filter: IssueListFilter = {},
  runner: GlabRunner = defaultGlabRunner
): Promise<IssueListOverview> {
  const project = await getGitLabProject(git)
  if (!project) {
    return { available: false, authenticated: false, filter, message: 'No GitLab remote detected.' }
  }

  const status = await getGlabStatus(runner)
  if (status.kind !== 'ok') {
    return {
      available: true,
      authenticated: false,
      repository: { owner: project.owner, name: project.name },
      filter,
      message: describeGlabStatus(status),
    }
  }

  try {
    const output = await runner(['api', buildIssueEndpoint(project.path, filter)])
    return {
      available: true,
      authenticated: true,
      repository: { owner: project.owner, name: project.name },
      filter,
      issues: parseIssues(output),
    }
  } catch (error) {
    return {
      available: true,
      authenticated: true,
      repository: { owner: project.owner, name: project.name },
      filter,
      message: error instanceof Error ? error.message : 'Failed to fetch issue list.',
    }
  }
}

// ---------------------------------------------------------------------------
// Current-branch merge request (single-PR surface parity)
// ---------------------------------------------------------------------------

function mrToPullRequestInfo(mr: Record<string, unknown>): PullRequestInfo {
  return {
    number: Number(mr.iid),
    title: String(mr.title || ''),
    url: String(mr.web_url || ''),
    state: normalizeState(mr.state),
    isDraft: Boolean(mr.draft ?? mr.work_in_progress),
    headRefName: String(mr.source_branch || ''),
    baseRefName: String(mr.target_branch || ''),
    body: typeof mr.description === 'string' ? mr.description : undefined,
    author: usernameOf(mr.author),
    reviewDecision: undefined,
    mergeable: typeof mr.merge_status === 'string' ? mr.merge_status : undefined,
    mergeStateStatus:
      typeof mr.detailed_merge_status === 'string' ? mr.detailed_merge_status : undefined,
    statusCheckRollup: undefined,
    reviews: undefined,
  }
}

/**
 * Current-branch merge-request overview — the glab counterpart to
 * `getPullRequestOverview`, for the single-PR (`g p`) surface. Resolves the open
 * MR whose source branch is the checked-out branch and maps it to the shared
 * `PullRequestOverview` shape.
 */
export async function getMergeRequestOverview(
  git: SimpleGit,
  runner: GlabRunner = defaultGlabRunner
): Promise<PullRequestOverview> {
  const [project, branchOut] = await Promise.all([
    getGitLabProject(git),
    git.raw(['branch', '--show-current']),
  ])
  const currentBranch = branchOut.trim() || undefined

  if (!project) {
    return { available: false, authenticated: false, currentBranch, message: 'No GitLab remote detected.' }
  }

  const repository = { owner: project.owner, name: project.name }

  const status = await getGlabStatus(runner)
  if (status.kind !== 'ok') {
    return { available: true, authenticated: false, repository, currentBranch, message: describeGlabStatus(status) }
  }

  if (!currentBranch) {
    return { available: true, authenticated: true, repository, message: 'No current branch.' }
  }

  try {
    const endpoint = `projects/${encodeProjectPath(project.path)}/merge_requests?source_branch=${encodeURIComponent(currentBranch)}&state=opened`
    const out = (await runner(['api', endpoint])).trim()
    const mr = (out ? (JSON.parse(out) as Array<Record<string, unknown>>) : [])[0]
    return {
      available: true,
      authenticated: true,
      repository,
      currentBranch,
      currentPullRequest: mr ? mrToPullRequestInfo(mr) : undefined,
      ...(mr ? {} : { message: `No merge request found for ${currentBranch}.` }),
    }
  } catch (error) {
    return {
      available: true,
      authenticated: true,
      repository,
      currentBranch,
      message: error instanceof Error ? error.message : `No merge request found for ${currentBranch}.`,
    }
  }
}

// Exported for unit tests (endpoint construction + state mapping).
export const __test = {
  buildMergeRequestEndpoint,
  buildIssueEndpoint,
  parseMergeRequests,
  parseIssues,
  normalizeState,
}
