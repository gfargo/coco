import { SimpleGit } from 'simple-git'
import { getProviderRepositoryForGit, type GitProviderType } from './providerData'
import { getPullRequestOverview, type PullRequestOverview } from './pullRequestData'
import type { IssueListFilter, IssueListOverview } from './issuesListData'
import type {
  PullRequestListFilter,
  PullRequestListOverview,
} from './pullRequestListData'
import type { PullRequestDetailResult } from './pullRequestDetailData'
import type { IssueDetailResult } from './issueDetailData'
import type {
  CreatePullRequestInput,
  PullRequestActionResult,
  PullRequestMergeStrategy,
} from './pullRequestActions'
import type { IssueActionResult } from './issueActions'

// GitHub implementations.
import { getPullRequestList } from './pullRequestListData'
import { getIssueList } from './issuesListData'
import { getPullRequestDetail } from './pullRequestDetailData'
import { getIssueDetail } from './issueDetailData'
import {
  addPullRequestAssignee,
  addPullRequestLabel,
  approvePullRequest,
  approvePullRequestByNumber,
  closePullRequest,
  closePullRequestByNumber,
  commentPullRequest,
  commentPullRequestByNumber,
  createPullRequest,
  mergePullRequest,
  mergePullRequestByNumber,
  openPullRequest,
  requestChangesPullRequest,
  requestChangesPullRequestByNumber,
} from './pullRequestActions'
import {
  addIssueAssignee,
  addIssueLabel,
  closeIssue,
  commentIssue,
  reopenIssue,
} from './issueActions'

// GitLab implementations.
import { getMergeRequestList, getGitLabIssueList, getMergeRequestOverview } from './gitlabListData'
import { getMergeRequestDetail, getGitLabIssueDetail } from './gitlabDetailData'
import {
  addMergeRequestAssignee,
  addMergeRequestLabel,
  approveMergeRequest,
  approveMergeRequestByNumber,
  closeMergeRequest,
  closeMergeRequestByNumber,
  commentMergeRequest,
  commentMergeRequestByNumber,
  createMergeRequest,
  mergeMergeRequest,
  mergeMergeRequestByNumber,
  openMergeRequest,
  requestChangesMergeRequest,
  requestChangesMergeRequestByNumber,
} from './mergeRequestActions'
import {
  addGitLabIssueAssignee,
  addGitLabIssueLabel,
  closeGitLabIssue,
  commentGitLabIssue,
  reopenGitLabIssue,
} from './gitlabIssueActions'
import { defaultGlabRunner } from './glabCli'

/**
 * Provider-agnostic forge facade. The workstation runtime dispatches every
 * pull-request / issue load and mutation through this interface, so the
 * GitHub (`gh`) vs GitLab (`glab`) choice is made once (from the detected
 * provider) instead of branched at ~25 call sites. Method signatures mirror
 * the GitHub action functions so call sites only change from `fn(...)` to
 * `forge.fn(...)`.
 */
export type ForgeActions = {
  // Lists
  getPullRequestList: (git: SimpleGit, filter: PullRequestListFilter) => Promise<PullRequestListOverview>
  getIssueList: (git: SimpleGit, filter: IssueListFilter) => Promise<IssueListOverview>
  // Detail (number only; GitLab binds the project path internally)
  getPullRequestDetail: (n: number) => Promise<PullRequestDetailResult>
  getIssueDetail: (n: number) => Promise<IssueDetailResult>
  // Pull-request / merge-request mutations by number (triage)
  commentPullRequestByNumber: (n: number, body: string) => Promise<PullRequestActionResult>
  addPullRequestLabel: (n: number, label: string) => Promise<PullRequestActionResult>
  addPullRequestAssignee: (n: number, assignee: string) => Promise<PullRequestActionResult>
  mergePullRequestByNumber: (n: number, strategy: PullRequestMergeStrategy) => Promise<PullRequestActionResult>
  closePullRequestByNumber: (n: number) => Promise<PullRequestActionResult>
  approvePullRequestByNumber: (n: number) => Promise<PullRequestActionResult>
  requestChangesPullRequestByNumber: (n: number, body: string) => Promise<PullRequestActionResult>
  // Current-branch PR / MR mutations
  mergePullRequest: (strategy: PullRequestMergeStrategy) => Promise<PullRequestActionResult>
  closePullRequest: () => Promise<PullRequestActionResult>
  approvePullRequest: () => Promise<PullRequestActionResult>
  commentPullRequest: (body: string) => Promise<PullRequestActionResult>
  requestChangesPullRequest: (body: string) => Promise<PullRequestActionResult>
  createPullRequest: (input: CreatePullRequestInput) => Promise<PullRequestActionResult>
  openPullRequest: (url: string) => Promise<PullRequestActionResult>
  // Issue mutations
  commentIssue: (n: number, body: string) => Promise<IssueActionResult>
  addIssueLabel: (n: number, label: string) => Promise<IssueActionResult>
  addIssueAssignee: (n: number, assignee: string) => Promise<IssueActionResult>
  closeIssue: (n: number) => Promise<IssueActionResult>
  reopenIssue: (n: number) => Promise<IssueActionResult>
}

