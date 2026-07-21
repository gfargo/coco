import { SimpleGit } from 'simple-git'
import {
  bbqlQuote,
  describeBitbucketStatus,
  getBitbucketProject,
  getBitbucketStatus,
  type BitbucketRunner,
  defaultBitbucketRunner,
} from './bitbucketCli'
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
 * Bitbucket list loaders. These produce the SAME overview shapes as the
 * GitHub and GitLab loaders so the triage surfaces and command handlers
 * consume them identically. Data is fetched via the Bitbucket REST API v2
 * using a runner that reads credentials from environment variables.
 *
 * Field-mapping notes:
 *  - `author.nickname` → author (Bitbucket uses nickname, not login)
 *  - `reviewers[].nickname` → assignees (closest concept to assignees in Bitbucket)
 *  - Pull requests have no labels in Bitbucket Cloud; `labels` is omitted.
 *  - Issues use `kind` (bug/enhancement/proposal/task) as labels.
 */

type BitbucketPagedResponse<T> = {
  pagelen: number
  size?: number
  page: number
  values: T[]
  next?: string
}

function parsePage<T>(output: string, resource: string): BitbucketPagedResponse<T> {
  const trimmed = output.trim()
  if (!trimmed) return { pagelen: 0, page: 1, values: [] }
  const raw = JSON.parse(trimmed)
  if (!raw || !Array.isArray(raw.values)) {
    const detail =
      raw && typeof raw === 'object'
        ? String(
            (raw as Record<string, unknown>).error ??
              (raw as Record<string, unknown>).message ??
              ''
          )
        : ''
    throw new Error(
      detail
        ? `Bitbucket API error fetching ${resource}: ${detail}`
        : `Unexpected Bitbucket API response while fetching ${resource}.`
    )
  }
  return raw as BitbucketPagedResponse<T>
}

async function fetchAllPages<T>(
  runner: BitbucketRunner,
  baseEndpoint: string,
  resource: string,
  want: number
): Promise<T[]> {
  const pagelen = Math.min(want, 50)
  const sep = baseEndpoint.includes('?') ? '&' : '?'
  return paginate({
    fetchPage: (page) => runner(`${baseEndpoint}${sep}pagelen=${pagelen}&page=${page}`),
    parsePage: (output) => {
      const result = parsePage<T>(output, resource)
      return { items: result.values, hasMore: result.values.length >= pagelen && Boolean(result.next) }
    },
    want,
    maxPages: 100,
  })
}

function normalizeState(raw: unknown): string {
  const s = String(raw || '').toUpperCase()
  if (s === 'OPEN') return 'OPEN'
  if (s === 'MERGED') return 'MERGED'
  if (s === 'DECLINED' || s === 'SUPERSEDED') return 'CLOSED'
  return s
}

function normalizeIssueState(raw: unknown): string {
  const s = String(raw || '').toLowerCase()
  if (s === 'new' || s === 'open') return 'OPEN'
  if (s === 'on hold') return 'OPEN'
  return 'CLOSED'
}

function nicknameOf(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const obj = value as Record<string, unknown>
  return typeof obj.nickname === 'string' && obj.nickname ? obj.nickname : undefined
}

function nicknamesOf(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const names = value.map(nicknameOf).filter((n): n is string => Boolean(n))
  return names.length ? names : undefined
}

/**
 * Resolve the '@me' filter sentinel to the authenticated user's Bitbucket
 * nickname via GET /user. Author/assignee fields elsewhere in this file are
 * already keyed off `nickname` (see `nicknameOf`), so this keeps '@me'
 * comparisons consistent with the rest of the mapping.
 */
async function resolveBitbucketMeNickname(runner: BitbucketRunner): Promise<string | undefined> {
  const out = (await runner('user')).trim()
  if (!out) return undefined
  const raw = JSON.parse(out) as Record<string, unknown>
  return nicknameOf(raw)
}

export type RawBitbucketPR = Record<string, unknown>

function prSharedFields(pr: RawBitbucketPR) {
  const source = pr.source as Record<string, unknown> | undefined
  const destination = pr.destination as Record<string, unknown> | undefined
  const links = pr.links as Record<string, unknown> | undefined
  const htmlLink = links?.html as Record<string, unknown> | undefined
  return {
    number: Number(pr.id),
    title: String(pr.title || ''),
    url: String(htmlLink?.href || ''),
    state: normalizeState(pr.state),
    isDraft: Boolean(pr.draft),
    headRefName: String(((source?.branch as Record<string, unknown> | undefined)?.name) || ''),
    baseRefName: String(
      ((destination?.branch as Record<string, unknown> | undefined)?.name) || ''
    ),
    author: nicknameOf(pr.author),
    reviewDecision: undefined,
    mergeable: undefined,
    mergeStateStatus: undefined,
  }
}

