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

// Bitbucket implementations.
import { getBitbucketPullRequestList, getBitbucketIssueList, getBitbucketPullRequestOverview } from './bitbucketListData'
import { getBitbucketPullRequestDetail, getBitbucketIssueDetail } from './bitbucketDetailData'
import {
  createBitbucketPullRequest,
  openBitbucketPullRequest,
  mergeBitbucketPullRequestByNumber,
  approveBitbucketPullRequestByNumber,
  closeBitbucketPullRequestByNumber,
  commentBitbucketPullRequestByNumber,
  requestChangesBitbucketPullRequestByNumber,
  addBitbucketPullRequestLabel,
  addBitbucketPullRequestReviewer,
  mergeBitbucketPullRequest,
  closeBitbucketPullRequest,
  approveBitbucketPullRequest,
  commentBitbucketPullRequest,
  requestChangesBitbucketPullRequest,
} from './bitbucketPullRequestActions'
import {
  commentBitbucketIssue,
  addBitbucketIssueLabel,
  addBitbucketIssueAssignee,
  closeBitbucketIssue,
  reopenBitbucketIssue,
} from './bitbucketIssueActions'

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
 * Bitbucket facade. `path` is `workspace/repo_slug`; `currentBranch` is the
 * checked-out branch (required for current-branch mutations that can't infer
 * the branch from a CLI binary).
 */
function bitbucketActions(
  path: string | undefined,
  currentBranch?: string
): ForgeActions {
  return {
    getPullRequestList: (git, filter) => getBitbucketPullRequestList(git, filter),
    getIssueList: (git, filter) => getBitbucketIssueList(git, filter),
    getPullRequestDetail: (n) =>
      path
        ? getBitbucketPullRequestDetail(path, n)
        : Promise.resolve({ ok: false, message: 'No Bitbucket project resolved' }),
    getIssueDetail: (n) =>
      path
        ? getBitbucketIssueDetail(path, n)
        : Promise.resolve({ ok: false, message: 'No Bitbucket project resolved' }),
    commentPullRequestByNumber: (n, body) => commentBitbucketPullRequestByNumber(path ?? '', n, body),
    addPullRequestLabel: () => addBitbucketPullRequestLabel(),
    addPullRequestAssignee: (n, assignee) => addBitbucketPullRequestReviewer(path ?? '', n, assignee),
    mergePullRequestByNumber: (n, strategy) => mergeBitbucketPullRequestByNumber(path ?? '', n, strategy),
    closePullRequestByNumber: (n) => closeBitbucketPullRequestByNumber(path ?? '', n),
    approvePullRequestByNumber: (n) => approveBitbucketPullRequestByNumber(path ?? '', n),
    requestChangesPullRequestByNumber: (n, body) => requestChangesBitbucketPullRequestByNumber(path ?? '', n, body),
    mergePullRequest: (strategy) => mergeBitbucketPullRequest(path, currentBranch, strategy),
    closePullRequest: () => closeBitbucketPullRequest(path, currentBranch),
    approvePullRequest: () => approveBitbucketPullRequest(path, currentBranch),
    commentPullRequest: (body) => commentBitbucketPullRequest(path, currentBranch, body),
    requestChangesPullRequest: (body) => requestChangesBitbucketPullRequest(path, currentBranch, body),
    createPullRequest: (input) =>
      path
        ? createBitbucketPullRequest(path, input)
        : Promise.resolve({ ok: false, message: 'No Bitbucket project resolved' }),
    openPullRequest: (url) => Promise.resolve(openBitbucketPullRequest(url)),
    commentIssue: (n, body) => commentBitbucketIssue(path ?? '', n, body),
    addIssueLabel: () => addBitbucketIssueLabel(),
    addIssueAssignee: (n, assignee) => addBitbucketIssueAssignee(path ?? '', n, assignee),
    closeIssue: (n) => closeBitbucketIssue(path ?? '', n),
    reopenIssue: (n) => reopenBitbucketIssue(path ?? '', n),
  }
}

/**
 * Select the forge facade for the detected provider. Anything other than
 * `gitlab` or `bitbucket` (github, GitHub Enterprise, unsupported) keeps the
 * GitHub `gh` implementations, preserving existing behavior. For GitLab, pass
 * the project path (`owner/name`) and remote host so error-path auth re-probes
 * hit the right instance. For Bitbucket, pass the workspace/repo path and
 * current branch (needed for current-branch mutations that can't infer the
 * branch from a CLI binary).
 */
export function getForgeActions(
  provider: GitProviderType | undefined,
  options: {
    gitlabPath?: string
    gitlabHost?: string
    bitbucketPath?: string
    /** Current checked-out branch, required for Bitbucket current-branch PR mutations. */
    currentBranch?: string
  } = {}
): ForgeActions {
  if (provider === 'gitlab') return gitlabActions(options.gitlabPath, options.gitlabHost)
  if (provider === 'bitbucket') return bitbucketActions(options.bitbucketPath, options.currentBranch)
  return githubActions
}

/**
 * Current-branch PR/MR overview, dispatched by detecting the provider straight
 * from `git`. Standalone (not part of the ForgeActions facade) because it is
 * also called from non-component contexts (boot context load, legacy
 * interactive log) that don't carry the resolved provider.
 */
export async function getForgePullRequestOverview(git: SimpleGit): Promise<PullRequestOverview> {
  const repo = await getProviderRepositoryForGit(git)
  if (repo?.provider === 'gitlab') return getMergeRequestOverview(git)
  if (repo?.provider === 'bitbucket') return getBitbucketPullRequestOverview(git)
  return getPullRequestOverview(git)
}
