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

type RawBitbucketPR = Record<string, unknown>

function parsePullRequests(output: string): PullRequestListItem[] {
  const result = parsePage<RawBitbucketPR>(output, 'pull requests')
  return result.values.map((pr) => {
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
      headRefName: String(
        ((source?.branch as Record<string, unknown> | undefined)?.name) || ''
      ),
      baseRefName: String(
        ((destination?.branch as Record<string, unknown> | undefined)?.name) || ''
      ),
      author: nicknameOf(pr.author),
      assignees: nicknamesOf(pr.reviewers),
      labels: undefined,
      reviewDecision: undefined,
      mergeable: undefined,
      mergeStateStatus: undefined,
      createdAt: String(pr.created_on || ''),
      updatedAt: String(pr.updated_on || ''),
    }
  })
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
      const want = filter.limit ?? 30
      let pullRequests: PullRequestListItem[] = []

      const raw = await fetchAllPages<RawBitbucketPR>(
        runner,
        buildPullRequestEndpoint(project.path, filter),
        'pull requests',
        want
      )

      pullRequests = raw.map((pr) => {
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
          headRefName: String(
            ((source?.branch as Record<string, unknown> | undefined)?.name) || ''
          ),
          baseRefName: String(
            ((destination?.branch as Record<string, unknown> | undefined)?.name) || ''
          ),
          author: nicknameOf(pr.author),
          assignees: nicknamesOf(pr.reviewers),
          labels: undefined,
          reviewDecision: undefined,
          mergeable: undefined,
          mergeStateStatus: undefined,
          createdAt: String(pr.created_on || ''),
          updatedAt: String(pr.updated_on || ''),
        }
      })

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

function parseIssues(output: string): IssueListItem[] {
  const result = parsePage<RawBitbucketIssue>(output, 'issues')
  return result.values.map((issue) => {
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
      assignees: assignee ? [String(assignee.nickname || '')] .filter(Boolean) : undefined,
      labels: kind,
      comments: typeof issue.comment_count === 'number' ? issue.comment_count : undefined,
      createdAt: String(issue.created_on || ''),
      updatedAt: String(issue.updated_on || ''),
    } as IssueListItem
  })
}

function buildIssueEndpoint(path: string, filter: IssueListFilter): string {
  const q: string[] = []

  if (filter.state === 'open') {
    q.push('(status = "new" OR status = "open" OR status = "on hold")')
  } else if (filter.state === 'closed') {
    q.push('(status = "resolved" OR status = "closed" OR status = "invalid" OR status = "wontfix" OR status = "duplicate")')
  }

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
      const raw = await fetchAllPages<RawBitbucketIssue>(
        runner,
        buildIssueEndpoint(project.path, filter),
        'issues',
        want
      )

      let issues = raw.map((issue) => {
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
      })

      const wantsMe = filter.author === '@me' || filter.assignee === '@me'
      const me = wantsMe ? await resolveBitbucketMeNickname(runner) : undefined
      if (wantsMe && !me) {
        throw new Error(
          'Could not resolve "@me" to a Bitbucket user (no nickname on the authenticated account).'
        )
      }

      if (filter.author === '@me') {
        issues = issues.filter((issue) => issue.author === me)
      }

      if (filter.assignee === '@me') {
        issues = issues.filter((issue) => issue.assignees?.includes(me as string))
      }

      return { issues: issues.map(sanitizeIssueListItem) }
    },
    fetchErrorMessage: 'Failed to fetch issue list.',
  })
}

// ---------------------------------------------------------------------------
// Current-branch pull request overview (for `coco pr` / workstation header)
// ---------------------------------------------------------------------------

function prToPullRequestInfo(pr: RawBitbucketPR): PullRequestInfo {
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
    headRefName: String(
      ((source?.branch as Record<string, unknown> | undefined)?.name) || ''
    ),
    baseRefName: String(
      ((destination?.branch as Record<string, unknown> | undefined)?.name) || ''
    ),
    body: typeof pr.description === 'string' ? pr.description : undefined,
    author: nicknameOf(pr.author),
    reviewDecision: undefined,
    mergeable: undefined,
    mergeStateStatus: undefined,
    statusCheckRollup: undefined,
    reviews: undefined,
  }
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
      const q = encodeURIComponent(`source.branch.name = "${bbqlQuote(currentBranch ?? '')}" AND state = "OPEN"`)
      const out = (await runner(`repositories/${project.path}/pullrequests?q=${q}&pagelen=1`)).trim()
      const page = out ? JSON.parse(out) as { values?: RawBitbucketPR[] } : undefined
      const pr = page?.values?.[0]
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