function mapPullRequestItem(pr: RawBitbucketPR): PullRequestListItem {
  return {
    ...prSharedFields(pr),
    assignees: nicknamesOf(pr.reviewers),
    labels: undefined,
    createdAt: String(pr.created_on || ''),
    updatedAt: String(pr.updated_on || ''),
  }
}

function parsePullRequests(output: string): PullRequestListItem[] {
  return parsePage<RawBitbucketPR>(output, 'pull requests').values.map(mapPullRequestItem)
}

function buildPullRequestEndpoint(path: string, filter: PullRequestListFilter): string {
  const params: Record<string, string | number | undefined> = {}

  if (filter.state === 'open') {
    params.state = 'OPEN'
  } else if (filter.state === 'merged') {
    params.state = 'MERGED'
  } else if (filter.state === 'closed') {
    // Bitbucket has DECLINED and SUPERSEDED for closed PRs.
    params.q = '(state = "DECLINED" OR state = "SUPERSEDED")'
  }
  // 'all' and undefined: omit state param — returns all PRs.

  if (filter.head) {
    const headQ = `source.branch.name = "${bbqlQuote(filter.head)}"`
    params.q = params.q ? `(${params.q}) AND ${headQ}` : headQ
  }

  if (filter.base) {
    const baseQ = `destination.branch.name = "${bbqlQuote(filter.base)}"`
    params.q = params.q ? `(${params.q}) AND ${baseQ}` : baseQ
  }

  if (filter.search) {
    const searchQ = `title ~ "${bbqlQuote(filter.search)}"`
    params.q = params.q ? `(${params.q}) AND ${searchQ}` : searchQ
  }

  const pairs = Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
  const qs = pairs.length ? `?${pairs.join('&')}` : ''

  return `repositories/${path}/pullrequests${qs}`
}

