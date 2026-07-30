import { SimpleGit } from 'simple-git'
import {
  describeBitbucketServerStatus,
  getBitbucketServerProject,
  getBitbucketServerStatus,
  makeBitbucketServerRunner,
  splitBitbucketServerPath,
  type BitbucketServerRunner,
} from './bitbucketServerCli'
import { loadForgeList, loadForgeOverview, paginate } from './forgeLoad'
import type { IssueListFilter, IssueListOverview } from './issuesListData'
import type {
  PullRequestListFilter,
  PullRequestListItem,
  PullRequestListOverview,
} from './pullRequestListData'
import type { PullRequestInfo, PullRequestOverview } from './pullRequestData'
import { sanitizePullRequestInfo, sanitizePullRequestListItem } from './forgeText'

/**
 * Bitbucket Server / Data Center list loaders. These produce the SAME
 * overview shapes as the other forge loaders so the triage surfaces and
 * command handlers consume them identically. Data is fetched via the REST
 * API 1.0 (`https://<host>/rest/api/1.0`) using a runner bound to the
 * detected repository's host — every Bitbucket Server install serves its own
 * API base (see `makeBitbucketServerRunner`), same as Gitea/Forgejo.
 *
 * Bitbucket Server has no issue tracker (that's a Jira integration, not part
 * of this REST API), no pull-request labels, and no lightweight "who am I"
 * endpoint for token auth — `@me` only resolves when
 * `BITBUCKET_SERVER_USERNAME` (Basic auth) is set. Author/assignee/search
 * filtering is applied client-side after fetching up to `want` raw items,
 * the same best-effort shape Bitbucket Cloud and Gitea use.
 */

type RunnerFactory = (host: string) => BitbucketServerRunner

type BitbucketServerPagedResponse<T> = {
  size?: number
  limit?: number
  start?: number
  isLastPage?: boolean
  nextPageStart?: number
  values: T[]
}

function parsePage<T>(output: string, resource: string): BitbucketServerPagedResponse<T> {
  const trimmed = output.trim()
  if (!trimmed) return { values: [] }
  const raw = JSON.parse(trimmed)
  if (!raw || !Array.isArray(raw.values)) {
    const detail =
      raw && typeof raw === 'object'
        ? String((raw as { errors?: Array<{ message?: string }> }).errors?.[0]?.message ?? '')
        : ''
    throw new Error(
      detail
        ? `Bitbucket Server API error fetching ${resource}: ${detail}`
        : `Unexpected Bitbucket Server API response while fetching ${resource}.`
    )
  }
  return raw as BitbucketServerPagedResponse<T>
}

async function fetchAllPages<T>(
  runner: BitbucketServerRunner,
  baseEndpoint: string,
  resource: string,
  want: number
): Promise<T[]> {
  const limit = Math.min(want, 100)
  const sep = baseEndpoint.includes('?') ? '&' : '?'
  return (
    await paginate({
      fetchPage: (page) => runner(`${baseEndpoint}${sep}limit=${limit}&start=${(page - 1) * limit}`),
      parsePage: (output) => {
        const result = parsePage<T>(output, resource)
        return { items: result.values, hasMore: result.isLastPage === false }
      },
      want,
      maxPages: 100,
    })
  ).items
}

function epochToIso(value: unknown): string {
  return typeof value === 'number' ? new Date(value).toISOString() : ''
}

function normalizeState(raw: unknown): string {
  const s = String(raw || '').toUpperCase()
  if (s === 'DECLINED') return 'CLOSED'
  return s || 'OPEN'
}

function userSlugOf(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const user = (value as Record<string, unknown>).user as Record<string, unknown> | undefined
  if (!user) return undefined
  return typeof user.slug === 'string' && user.slug
    ? user.slug
    : typeof user.name === 'string' && user.name
      ? user.name
      : undefined
}

function reviewerSlugsOf(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const names = value.map(userSlugOf).filter((n): n is string => Boolean(n))
  return names.length ? names : undefined
}