const githubActions: ForgeActions = {
  getPullRequestList: (git, filter) => getPullRequestList(git, filter),
  getIssueList: (git, filter) => getIssueList(git, filter),
  getPullRequestDetail: (n) => getPullRequestDetail(n),
  getIssueDetail: (n) => getIssueDetail(n),
  commentPullRequestByNumber,
  addPullRequestLabel,
  addPullRequestAssignee,
  mergePullRequestByNumber,
  closePullRequestByNumber,
  approvePullRequestByNumber,
  requestChangesPullRequestByNumber,
  mergePullRequest,
  closePullRequest,
  approvePullRequest,
  commentPullRequest,
  requestChangesPullRequest,
  createPullRequest,
  openPullRequest,
  commentIssue,
  addIssueLabel,
  addIssueAssignee,
  closeIssue,
  reopenIssue,
}

/**
 * GitLab facade. `host` is the repo's remote hostname (`gitlab.com` or a
 * self-hosted instance) — threaded to the mutating actions so their error-path
 * auth re-probe (`resolveGlabActionError` → `getGlabStatus`) checks the right
 * GitLab instance instead of defaulting to `gitlab.com`. Passing
 * `defaultGlabRunner` explicitly keeps the runner default while reaching the
 * trailing `hostname` slot.
 */
function gitlabActions(path: string | undefined, host?: string): ForgeActions {
  return {
    getPullRequestList: (git, filter) => getMergeRequestList(git, filter),
    getIssueList: (git, filter) => getGitLabIssueList(git, filter),
    getPullRequestDetail: (n) =>
      path ? getMergeRequestDetail(path, n) : Promise.resolve({ ok: false, message: 'No GitLab project resolved' }),
    getIssueDetail: (n) =>
      path ? getGitLabIssueDetail(path, n) : Promise.resolve({ ok: false, message: 'No GitLab project resolved' }),
    commentPullRequestByNumber: (n, body) => commentMergeRequestByNumber(n, body, defaultGlabRunner, host),
    addPullRequestLabel: (n, label) => addMergeRequestLabel(n, label, defaultGlabRunner, host),
    addPullRequestAssignee: (n, assignee) => addMergeRequestAssignee(n, assignee, defaultGlabRunner, host),
    mergePullRequestByNumber: (n, strategy) => mergeMergeRequestByNumber(n, strategy, defaultGlabRunner, host),
    closePullRequestByNumber: (n) => closeMergeRequestByNumber(n, defaultGlabRunner, host),
    approvePullRequestByNumber: (n) => approveMergeRequestByNumber(n, defaultGlabRunner, host),
    requestChangesPullRequestByNumber: (n, body) => requestChangesMergeRequestByNumber(n, body, defaultGlabRunner, host),
    mergePullRequest: (strategy) => mergeMergeRequest(strategy, defaultGlabRunner, host),
    closePullRequest: () => closeMergeRequest(defaultGlabRunner, host),
    approvePullRequest: () => approveMergeRequest(defaultGlabRunner, host),
    commentPullRequest: (body) => commentMergeRequest(body, defaultGlabRunner, host),
    requestChangesPullRequest: (body) => requestChangesMergeRequest(body, defaultGlabRunner, host),
    createPullRequest: (input) => createMergeRequest(input, defaultGlabRunner, host),
    openPullRequest: (url) => openMergeRequest(url, defaultGlabRunner, host),
    commentIssue: (n, body) => commentGitLabIssue(n, body, defaultGlabRunner, host),
    addIssueLabel: (n, label) => addGitLabIssueLabel(n, label, defaultGlabRunner, host),
    addIssueAssignee: (n, assignee) => addGitLabIssueAssignee(n, assignee, defaultGlabRunner, host),
    closeIssue: (n) => closeGitLabIssue(n, defaultGlabRunner, host),
    reopenIssue: (n) => reopenGitLabIssue(n, defaultGlabRunner, host),
  }
}

/**
 * Select the forge facade for the detected provider. Anything other than
 * `gitlab` (github, GitHub Enterprise, unsupported) keeps the GitHub `gh`
 * implementations, preserving existing behavior. For GitLab, pass the project
 * path (`owner/name`) so the detail loaders can address `glab api` endpoints,
 * and the remote `gitlabHost` so error-path auth re-probes hit the right
 * instance (self-hosted installs aren't `gitlab.com`).
 */
export function getForgeActions(
  provider: GitProviderType | undefined,
  options: { gitlabPath?: string; gitlabHost?: string } = {}
): ForgeActions {
  return provider === 'gitlab'
    ? gitlabActions(options.gitlabPath, options.gitlabHost)
    : githubActions
}

/**
 * Current-branch PR/MR overview, dispatched by detecting the provider straight
 * from `git`. Standalone (not part of the ForgeActions facade) because it is
 * also called from non-component contexts (boot context load, legacy
 * interactive log) that don't carry the resolved provider.
 */
export async function getForgePullRequestOverview(git: SimpleGit): Promise<PullRequestOverview> {
  const repo = await getProviderRepositoryForGit(git)
  return repo?.provider === 'gitlab' ? getMergeRequestOverview(git) : getPullRequestOverview(git)
}