export async function getBitbucketPullRequestList(
  git: SimpleGit,
  filter: PullRequestListFilter = {},
  runner: BitbucketRunner = defaultBitbucketRunner
): Promise<PullRequestListOverview> {
  return loadForgeList({
    detect: () => getBitbucketProject(git),
    notDetectedMessage: 'No Bitbucket remote detected.',
    probe: () => getBitbucketStatus(runner),
    describeStatus: describeBitbucketStatus,
    repository: (project) => ({ owner: project.owner, name: project.name }),
    filter,
    fetch: async (project) => {
      if (filter.label) {
        throw new Error('Pull request labels are not supported on Bitbucket Cloud.')
      }

      const want = filter.limit ?? 30
      let pullRequests: PullRequestListItem[] = []

      const raw = await fetchAllPages<RawBitbucketPR>(
        runner,
        buildPullRequestEndpoint(project.path, filter),
        'pull requests',
        want
      )

      pullRequests = raw.map(mapPullRequestItem)

      if (filter.draft) pullRequests = pullRequests.filter((pr) => pr.isDraft)

      const wantsMe = filter.author === '@me' || filter.assignee === '@me'
      const me = wantsMe ? await resolveBitbucketMeNickname(runner) : undefined
      if (wantsMe && !me) {
        throw new Error(
          'Could not resolve "@me" to a Bitbucket user (no nickname on the authenticated account).'
        )
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

type RawBitbucketIssue = Record<string, unknown>

function mapIssueItem(issue: RawBitbucketIssue): IssueListItem {
  const links = issue.links as Record<string, unknown> | undefined
  const htmlLink = links?.html as Record<string, unknown> | undefined
  const assignee = issue.assignee as Record<string, unknown> | undefined
  const kind = typeof issue.kind === 'string' && issue.kind ? [issue.kind] : undefined
  return {
    number: Number(issue.id),
    title: String(issue.title || ''),
    url: String(htmlLink?.href || ''),
    state: normalizeIssueState(issue.status ?? issue.state),
    author: nicknameOf(issue.reporter ?? issue.author),
    assignees: assignee ? [String(assignee.nickname || '')].filter(Boolean) : undefined,
    labels: kind,
    comments: typeof issue.comment_count === 'number' ? issue.comment_count : undefined,
    createdAt: String(issue.created_on || ''),
    updatedAt: String(issue.updated_on || ''),
  } as IssueListItem
}

function parseIssues(output: string): IssueListItem[] {
  return parsePage<RawBitbucketIssue>(output, 'issues').values.map(mapIssueItem)
}

function buildIssueEndpoint(path: string, filter: IssueListFilter): string {
  const q: string[] = []

  if (filter.state === 'open') {
    q.push('(status = "new" OR status = "open" OR status = "on hold")')
  } else if (filter.state === 'closed') {
    q.push('(status = "resolved" OR status = "closed" OR status = "invalid" OR status = "wontfix" OR status = "duplicate")')
  }

  // '@me' is resolved to a real nickname by the caller before this runs;
  // the guards keep a literal '@me' (a nickname Bitbucket doesn't know)
  // out of the query if this is ever called without that resolution.
  if (filter.assignee && filter.assignee !== '@me') {
    q.push(`assignee.nickname = "${bbqlQuote(filter.assignee)}"`)
  }

  if (filter.author && filter.author !== '@me') {
    q.push(`reporter.nickname = "${bbqlQuote(filter.author)}"`)
  }

  if (filter.search) {
    q.push(`title ~ "${bbqlQuote(filter.search)}"`)
  }

  const pairs: string[] = []
  if (q.length) pairs.push(`q=${encodeURIComponent(q.join(' AND '))}`)

  const qs = pairs.length ? `?${pairs.join('&')}` : ''
  return `repositories/${path}/issues${qs}`
}

export async function getBitbucketIssueList(
  git: SimpleGit,
  filter: IssueListFilter = {},
  runner: BitbucketRunner = defaultBitbucketRunner
): Promise<IssueListOverview> {
  return loadForgeList({
    detect: () => getBitbucketProject(git),
    notDetectedMessage: 'No Bitbucket remote detected.',
    probe: () => getBitbucketStatus(runner),
    describeStatus: describeBitbucketStatus,
    repository: (project) => ({ owner: project.owner, name: project.name }),
    filter,
    fetch: async (project) => {
      const want = filter.limit ?? 30

      // Resolve '@me' BEFORE building the endpoint so the nickname lands in
      // the BBQL query and Bitbucket filters server-side. Filtering after
      // the fetch (the old approach) ran against only the first `want`
      // issues of the unfiltered list, so a user whose issues sat past that
      // window saw them silently dropped.
      const wantsMe = filter.author === '@me' || filter.assignee === '@me'
      const me = wantsMe ? await resolveBitbucketMeNickname(runner) : undefined
      if (wantsMe && !me) {
        throw new Error(
          'Could not resolve "@me" to a Bitbucket user (no nickname on the authenticated account).'
        )
      }
      const effectiveFilter: IssueListFilter = wantsMe
        ? {
            ...filter,
            author: filter.author === '@me' ? me : filter.author,
            assignee: filter.assignee === '@me' ? me : filter.assignee,
          }
        : filter

      const raw = await fetchAllPages<RawBitbucketIssue>(
        runner,
        buildIssueEndpoint(project.path, effectiveFilter),
        'issues',
        want
      )

      return { issues: raw.map(mapIssueItem).map(sanitizeIssueListItem) }
    },
    fetchErrorMessage: 'Failed to fetch issue list.',
  })
}

// ---------------------------------------------------------------------------
// Current-branch pull request overview (for `coco pr` / workstation header)
// ---------------------------------------------------------------------------

function prToPullRequestInfo(pr: RawBitbucketPR): PullRequestInfo {
  return {
    ...prSharedFields(pr),
    body: typeof pr.description === 'string' ? pr.description : undefined,
    statusCheckRollup: undefined,
    reviews: undefined,
  }
}

/** Fetch the open Bitbucket pull request whose source branch is `branch`, if any. */
export async function findOpenBitbucketPullRequestForBranch(
  projectPath: string,
  branch: string,
  runner: BitbucketRunner
): Promise<RawBitbucketPR | undefined> {
  const q = encodeURIComponent(`source.branch.name = "${bbqlQuote(branch)}" AND state = "OPEN"`)
  const out = (await runner(`repositories/${projectPath}/pullrequests?q=${q}&pagelen=1`)).trim()
  const page = out ? (JSON.parse(out) as { values?: RawBitbucketPR[] }) : undefined
  return page?.values?.[0]
}

export async function getBitbucketPullRequestOverview(
  git: SimpleGit,
  runner: BitbucketRunner = defaultBitbucketRunner
): Promise<PullRequestOverview> {
  return loadForgeOverview({
    git,
    detect: () => getBitbucketProject(git),
    notDetectedMessage: 'No Bitbucket remote detected.',
    probe: () => getBitbucketStatus(runner),
    describeStatus: describeBitbucketStatus,
    repository: (project) => ({ owner: project.owner, name: project.name }),
    requireCurrentBranch: true,
    fetch: async (project, currentBranch) => {
      const pr = await findOpenBitbucketPullRequestForBranch(project.path, currentBranch as string, runner)
      return {
        currentPullRequest: pr ? sanitizePullRequestInfo(prToPullRequestInfo(pr)) : undefined,
        ...(pr ? {} : { message: `No pull request found for ${currentBranch}.` }),
      }
    },
    fetchErrorMessage: (currentBranch) => `No pull request found for ${currentBranch}.`,
  })
}

export const __test = {
  buildPullRequestEndpoint,
  buildIssueEndpoint,
  parsePullRequests,
  parseIssues,
  normalizeState,
  normalizeIssueState,
  resolveBitbucketMeNickname,
}
