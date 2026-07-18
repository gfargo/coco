import { SimpleGit } from 'simple-git'
import { describeGlabStatus, getGitLabProject, getGlabStatus, type GlabRunner, defaultGlabRunner } from './glabCli'
import { loadForgeList, loadForgeOverview } from './forgeLoad'
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
import {
  sanitizeIssueListItem,
  sanitizePullRequestInfo,
  sanitizePullRequestListItem,
} from './forgeText'

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

/**
 * Build a clear error from a non-array `glab api` response. GitLab returns a
 * JSON object like `{ "message": "404 Not Found" }` on errors (not an array),
 * so without this the list parsers would throw a cryptic "raw.map is not a
 * function" instead of surfacing the real API message.
 */
function gitlabListError(raw: unknown, resource: string): Error {
  const detail =
    raw && typeof raw === 'object'
      ? String(
          (raw as Record<string, unknown>).message ??
            (raw as Record<string, unknown>).error ??
            ''
        )
      : ''
  return new Error(
    detail
      ? `GitLab API error fetching ${resource}: ${detail}`
      : `Unexpected GitLab API response while fetching ${resource}.`
  )
}

/**
 * Fetch up to `want` rows from a paginated `glab api` list endpoint. GitLab
 * caps `per_page` at 100, so a single request silently truncates large result
 * sets; page through (`per_page` is baked into `baseEndpoint`) until we have
 * `want` rows or reach the last page. Mirrors how `gh` paginates internally so
 * `--limit N` behaves the same on both forges. The `page <= 100` ceiling is a
 * safety stop against a misbehaving API.
 */
async function fetchAllPages<T>(
  runner: GlabRunner,
  baseEndpoint: string,
  parse: (output: string) => T[],
  want: number,
  perPage: number
): Promise<T[]> {
  const acc: T[] = []
  let page = 1
  while (acc.length < want && page <= 100) {
    const batch = parse(await runner(['api', `${baseEndpoint}&page=${page}`]))
    acc.push(...batch)
    if (batch.length < perPage) break
    page += 1
  }
  return acc.slice(0, want)
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

/**
 * GitLab has no `@me` username (that is a GitHub convention coco uses for
 * `--mine` / `--author @me`). Translate `@me` into GitLab's `scope` filter
 * (`assigned_to_me` / `created_by_me`); pass any other username through as the
 * matching `*_username` param. Without this, `--mine` silently matches nothing
 * on GitLab.
 */
function userScopeParams(
  author: string | undefined,
  assignee: string | undefined
): Record<string, string | undefined> {
  const params: Record<string, string | undefined> = {}
  if (assignee === '@me') params.scope = 'assigned_to_me'
  else if (assignee) params.assignee_username = assignee
  if (author === '@me') {
    if (!params.scope) params.scope = 'created_by_me'
  } else if (author) {
    params.author_username = author
  }
  return params
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
  const raw = JSON.parse(trimmed)
  if (!Array.isArray(raw)) throw gitlabListError(raw, 'merge requests')
  return (raw as Array<Record<string, unknown>>).map((mr) => ({
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
    ...userScopeParams(filter.author, filter.assignee),
    labels: filter.label,
    search: filter.search,
    source_branch: filter.head,
    target_branch: filter.base,
    per_page: Math.min(filter.limit ?? 30, 100),
  })
  return `projects/${encodeProjectPath(path)}/merge_requests${query}`
}

export async function getMergeRequestList(
  git: SimpleGit,
  filter: PullRequestListFilter = {},
  runner: GlabRunner = defaultGlabRunner
): Promise<PullRequestListOverview> {
  return loadForgeList({
    detect: () => getGitLabProject(git),
    notDetectedMessage: 'No GitLab remote detected.',
    probe: (project) => getGlabStatus(runner, project.host),
    describeStatus: describeGlabStatus,
    repository: (project) => ({ owner: project.owner, name: project.name }),
    filter,
    fetch: async (project) => {
      const want = filter.limit ?? 30
      let pullRequests = await fetchAllPages(
        runner,
        buildMergeRequestEndpoint(project.path, filter),
        parseMergeRequests,
        want,
        Math.min(want, 100)
      )
      // The REST API has no stable cross-version "draft only" filter; apply it
      // client-side so `--draft` behaves the same as on GitHub.
      if (filter.draft) pullRequests = pullRequests.filter((mr) => mr.isDraft)
      return { pullRequests: pullRequests.map(sanitizePullRequestListItem) }
    },
    fetchErrorMessage: 'Failed to fetch merge request list.',
  })
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
  const raw = JSON.parse(trimmed)
  if (!Array.isArray(raw)) throw gitlabListError(raw, 'issues')
  return (raw as Array<Record<string, unknown>>).map((issue) => ({
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
    ...userScopeParams(filter.author, filter.assignee),
    labels: filter.label,
    search: filter.search,
    per_page: Math.min(filter.limit ?? 30, 100),
  })
  return `projects/${encodeProjectPath(path)}/issues${query}`
}

export async function getGitLabIssueList(
  git: SimpleGit,
  filter: IssueListFilter = {},
  runner: GlabRunner = defaultGlabRunner
): Promise<IssueListOverview> {
  return loadForgeList({
    detect: () => getGitLabProject(git),
    notDetectedMessage: 'No GitLab remote detected.',
    probe: (project) => getGlabStatus(runner, project.host),
    describeStatus: describeGlabStatus,
    repository: (project) => ({ owner: project.owner, name: project.name }),
    filter,
    fetch: async (project) => {
      const want = filter.limit ?? 30
      const issues = await fetchAllPages(
        runner,
        buildIssueEndpoint(project.path, filter),
        parseIssues,
        want,
        Math.min(want, 100)
      )
      return { issues: issues.map(sanitizeIssueListItem) }
    },
    fetchErrorMessage: 'Failed to fetch issue list.',
  })
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

/** Fetch the open GitLab merge request whose source branch is `branch`, if any. */
export async function findOpenMergeRequestForBranch(
  projectPath: string,
  branch: string,
  runner: GlabRunner
): Promise<Record<string, unknown> | undefined> {
  const endpoint = `projects/${encodeProjectPath(projectPath)}/merge_requests?source_branch=${encodeURIComponent(branch)}&state=opened`
  const out = (await runner(['api', endpoint])).trim()
  return (out ? (JSON.parse(out) as Array<Record<string, unknown>>) : [])[0]
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
  return loadForgeOverview({
    git,
    detect: () => getGitLabProject(git),
    notDetectedMessage: 'No GitLab remote detected.',
    probe: (project) => getGlabStatus(runner, project.host),
    describeStatus: describeGlabStatus,
    repository: (project) => ({ owner: project.owner, name: project.name }),
    requireCurrentBranch: true,
    fetch: async (project, currentBranch) => {
      const mr = await findOpenMergeRequestForBranch(project.path, currentBranch as string, runner)
      return {
        currentPullRequest: mr ? sanitizePullRequestInfo(mrToPullRequestInfo(mr)) : undefined,
        ...(mr ? {} : { message: `No merge request found for ${currentBranch}.` }),
      }
    },
    fetchErrorMessage: (currentBranch) => `No merge request found for ${currentBranch}.`,
  })
}

// Exported for unit tests (endpoint construction + state mapping).
export const __test = {
  buildMergeRequestEndpoint,
  buildIssueEndpoint,
  parseMergeRequests,
  parseIssues,
  normalizeState,
}
