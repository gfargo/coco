import { SimpleGit } from 'simple-git'
import {
  describeGiteaStatus,
  getGiteaProject,
  getGiteaStatus,
  makeGiteaRunner,
  type GiteaRunner,
} from './giteaCli'
import { loadForgeList, loadForgeOverview, paginate } from './forgeLoad'
import type { IssueListFilter, IssueListItem, IssueListOverview } from './issuesListData'
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
 * Gitea / Forgejo list loaders. These produce the SAME overview shapes as the
 * GitHub, GitLab, and Bitbucket loaders so the triage surfaces and command
 * handlers consume them identically. Data is fetched via the Gitea REST API v1
 * using a runner bound to the detected repository's host — every Gitea/Forgejo
 * install serves its own API base, so `runnerFactory` builds the runner from
 * the project's host once it's known (see `makeGiteaRunner` in `giteaCli.ts`).
 *
 * Gitea's REST API doesn't expose server-side filters for author/assignee/
 * search/label the way GitHub or GitLab do, so those filters are applied
 * client-side after fetching up to `want` raw items — the same best-effort
 * shape Bitbucket uses (a client-side filter can narrow the result below
 * `want`, since we don't re-fetch to backfill).
 *
 * `/repos/{owner}/{repo}/issues` returns issues AND pull requests together
 * (Gitea models PRs as issues internally); entries carrying a non-null
 * `pull_request` field are pull requests and are filtered out of the issue
 * list. Pull requests are fetched from the dedicated `/pulls` endpoint.
 */

type RunnerFactory = (host: string) => GiteaRunner

function loginOf(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const obj = value as Record<string, unknown>
  return typeof obj.login === 'string' && obj.login ? obj.login : undefined
}

function loginsOf(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const names = value.map(loginOf).filter((n): n is string => Boolean(n))
  return names.length ? names : undefined
}

function labelNamesOf(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const names = (value as Array<Record<string, unknown>>)
    .map((l) => (l && typeof l.name === 'string' ? l.name : ''))
    .filter(Boolean)
  return names.length ? names : undefined
}

/** Resolve the '@me' filter sentinel to the authenticated user's Gitea login via GET /user. */
async function resolveGiteaMeLogin(runner: GiteaRunner): Promise<string | undefined> {
  const out = (await runner('user')).trim()
  if (!out) return undefined
  return loginOf(JSON.parse(out) as Record<string, unknown>)
}

async function fetchAllPages<T>(
  runner: GiteaRunner,
  baseEndpoint: string,
  resource: string,
  want: number
): Promise<T[]> {
  const perPage = Math.min(want, 50)
  const sep = baseEndpoint.includes('?') ? '&' : '?'
  return paginate({
    fetchPage: (page) => runner(`${baseEndpoint}${sep}limit=${perPage}&page=${page}`),
    parsePage: (output) => {
      const trimmed = output.trim()
      if (!trimmed) return { items: [], hasMore: false }
      const raw = JSON.parse(trimmed)
      if (!Array.isArray(raw)) {
        const detail =
          raw && typeof raw === 'object' ? String((raw as Record<string, unknown>).message ?? '') : ''
        throw new Error(
          detail
            ? `Gitea API error fetching ${resource}: ${detail}`
            : `Unexpected Gitea API response while fetching ${resource}.`
        )
      }
      return { items: raw as T[], hasMore: raw.length >= perPage }
    },
    want,
    maxPages: 100,
  })
}

// ---------------------------------------------------------------------------
// Pull requests
// ---------------------------------------------------------------------------

export type RawGiteaPR = Record<string, unknown>

function isDraftPR(pr: RawGiteaPR): boolean {
  if (typeof pr.draft === 'boolean') return pr.draft
  // Older Gitea/Forgejo versions have no `draft` boolean and mark WIP PRs
  // with a title prefix instead.
  return /^\s*\[WIP\]/i.test(String(pr.title || ''))
}

function prSharedFields(pr: RawGiteaPR) {
  const head = pr.head as Record<string, unknown> | undefined
  const base = pr.base as Record<string, unknown> | undefined
  return {
    number: Number(pr.number),
    title: String(pr.title || ''),
    url: String(pr.html_url || ''),
    state: pr.merged ? 'MERGED' : String(pr.state || '').toUpperCase(),
    isDraft: isDraftPR(pr),
    headRefName: String(head?.ref || ''),
    baseRefName: String(base?.ref || ''),
    author: loginOf(pr.user),
    reviewDecision: undefined,
    mergeable:
      typeof pr.mergeable === 'boolean' ? (pr.mergeable ? 'MERGEABLE' : 'CONFLICTING') : undefined,
    mergeStateStatus: undefined,
  }
}

function mapPullRequestItem(pr: RawGiteaPR): PullRequestListItem {
  return {
    ...prSharedFields(pr),
    assignees: loginsOf(pr.assignees),
    labels: labelNamesOf(pr.labels),
    createdAt: String(pr.created_at || ''),
    updatedAt: String(pr.updated_at || ''),
  }
}

function giteaPullRequestStateParam(state: PullRequestListFilter['state']): 'open' | 'closed' | 'all' {
  if (state === 'open') return 'open'
  if (state === 'closed' || state === 'merged') return 'closed'
  return 'all'
}

export async function getGiteaPullRequestList(
  git: SimpleGit,
  filter: PullRequestListFilter = {},
  runnerFactory: RunnerFactory = makeGiteaRunner
): Promise<PullRequestListOverview> {
  return loadForgeList({
    detect: () => getGiteaProject(git),
    notDetectedMessage: 'No Gitea remote detected.',
    probe: (project) => getGiteaStatus(runnerFactory(project.host)),
    describeStatus: describeGiteaStatus,
    repository: (project) => ({ owner: project.owner, name: project.name }),
    filter,
    fetch: async (project) => {
      const runner = runnerFactory(project.host)
      const want = filter.limit ?? 30

      const raw = await fetchAllPages<RawGiteaPR>(
        runner,
        `repos/${project.path}/pulls?state=${giteaPullRequestStateParam(filter.state)}`,
        'pull requests',
        want
      )

      let pullRequests = raw.map(mapPullRequestItem)

      if (filter.state === 'merged') pullRequests = pullRequests.filter((pr) => pr.state === 'MERGED')
      else if (filter.state === 'closed') pullRequests = pullRequests.filter((pr) => pr.state === 'CLOSED')

      if (filter.draft) pullRequests = pullRequests.filter((pr) => pr.isDraft)
      if (filter.head) pullRequests = pullRequests.filter((pr) => pr.headRefName === filter.head)
      if (filter.base) pullRequests = pullRequests.filter((pr) => pr.baseRefName === filter.base)

      if (filter.search) {
        const needle = filter.search.toLowerCase()
        pullRequests = pullRequests.filter((pr) => pr.title.toLowerCase().includes(needle))
      }

      if (filter.label) {
        const wanted = filter.label.split(',').map((l) => l.trim()).filter(Boolean)
        pullRequests = pullRequests.filter((pr) => wanted.every((l) => pr.labels?.includes(l)))
      }

      const wantsMe = filter.author === '@me' || filter.assignee === '@me'
      const me = wantsMe ? await resolveGiteaMeLogin(runner) : undefined
      if (wantsMe && !me) {
        throw new Error('Could not resolve "@me" to a Gitea user (no login on the authenticated account).')
      }

      if (filter.author) {
        const authorFilter = filter.author === '@me' ? me : filter.author
        pullRequests = pullRequests.filter((pr) => pr.author === authorFilter)
      }

      if (filter.assignee) {
        const assigneeFilter = filter.assignee === '@me' ? me : filter.assignee
        pullRequests = pullRequests.filter(
          (pr) => assigneeFilter !== undefined && pr.assignees?.includes(assigneeFilter)
        )
      }

      return { pullRequests: pullRequests.map(sanitizePullRequestListItem) }
    },
    fetchErrorMessage: 'Failed to fetch pull request list.',
  })
}

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

export type RawGiteaIssue = Record<string, unknown>

function isPullRequestEntry(issue: RawGiteaIssue): boolean {
  return issue.pull_request !== undefined && issue.pull_request !== null
}

function mapIssueItem(issue: RawGiteaIssue): IssueListItem {
  const assignee = issue.assignee as Record<string, unknown> | undefined
  return {
    number: Number(issue.number),
    title: String(issue.title || ''),
    url: String(issue.html_url || ''),
    state: String(issue.state || '').toUpperCase(),
    author: loginOf(issue.user),
    assignees: loginsOf(issue.assignees) ?? (loginOf(assignee) ? [loginOf(assignee) as string] : undefined),
    labels: labelNamesOf(issue.labels),
    comments: typeof issue.comments === 'number' ? issue.comments : undefined,
    createdAt: String(issue.created_at || ''),
    updatedAt: String(issue.updated_at || ''),
  }
}

function giteaIssueStateParam(state: IssueListFilter['state']): 'open' | 'closed' | 'all' {
  if (state === 'open') return 'open'
  if (state === 'closed') return 'closed'
  return 'all'
}

export async function getGiteaIssueList(
  git: SimpleGit,
  filter: IssueListFilter = {},
  runnerFactory: RunnerFactory = makeGiteaRunner
): Promise<IssueListOverview> {
  return loadForgeList({
    detect: () => getGiteaProject(git),
    notDetectedMessage: 'No Gitea remote detected.',
    probe: (project) => getGiteaStatus(runnerFactory(project.host)),
    describeStatus: describeGiteaStatus,
    repository: (project) => ({ owner: project.owner, name: project.name }),
    filter,
    fetch: async (project) => {
      const runner = runnerFactory(project.host)
      const want = filter.limit ?? 30

      const raw = await fetchAllPages<RawGiteaIssue>(
        runner,
        `repos/${project.path}/issues?state=${giteaIssueStateParam(filter.state)}`,
        'issues',
        want
      )

      let issues = raw.filter((entry) => !isPullRequestEntry(entry)).map(mapIssueItem)

      if (filter.search) {
        const needle = filter.search.toLowerCase()
        issues = issues.filter((issue) => issue.title.toLowerCase().includes(needle))
      }

      if (filter.label) {
        const wanted = filter.label.split(',').map((l) => l.trim()).filter(Boolean)
        issues = issues.filter((issue) => wanted.every((l) => issue.labels?.includes(l)))
      }

      const wantsMe = filter.author === '@me' || filter.assignee === '@me'
      const me = wantsMe ? await resolveGiteaMeLogin(runner) : undefined
      if (wantsMe && !me) {
        throw new Error('Could not resolve "@me" to a Gitea user (no login on the authenticated account).')
      }

      if (filter.author) {
        const authorFilter = filter.author === '@me' ? me : filter.author
        issues = issues.filter((issue) => issue.author === authorFilter)
      }

      if (filter.assignee) {
        const assigneeFilter = filter.assignee === '@me' ? me : filter.assignee
        issues = issues.filter(
          (issue) => assigneeFilter !== undefined && issue.assignees?.includes(assigneeFilter)
        )
      }

      return { issues: issues.map(sanitizeIssueListItem) }
    },
    fetchErrorMessage: 'Failed to fetch issue list.',
  })
}

// ---------------------------------------------------------------------------
// Current-branch pull request overview (for `coco pr` / workstation header)
// ---------------------------------------------------------------------------

function prToPullRequestInfo(pr: RawGiteaPR): PullRequestInfo {
  return {
    ...prSharedFields(pr),
    body: typeof pr.body === 'string' ? pr.body : undefined,
    statusCheckRollup: undefined,
    reviews: undefined,
  }
}

/**
 * Fetch the open Gitea/Forgejo pull request whose head branch is `branch`, if
 * any. Gitea has no server-side "filter by head branch" query param, so this
 * fetches open PRs (bounded to 50) and filters client-side.
 */
export async function findOpenGiteaPullRequestForBranch(
  projectPath: string,
  branch: string,
  runner: GiteaRunner
): Promise<RawGiteaPR | undefined> {
  const out = (await runner(`repos/${projectPath}/pulls?state=open&limit=50`)).trim()
  if (!out) return undefined
  const raw = JSON.parse(out)
  if (!Array.isArray(raw)) return undefined
  return (raw as RawGiteaPR[]).find((pr) => {
    const head = pr.head as Record<string, unknown> | undefined
    return String(head?.ref || '') === branch
  })
}

export async function getGiteaPullRequestOverview(
  git: SimpleGit,
  runnerFactory: RunnerFactory = makeGiteaRunner
): Promise<PullRequestOverview> {
  return loadForgeOverview({
    git,
    detect: () => getGiteaProject(git),
    notDetectedMessage: 'No Gitea remote detected.',
    probe: (project) => getGiteaStatus(runnerFactory(project.host)),
    describeStatus: describeGiteaStatus,
    repository: (project) => ({ owner: project.owner, name: project.name }),
    requireCurrentBranch: true,
    fetch: async (project, currentBranch) => {
      const runner = runnerFactory(project.host)
      const pr = await findOpenGiteaPullRequestForBranch(project.path, currentBranch as string, runner)
      return {
        currentPullRequest: pr ? sanitizePullRequestInfo(prToPullRequestInfo(pr)) : undefined,
        ...(pr ? {} : { message: `No pull request found for ${currentBranch}.` }),
      }
    },
    fetchErrorMessage: (currentBranch) => `No pull request found for ${currentBranch}.`,
  })
}

export const __test = {
  giteaPullRequestStateParam,
  giteaIssueStateParam,
  mapPullRequestItem,
  mapIssueItem,
  isPullRequestEntry,
  isDraftPR,
  resolveGiteaMeLogin,
}
