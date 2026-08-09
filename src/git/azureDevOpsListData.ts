import { SimpleGit } from 'simple-git'
import {
  buildAzureDevOpsRepoWebUrl,
  describeAzureDevOpsStatus,
  getAzureDevOpsProject,
  getAzureDevOpsStatus,
  makeAzureDevOpsRunner,
  resolveAzureDevOpsSelfIdentity,
  type AzureDevOpsProject,
  type AzureDevOpsRunner,
} from './azureDevOpsCli'
import { loadForgeList, loadForgeOverview } from './forgeLoad'
import type { IssueListFilter, IssueListOverview } from './issuesListData'
import type {
  PullRequestListFilter,
  PullRequestListItem,
  PullRequestListOverview,
} from './pullRequestListData'
import type { PullRequestInfo, PullRequestOverview } from './pullRequestData'
import { sanitizePullRequestInfo, sanitizePullRequestListItem } from './forgeText'

/**
 * Azure DevOps Repos list loaders. These produce the SAME overview shapes as
 * the GitHub/GitLab/Bitbucket/Gitea loaders so the triage surfaces and
 * command handlers consume them identically.
 *
 * Azure DevOps's resource model has no issue tracker of its own — "issues"
 * are Work Items, a separate, structurally different API (`_apis/wit`, WIQL
 * queries) with no 1:1 mapping to the title/body/labels/assignees shape the
 * other forges' issue lists share. `getAzureDevOpsIssueList` is therefore a
 * deliberate, explicit "unsupported" (mirrors
 * `getBitbucketServerIssueList` — Bitbucket Server has the same no-native-
 * issue-tracker gap) rather than a lossy best-effort Work Item mapping.
 *
 * The PR search API has no server-side author/assignee filter, so — like
 * Gitea — those filters are applied client-side: an exhaustive window (up to
 * 100 pages of 100) is fetched first when an author/assignee filter
 * (including `'@me'`) is present, then filtered and sliced to `want`.
 */

type RunnerFactory = (host: string, org: string, project: string) => AzureDevOpsRunner

const AZURE_DEVOPS_PAGE_SIZE = 100
const AZURE_DEVOPS_MAX_PAGES = 100
const EXHAUSTIVE_WANT = Number.MAX_SAFE_INTEGER

type RawAzureDevOpsIdentity = { displayName?: string; uniqueName?: string; id?: string }
type RawAzureDevOpsLabel = { name?: string }
type RawAzureDevOpsReviewer = RawAzureDevOpsIdentity & { vote?: number }

export type RawAzureDevOpsPullRequest = {
  pullRequestId?: number
  title?: string
  description?: string
  status?: string
  isDraft?: boolean
  sourceRefName?: string
  targetRefName?: string
  createdBy?: RawAzureDevOpsIdentity
  creationDate?: string
  mergeStatus?: string
  labels?: RawAzureDevOpsLabel[]
  reviewers?: RawAzureDevOpsReviewer[]
}