/**
 * `@me` only resolves under Basic auth, where the configured username IS the
 * account. Bitbucket Server's REST API 1.0 has no authenticated
 * "current user" endpoint the way Bitbucket Cloud (`GET /user`) or Gitea
 * (`GET /user`) do, so token auth (`BITBUCKET_SERVER_TOKEN`) can't resolve
 * it at all.
 */
function resolveBitbucketServerMeSlug(): string | undefined {
  return process.env.BITBUCKET_SERVER_USERNAME || undefined
}

export type RawBitbucketServerPR = Record<string, unknown>

function selfHref(pr: RawBitbucketServerPR): string {
  const links = pr.links as Record<string, unknown> | undefined
  const self = links?.self as Array<Record<string, unknown>> | undefined
  return String(self?.[0]?.href || '')
}

function prSharedFields(pr: RawBitbucketServerPR) {
  const fromRef = pr.fromRef as Record<string, unknown> | undefined
  const toRef = pr.toRef as Record<string, unknown> | undefined
  return {
    number: Number(pr.id),
    title: String(pr.title || ''),
    url: selfHref(pr),
    state: normalizeState(pr.state),
    isDraft: Boolean(pr.draft),
    headRefName: String(fromRef?.displayId || ''),
    baseRefName: String(toRef?.displayId || ''),
    author: userSlugOf(pr.author),
    reviewDecision: undefined,
    mergeable: undefined,
    mergeStateStatus: undefined,
  }
}

function mapPullRequestItem(pr: RawBitbucketServerPR): PullRequestListItem {
  return {
    ...prSharedFields(pr),
    assignees: reviewerSlugsOf(pr.reviewers),
    labels: undefined,
    createdAt: epochToIso(pr.createdDate),
    updatedAt: epochToIso(pr.updatedDate),
  }
}

function bitbucketServerStateParam(state: PullRequestListFilter['state']): 'OPEN' | 'MERGED' | 'DECLINED' | 'ALL' {
  if (state === 'open') return 'OPEN'
  if (state === 'merged') return 'MERGED'
  if (state === 'closed') return 'DECLINED'
  return 'ALL'
}

function buildPullRequestEndpoint(path: string, filter: PullRequestListFilter): string | undefined {
  const parts = splitBitbucketServerPath(path)
  if (!parts) return undefined

  const params: Record<string, string> = { state: bitbucketServerStateParam(filter.state) }
  if (filter.search) params.filterText = filter.search

  const qs = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&')

  return `projects/${parts.projectKey}/repos/${parts.repoSlug}/pull-requests?${qs}`
}

export async function getBitbucketServerPullRequestList(
  git: SimpleGit,
  filter: PullRequestListFilter = {},
  runnerFactory: RunnerFactory = makeBitbucketServerRunner
): Promise<PullRequestListOverview> {
  return loadForgeList({
    detect: () => getBitbucketServerProject(git),
    notDetectedMessage: 'No Bitbucket Server remote detected.',
    probe: (project) => getBitbucketServerStatus(runnerFactory(project.host)),
    describeStatus: describeBitbucketServerStatus,
    repository: (project) => ({ owner: project.owner, name: project.name }),
    filter,
    fetch: async (project) => {
      if (filter.label) {
        throw new Error('Pull request labels are not supported on Bitbucket Server.')
      }

      const endpoint = buildPullRequestEndpoint(project.path, filter)
      if (!endpoint) throw new Error('Could not resolve the Bitbucket Server project path.')

      const runner = runnerFactory(project.host)
      const want = filter.limit ?? 30

      const raw = await fetchAllPages<RawBitbucketServerPR>(runner, endpoint, 'pull requests', want)
      let pullRequests = raw.map(mapPullRequestItem)

      if (filter.draft) pullRequests = pullRequests.filter((pr) => pr.isDraft)
      if (filter.head) pullRequests = pullRequests.filter((pr) => pr.headRefName === filter.head)
      if (filter.base) pullRequests = pullRequests.filter((pr) => pr.baseRefName === filter.base)

      const wantsMe = filter.author === '@me' || filter.assignee === '@me'
      const me = wantsMe ? resolveBitbucketServerMeSlug() : undefined
      if (wantsMe && !me) {
        throw new Error(
          'Could not resolve "@me" — set BITBUCKET_SERVER_USERNAME, or pass an explicit username (Bitbucket Server has no authenticated "current user" endpoint for token auth).'
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

/**
 * Bitbucket Server has no built-in issue tracker (issues require a separate
 * Jira integration, not part of this REST API) — the list loader still runs
 * the detect/probe availability ladder so `available`/`authenticated` are
 * accurate, then reports the gap explicitly via `message` rather than
 * silently returning an empty list.
 */
export async function getBitbucketServerIssueList(
  git: SimpleGit,
  filter: IssueListFilter = {},
  runnerFactory: RunnerFactory = makeBitbucketServerRunner
): Promise<IssueListOverview> {
  return loadForgeList({
    detect: () => getBitbucketServerProject(git),
    notDetectedMessage: 'No Bitbucket Server remote detected.',
    probe: (project) => getBitbucketServerStatus(runnerFactory(project.host)),
    describeStatus: describeBitbucketServerStatus,
    repository: (project) => ({ owner: project.owner, name: project.name }),
    filter,
    fetch: async () => {
      throw new Error('Bitbucket Server has no built-in issue tracker (issues require a Jira integration).')
    },
    fetchErrorMessage: 'Bitbucket Server has no built-in issue tracker.',
  })
}

// ---------------------------------------------------------------------------
// Current-branch pull request overview (for `coco pr` / workstation header)
// ---------------------------------------------------------------------------

function prToPullRequestInfo(pr: RawBitbucketServerPR): PullRequestInfo {
  return {
    ...prSharedFields(pr),
    body: typeof pr.description === 'string' ? pr.description : undefined,
    statusCheckRollup: undefined,
    reviews: undefined,
  }
}

/**
 * Fetch the open Bitbucket Server pull request whose source branch is
 * `branch`, if any. `direction=OUTGOING&at=refs/heads/<branch>` is the
 * server-side filter for "PRs whose fromRef is this branch" — narrower and
 * cheaper than Gitea's client-side-only equivalent.
 */
export async function findOpenBitbucketServerPullRequestForBranch(
  projectPath: string,
  branch: string,
  runner: BitbucketServerRunner
): Promise<RawBitbucketServerPR | undefined> {
  const parts = splitBitbucketServerPath(projectPath)
  if (!parts) return undefined
  const at = encodeURIComponent(`refs/heads/${branch}`)
  const out = (
    await runner(
      `projects/${parts.projectKey}/repos/${parts.repoSlug}/pull-requests?state=OPEN&direction=OUTGOING&at=${at}&limit=1`
    )
  ).trim()
  const page = out ? (JSON.parse(out) as { values?: RawBitbucketServerPR[] }) : undefined
  return page?.values?.[0]
}

export async function getBitbucketServerPullRequestOverview(
  git: SimpleGit,
  runnerFactory: RunnerFactory = makeBitbucketServerRunner
): Promise<PullRequestOverview> {
  return loadForgeOverview({
    git,
    detect: () => getBitbucketServerProject(git),
    notDetectedMessage: 'No Bitbucket Server remote detected.',
    probe: (project) => getBitbucketServerStatus(runnerFactory(project.host)),
    describeStatus: describeBitbucketServerStatus,
    repository: (project) => ({ owner: project.owner, name: project.name }),
    requireCurrentBranch: true,
    fetch: async (project, currentBranch) => {
      const runner = runnerFactory(project.host)
      const pr = await findOpenBitbucketServerPullRequestForBranch(project.path, currentBranch as string, runner)
      return {
        currentPullRequest: pr ? sanitizePullRequestInfo(prToPullRequestInfo(pr)) : undefined,
        ...(pr ? {} : { message: `No pull request found for ${currentBranch}.` }),
      }
    },
    fetchErrorMessage: (currentBranch) => `No pull request found for ${currentBranch}.`,
  })
}

export const __test = {
  bitbucketServerStateParam,
  buildPullRequestEndpoint,
  mapPullRequestItem,
  normalizeState,
  resolveBitbucketServerMeSlug,
}