function stripRefsHeads(ref: string): string {
  return ref.replace(/^refs\/heads\//, '')
}

function azureDevOpsState(status: string | undefined): string {
  const s = String(status || '').toLowerCase()
  if (s === 'completed') return 'MERGED'
  if (s === 'abandoned') return 'CLOSED'
  return 'OPEN'
}

function azureDevOpsMergeable(mergeStatus: string | undefined): string | undefined {
  const s = String(mergeStatus || '').toLowerCase()
  if (s === 'succeeded') return 'MERGEABLE'
  if (s === 'conflicts' || s === 'rejectedbypolicy' || s === 'failure') return 'CONFLICTING'
  return undefined
}

function reviewerNames(reviewers: RawAzureDevOpsReviewer[] | undefined): string[] | undefined {
  if (!Array.isArray(reviewers) || !reviewers.length) return undefined
  const names = reviewers.map((r) => r.uniqueName || r.displayName || '').filter(Boolean)
  return names.length ? names : undefined
}

function labelNames(labels: RawAzureDevOpsLabel[] | undefined): string[] | undefined {
  if (!Array.isArray(labels) || !labels.length) return undefined
  const names = labels.map((l) => l.name || '').filter(Boolean)
  return names.length ? names : undefined
}

function prSharedFields(pr: RawAzureDevOpsPullRequest, project: AzureDevOpsProject) {
  return {
    number: Number(pr.pullRequestId),
    title: String(pr.title || ''),
    url: `${buildAzureDevOpsRepoWebUrl(project)}/pullrequest/${Number(pr.pullRequestId)}`,
    state: azureDevOpsState(pr.status),
    isDraft: Boolean(pr.isDraft),
    headRefName: stripRefsHeads(String(pr.sourceRefName || '')),
    baseRefName: stripRefsHeads(String(pr.targetRefName || '')),
    author: pr.createdBy?.uniqueName,
    reviewDecision: undefined,
    mergeable: azureDevOpsMergeable(pr.mergeStatus),
    mergeStateStatus: undefined,
  }
}

function mapPullRequestItem(pr: RawAzureDevOpsPullRequest, project: AzureDevOpsProject): PullRequestListItem {
  const createdAt = String(pr.creationDate || '')
  return {
    ...prSharedFields(pr, project),
    assignees: reviewerNames(pr.reviewers),
    labels: labelNames(pr.labels),
    createdAt,
    // Azure's pull-request resource carries no separate "last updated"
    // timestamp on the list payload — creation date is the best available
    // signal rather than leaving a required field empty.
    updatedAt: createdAt,
  }
}

async function fetchAllPullRequests(
  runner: AzureDevOpsRunner,
  repo: string,
  statusParam: 'active' | 'all',
  want: number
): Promise<RawAzureDevOpsPullRequest[]> {
  const acc: RawAzureDevOpsPullRequest[] = []
  const top = Math.min(want, AZURE_DEVOPS_PAGE_SIZE)
  for (let page = 0; page < AZURE_DEVOPS_MAX_PAGES && acc.length < want; page++) {
    const skip = page * top
    const out = (
      await runner(
        `git/repositories/${encodeURIComponent(repo)}/pullrequests?searchCriteria.status=${statusParam}&$top=${top}&$skip=${skip}`
      )
    ).trim()
    if (!out) break
    const parsed = JSON.parse(out) as { value?: RawAzureDevOpsPullRequest[] }
    const items = Array.isArray(parsed.value) ? parsed.value : []
    acc.push(...items)
    if (items.length < top) break
  }
  return acc.slice(0, want)
}

function azureDevOpsStatusParam(state: PullRequestListFilter['state']): 'active' | 'all' {
  return state === 'open' ? 'active' : 'all'
}

export async function getAzureDevOpsPullRequestList(
  git: SimpleGit,
  filter: PullRequestListFilter = {},
  runnerFactory: RunnerFactory = makeAzureDevOpsRunner
): Promise<PullRequestListOverview> {
  return loadForgeList({
    detect: () => getAzureDevOpsProject(git),
    notDetectedMessage: 'No Azure DevOps remote detected.',
    probe: (project) => getAzureDevOpsStatus(runnerFactory(project.host, project.org, project.project)),
    describeStatus: describeAzureDevOpsStatus,
    repository: (project) => ({ owner: project.owner, name: project.name }),
    filter,
    fetch: async (project) => {
      const runner = runnerFactory(project.host, project.org, project.project)
      const want = filter.limit ?? 30
      const hasIdentityFilter = Boolean(filter.author || filter.assignee)

      const raw = await fetchAllPullRequests(
        runner,
        project.repo,
        azureDevOpsStatusParam(filter.state),
        hasIdentityFilter ? EXHAUSTIVE_WANT : want
      )

      let pullRequests = raw.map((pr) => mapPullRequestItem(pr, project))

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
      const me = wantsMe ? (await resolveAzureDevOpsSelfIdentity(project.org, runner))?.uniqueName : undefined
      if (wantsMe && !me) {
        throw new Error('Could not resolve "@me" to an Azure DevOps identity.')
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

      pullRequests = pullRequests.slice(0, want)

      return { pullRequests: pullRequests.map(sanitizePullRequestListItem) }
    },
    fetchErrorMessage: 'Failed to fetch pull request list.',
  })
}

/**
 * Azure DevOps Repos has no built-in issue tracker — "issues" here are Work
 * Items, tracked through a structurally different API. Rather than guess at
 * a lossy mapping, this is an explicit "unsupported", mirroring
 * `getBitbucketServerIssueList`.
 */
export async function getAzureDevOpsIssueList(
  git: SimpleGit,
  filter: IssueListFilter = {},
  runnerFactory: RunnerFactory = makeAzureDevOpsRunner
): Promise<IssueListOverview> {
  return loadForgeList({
    detect: () => getAzureDevOpsProject(git),
    notDetectedMessage: 'No Azure DevOps remote detected.',
    probe: (project) => getAzureDevOpsStatus(runnerFactory(project.host, project.org, project.project)),
    describeStatus: describeAzureDevOpsStatus,
    repository: (project) => ({ owner: project.owner, name: project.name }),
    filter,
    fetch: async () => {
      throw new Error(
        'Azure DevOps tracks Work Items, not issues — coco does not map them yet (no 1:1 shape).'
      )
    },
    fetchErrorMessage: 'Azure DevOps tracks Work Items, not issues.',
  })
}

// ---------------------------------------------------------------------------
// Current-branch pull request overview (for `coco pr` / workstation header)
// ---------------------------------------------------------------------------

function prToPullRequestInfo(pr: RawAzureDevOpsPullRequest, project: AzureDevOpsProject): PullRequestInfo {
  return {
    ...prSharedFields(pr, project),
    body: typeof pr.description === 'string' ? pr.description : undefined,
    statusCheckRollup: undefined,
    reviews: undefined,
  }
}

/**
 * Fetch the open Azure DevOps pull request whose source branch is `branch`,
 * if any. The search API has no server-side "filter by source branch" query
 * param usable across API versions, so this fetches active PRs (bounded to
 * 100) and filters client-side, mirroring `findOpenGiteaPullRequestForBranch`.
 */
export async function findOpenAzureDevOpsPullRequestForBranch(
  project: AzureDevOpsProject,
  branch: string,
  runner: AzureDevOpsRunner
): Promise<RawAzureDevOpsPullRequest | undefined> {
  const out = (
    await runner(
      `git/repositories/${encodeURIComponent(project.repo)}/pullrequests?searchCriteria.status=active&$top=100`
    )
  ).trim()
  if (!out) return undefined
  const parsed = JSON.parse(out) as { value?: RawAzureDevOpsPullRequest[] }
  const items = Array.isArray(parsed.value) ? parsed.value : []
  return items.find((pr) => stripRefsHeads(String(pr.sourceRefName || '')) === branch)
}

export async function getAzureDevOpsPullRequestOverview(
  git: SimpleGit,
  runnerFactory: RunnerFactory = makeAzureDevOpsRunner
): Promise<PullRequestOverview> {
  return loadForgeOverview({
    git,
    detect: () => getAzureDevOpsProject(git),
    notDetectedMessage: 'No Azure DevOps remote detected.',
    probe: (project) => getAzureDevOpsStatus(runnerFactory(project.host, project.org, project.project)),
    describeStatus: describeAzureDevOpsStatus,
    repository: (project) => ({ owner: project.owner, name: project.name }),
    requireCurrentBranch: true,
    fetch: async (project, currentBranch) => {
      const runner = runnerFactory(project.host, project.org, project.project)
      const pr = await findOpenAzureDevOpsPullRequestForBranch(project, currentBranch as string, runner)
      return {
        currentPullRequest: pr ? sanitizePullRequestInfo(prToPullRequestInfo(pr, project)) : undefined,
        ...(pr ? {} : { message: `No pull request found for ${currentBranch}.` }),
      }
    },
    fetchErrorMessage: (currentBranch) => `No pull request found for ${currentBranch}.`,
  })
}

export const __test = {
  azureDevOpsStatusParam,
  mapPullRequestItem,
  azureDevOpsState,
  azureDevOpsMergeable,
}
